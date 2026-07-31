/**
 * WebUSB 设备仿真,按 USB 包(≤64B)粒度模拟 bulk IN/OUT 端点。
 *
 * 与固件对齐的关键行为(见 usb_aio_handler/src/funcs/epass/):
 * - responder.c: OUT 流解析带 MAGIC resync,坏帧丢弃不断连,rid 回显;
 * - protocol.c write_frame: 帧头单独一次写(自成短包),payload 按 16KiB 分片,
 *   仅当帧总长 %64==0 时补一个 ZLP;
 * - URB 语义: transferIn(length) 只在「收满 length」或「遇到短包(含 ZLP)」时
 *   完成,多个未决 transferIn 按 FIFO 先来先喂——这正是宿主端边界 bug 的温床。
 *
 * faults 用于 fuzz 注入故障。
 */
import { HEADER_SIZE, MAGIC, VERSION, MAX_PAYLOAD, MsgType, encodeFrame, encodeKv, decodeKv } from '@/protocol'
import { crc32 } from '@/protocol/crc32'

const MPS = 64
const DEV_WRITE_CHUNK = 16 * 1024
/** 设备端 rx_read_some 一次 read 的缓冲大小(USB_RESPONDER_IO_CHUNK) */
const DEV_READ_CHUNK = 16 * 1024
const MAGIC_LE = [0x53, 0x41, 0x50, 0x45]

export interface Faults {
  /** 应答前延迟(模拟 NAND 回写慢) */
  delayMs?: number
  /** 吞掉应答不回 */
  dropResponses?: boolean
  /** 应答前注入垃圾字节 */
  garbagePrefix?: Uint8Array
  /** 应答前先发一个旧 request_id 的 STATUS 帧(模拟上个事务的迟到应答) */
  staleFrameRid?: number
  /** 同一应答发两遍 */
  duplicateResponse?: boolean
  /** 应答只发前 N 字节然后沉默(断帧) */
  tornBytes?: number
  /** 应答换成一个声明 payload_len=N 的裸帧头,不发 payload */
  hugePlen?: number
  /** 应答按 1 字节一个包发送 */
  byteDribble?: boolean
  /** 应答换成 ERROR */
  errorInstead?: boolean
  /** device.reset() 是否可用(默认可用;Windows/WinUSB 下常不可用) */
  resetWorks?: boolean
  /** 设备已断开,所有传输失败 */
  disconnected?: boolean
  /** 宿主补的零长 OUT 包(ZLP)不生效——帧长撞上最大包整数倍时,设备端 read()
   * 等不到收尾包,请求永远无应答 */
  zlpLost?: boolean
  /** 真机默认行为:设备补 IN 方向 ZLP 时 write() 阻塞,直到宿主再读一次 IN 才
   * 返回;阻塞期间设备不读 OUT,宿主的下一个请求被一路 NAK。设为 false 可关掉
   * 这个建模(对照用) */
  zlpBlocksResponder?: boolean
}

interface PendingRead {
  length: number
  acc: Uint8Array[]
  accLen: number
  resolve: (r: { status: string, data: DataView }) => void
  reject: (e: Error) => void
}

function concat (parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

export class MockDevice {
  faults: Faults = {}
  opened = true
  /** 事件日志,便于失败用例回放 */
  log: string[] = []

  files = new Map<string, Uint8Array>()
  dirs = new Set<string>(['/'])

  private packets: Uint8Array[] = []
  private pending: PendingRead[] = []
  private rx = new Uint8Array(0)
  private zlpBlocked = false
  private outStage: Uint8Array[] = []
  private outStaged = 0
  private uploads = new Map<number, { path: string, parts: Uint8Array[] }>()

  // ---------------- USBDevice 表面 ----------------

  async transferOut (_ep: number, data: BufferSource): Promise<{ bytesWritten: number, status: string }> {
    if (this.faults.disconnected) throw new Error('device disconnected')
    const bytes = data instanceof Uint8Array
      ? data.slice()
      : new Uint8Array(data instanceof ArrayBuffer ? data.slice(0) : (data as ArrayBufferView).buffer.slice(0))
    await Promise.resolve()
    this.feedOutTransfer(bytes)
    return { bytesWritten: bytes.length, status: 'ok' }
  }

  async transferIn (_ep: number, length: number): Promise<{ status: string, data: DataView }> {
    if (this.faults.disconnected) throw new Error('device disconnected')
    return new Promise((resolve, reject) => {
      this.pending.push({ length, acc: [], accLen: 0, resolve, reject })
      this.pump()
    })
  }

  async reset (): Promise<void> {
    if (this.faults.disconnected) throw new Error('device disconnected')
    if (this.faults.resetWorks === false) throw new Error('reset not supported on this platform')
    this.log.push('RESET')
    for (const p of this.pending) p.reject(new Error('transfer cancelled by reset'))
    this.pending = []
    this.packets = []
    this.rx = new Uint8Array(0)
    this.outStage = []
    this.outStaged = 0
    this.zlpBlocked = false
    this.uploads.clear()
  }

  async open (): Promise<void> {}
  async close (): Promise<void> { this.opened = false }
  async claimInterface (_n: number): Promise<void> {}
  async releaseInterface (_n: number): Promise<void> {}
  async selectConfiguration (_n: number): Promise<void> {}

  // ---------------- IN 方向: 包队列 + URB 语义 ----------------

  private pushPackets (blob: Uint8Array): void {
    if (this.faults.byteDribble) {
      for (const b of blob) this.packets.push(Uint8Array.of(b))
      return
    }
    for (let o = 0; o < blob.length; o += MPS) {
      this.packets.push(blob.slice(o, o + MPS))
    }
    // blob.length %64==0 时末包是整包,不构成传输边界,与后续字节连续——
    // 正是 FunctionFS write 的真实行为
  }

  private writeBlob (blob: Uint8Array): void {
    this.pushPackets(blob)
    this.pump()
  }

  private writeZlp (): void {
    this.packets.push(new Uint8Array(0))
    if (this.faults.zlpBlocksResponder !== false) {
      this.zlpBlocked = true
    }
    this.pump()
  }

  private pump (): void {
    while (this.pending.length > 0 && this.packets.length > 0) {
      const req = this.pending[0]
      let done = false
      while (this.packets.length > 0) {
        const pkt = this.packets.shift()!
        if (pkt.length > 0) {
          req.acc.push(pkt)
          req.accLen += pkt.length
        } else {
          this.zlpBlocked = false // 宿主把 ZLP 取走了,设备的 write 返回
        }
        // 短包(含 ZLP)或收满都终止本次 URB
        if (pkt.length < MPS || req.accLen >= req.length) {
          done = true
          break
        }
      }
      if (!done) return // 流停在整包边界且未收满 → URB 继续挂起(真实内核行为)
      this.pending.shift()
      const buf = concat(req.acc)
      req.resolve({ status: 'ok', data: new DataView(buf.buffer, 0, buf.length) })
    }
  }

  // ---------------- OUT 方向: read() URB 语义 + 帧解析(对齐 responder.c) ----------------

  /** 设备端是 read(fd, tmp, 16KiB) 阻塞读:URB 只在收到短包(含 ZLP)或读满缓冲时
   * 才完成并把字节交给上层。宿主一次传输若正好停在满包边界上,这些字节就一直
   * 压在内核里、上层看不到——请求"发出去了却没人应答"。以前这里直接 feed(),
   * 等于假设设备能看见每个字节,宿主漏补收尾包的 bug 全被掩盖。 */
  private feedOutTransfer (bytes: Uint8Array): void {
    if (this.zlpBlocked) {
      // 设备卡在 write(zlp) 里没在读 OUT → UDC 一路 NAK,这笔请求根本没进设备
      this.log.push('out dropped: responder blocked on ZLP')
      return
    }
    const packets: Uint8Array[] = []
    if (bytes.length === 0) {
      if (this.faults.zlpLost) return
      packets.push(new Uint8Array(0)) // ZLP 自身就是收尾短包
    } else {
      for (let o = 0; o < bytes.length; o += MPS) packets.push(bytes.slice(o, o + MPS))
    }
    for (const pkt of packets) {
      if (pkt.length > 0) {
        this.outStage.push(pkt)
        this.outStaged += pkt.length
      }
      if (pkt.length < MPS || this.outStaged >= DEV_READ_CHUNK) {
        this.completeOutRead()
      }
    }
  }

  private completeOutRead (): void {
    if (this.outStaged === 0) {
      this.outStage = [] // 空读(残留 ZLP),设备侧吞掉重读
      return
    }
    const blob = concat(this.outStage)
    this.outStage = []
    this.outStaged = 0
    this.feed(blob)
  }

  private feed (bytes: Uint8Array): void {
    this.rx = concat([this.rx, bytes])
    this.parse()
  }

  private resyncToMagic (): void {
    for (let i = 1; i + 4 <= this.rx.length; i++) {
      if (this.rx[i] === MAGIC_LE[0] && this.rx[i + 1] === MAGIC_LE[1]
        && this.rx[i + 2] === MAGIC_LE[2] && this.rx[i + 3] === MAGIC_LE[3]) {
        this.rx = this.rx.slice(i)
        return
      }
    }
    const keep = Math.min(3, Math.max(0, this.rx.length - 1))
    this.rx = this.rx.slice(this.rx.length - keep)
  }

  private parse (): void {
    for (;;) {
      if (this.rx.length < HEADER_SIZE) return
      const dv = new DataView(this.rx.buffer, this.rx.byteOffset, this.rx.byteLength)
      if (dv.getUint32(0, true) !== MAGIC || dv.getUint16(4, true) !== VERSION) {
        this.log.push('rx resync: bad magic/version')
        this.resyncToMagic()
        continue
      }
      const plen = dv.getUint32(16, true)
      if (plen > MAX_PAYLOAD) {
        this.log.push(`rx resync: plen=${plen}`)
        this.resyncToMagic()
        continue
      }
      const flen = HEADER_SIZE + plen
      if (this.rx.length < flen) return
      const type = dv.getUint16(6, true)
      const rid = dv.getUint32(12, true)
      const crc = dv.getUint32(20, true)
      const payload = this.rx.slice(HEADER_SIZE, flen)
      if (crc32(payload) !== crc) {
        this.log.push('rx resync: crc mismatch')
        this.resyncToMagic()
        continue
      }
      this.rx = this.rx.slice(flen)
      void this.handleFrame(type, rid, payload)
    }
  }

  // ---------------- 应答(带故障注入) ----------------

  private sendFrame (type: MsgType, rid: number, payload: Uint8Array): void {
    const frame = encodeFrame(type, rid, payload)
    if (this.faults.tornBytes !== undefined) {
      this.writeBlob(frame.slice(0, this.faults.tornBytes))
      return
    }
    // 对齐 protocol.c write_frame: 头单独写,payload 16KiB 分片,按帧总长补 ZLP
    this.writeBlob(frame.slice(0, HEADER_SIZE))
    for (let o = HEADER_SIZE; o < frame.length; o += DEV_WRITE_CHUNK) {
      this.writeBlob(frame.slice(o, o + DEV_WRITE_CHUNK))
    }
    if (frame.length % MPS === 0) this.writeZlp()
  }

  private sendError (rid: number, message: string): void {
    this.sendFrame(MsgType.ERROR, rid, encodeKv([['message', message]]))
  }

  private async handleFrame (type: number, rid: number, payload: Uint8Array): Promise<void> {
    const f = this.faults
    this.log.push(`rx frame type=${type} rid=${rid} plen=${payload.length}`)
    if (f.delayMs) await sleep(f.delayMs)
    if (f.disconnected || f.dropResponses) return
    if (f.garbagePrefix) this.writeBlob(f.garbagePrefix.slice())
    if (f.staleFrameRid !== undefined) {
      this.sendFrame(MsgType.STATUS, f.staleFrameRid, encodeKv([['status', 'ok']]))
    }
    if (f.hugePlen !== undefined) {
      const hdr = new Uint8Array(HEADER_SIZE)
      const dv = new DataView(hdr.buffer)
      dv.setUint32(0, MAGIC, true)
      dv.setUint16(4, VERSION, true)
      dv.setUint16(6, MsgType.STATUS, true)
      dv.setUint32(12, rid, true)
      dv.setUint32(16, f.hugePlen, true)
      this.writeBlob(hdr)
      return
    }
    if (f.errorInstead) {
      this.sendError(rid, 'injected error')
      return
    }
    this.dispatch(type, rid, payload)
    if (f.duplicateResponse) this.dispatch(type, rid, payload)
  }

  private dispatch (type: number, rid: number, payload: Uint8Array): void {
    let kv: Record<string, string> = {}
    try {
      switch (type) {
        case MsgType.HELLO: {
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok'], ['protocol', '1']]))
          return
        }
        case MsgType.DEVINFO: {
          this.sendFrame(MsgType.DEVINFO, rid, encodeKv([['model', 'mock-f1c'], ['fw', 'fuzz']]))
          return
        }
        case MsgType.FILE_MKDIR: {
          kv = decodeKv(payload)
          if (!kv.path) return this.sendError(rid, 'missing path')
          if (kv.parents) {
            const parts = kv.path.split('/').filter(Boolean)
            let cur = ''
            for (const p of parts) { cur += '/' + p; this.dirs.add(cur) }
          } else {
            this.dirs.add(kv.path)
          }
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.FILE_LIST: {
          kv = decodeKv(payload)
          const dir = kv.path ?? ''
          if (!this.dirs.has(dir)) return this.sendError(rid, 'list failed: not a directory')
          const prefix = dir.endsWith('/') ? dir : dir + '/'
          const files: string[] = []
          const dirs: string[] = []
          for (const p of this.files.keys()) {
            if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) files.push(p.slice(prefix.length))
          }
          for (const d of this.dirs) {
            if (d.startsWith(prefix) && d !== dir && !d.slice(prefix.length).includes('/')) dirs.push(d.slice(prefix.length))
          }
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['files', files.join('\n')], ['dirs', dirs.join('\n')]]))
          return
        }
        case MsgType.FILE_STAT: {
          kv = decodeKv(payload)
          const data = this.files.get(kv.path ?? '')
          if (data) {
            this.sendFrame(MsgType.STATUS, rid, encodeKv([['size', String(data.length)], ['type', 'file']]))
          } else if (this.dirs.has(kv.path ?? '')) {
            this.sendFrame(MsgType.STATUS, rid, encodeKv([['size', '0'], ['type', 'dir']]))
          } else {
            this.sendError(rid, 'stat failed: no such file')
          }
          return
        }
        case MsgType.FILE_GET: {
          kv = decodeKv(payload)
          const data = this.files.get(kv.path ?? '')
          if (!data) return this.sendError(rid, 'get failed: no such file')
          let piece = data
          if (kv.offset !== undefined || kv.length !== undefined) {
            const off = Number.parseInt(kv.offset ?? '0', 10)
            const len = kv.length === undefined ? data.length - off : Number.parseInt(kv.length, 10)
            piece = data.slice(off, off + len)
          }
          this.sendFrame(MsgType.FILE_GET, rid, piece)
          return
        }
        case MsgType.FILE_PUT_BEGIN: {
          kv = decodeKv(payload)
          if (!kv.path) return this.sendError(rid, 'missing path')
          this.uploads.set(rid, { path: kv.path, parts: [] })
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.FILE_PUT_CHUNK: {
          const tid = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true)
          const up = this.uploads.get(tid)
          if (!up) return this.sendError(rid, 'no such transfer')
          up.parts.push(payload.slice(4))
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.FILE_PUT_END: {
          const tid = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true)
          const up = this.uploads.get(tid)
          if (!up) return this.sendError(rid, 'no such transfer')
          this.files.set(up.path, concat(up.parts))
          this.uploads.delete(tid)
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.FILE_DELETE: {
          kv = decodeKv(payload)
          if (!this.files.delete(kv.path ?? '')) return this.sendError(rid, 'delete failed')
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.FILE_RENAME: {
          kv = decodeKv(payload)
          const data = this.files.get(kv.from ?? '')
          if (!data) return this.sendError(rid, 'rename failed')
          this.files.delete(kv.from!)
          this.files.set(kv.to ?? '', data)
          this.sendFrame(MsgType.STATUS, rid, encodeKv([['status', 'ok']]))
          return
        }
        case MsgType.COMMAND_EXEC: {
          // 命令格式约定: "gen N" → stdout 输出 N 字节,用于扫应答长度边界
          const dv = new DataView(payload.buffer, payload.byteOffset)
          const cmdLen = dv.getUint32(12, true)
          const cmd = new TextDecoder().decode(payload.slice(16, 16 + cmdLen))
          const m = /^gen (\d+)$/.exec(cmd)
          const stdout = new Uint8Array(m ? Number.parseInt(m[1], 10) : 5).fill(0x78)
          const out = new Uint8Array(20 + stdout.length)
          const odv = new DataView(out.buffer)
          odv.setInt32(0, 0, true)
          odv.setUint32(8, 7, true)
          odv.setUint32(12, stdout.length, true)
          odv.setUint32(16, 0, true)
          out.set(stdout, 20)
          this.sendFrame(MsgType.COMMAND_RESULT, rid, out)
          return
        }
        default: {
          this.sendError(rid, `unsupported type ${type}`)
        }
      }
    } catch (e) {
      this.sendError(rid, `device error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}
