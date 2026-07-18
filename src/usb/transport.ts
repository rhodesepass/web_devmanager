import { encodeFrame, decodeFrame, HEADER_SIZE, MAGIC, MAX_PAYLOAD, MsgType, VERSION, logUsbProtocolFrame } from '@/protocol'
import { USB_REQUEST_CHUNK, DEFAULT_TIMEOUT } from './constants'
import type { Frame } from '@/protocol'

export type DisconnectCallback = () => void

export class UsbTransport {
  private device!: USBDevice
  private epIn = 0x81
  private epOut = 0x02
  private epOutPacketSize = 64
  private epInPacketSize = 64
  private rxBuffer = new Uint8Array(1024 * 1024)
  private rxLength = 0
  private pendingRead: Promise<void> | null = null
  private requestId = 0
  private timeout = DEFAULT_TIMEOUT
  private disconnectCb: DisconnectCallback | null = null

  private onUsbDisconnect = (event: USBConnectionEvent) => {
    if (event.device === this.device) {
      this.disconnectCb?.()
    }
  }

  get isConnected (): boolean {
    return this.device?.opened ?? false
  }

  get deviceInfo (): { vendorId: number; productId: number; serialNumber: string } | null {
    if (!this.device) return null
    return {
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      serialNumber: this.device.serialNumber ?? '',
    }
  }

  onDisconnect (cb: DisconnectCallback): void {
    this.disconnectCb = cb
  }

  async connect (vid: number, pid: number, serial?: string): Promise<void> {
    const filters: USBDeviceFilter[] = [{ vendorId: vid, productId: pid }]
    this.device = await navigator.usb.requestDevice({ filters })

    if (serial && this.device.serialNumber !== serial) {
      throw new Error(`serial mismatch: expected ${serial}, got ${this.device.serialNumber}`)
    }

    await this.device.open()
    // 设备端协议状态只在 USB reset/重枚举时清零。上个会话若中断在半截帧
    // (页面刷新/传输报错),不 reset 就 claim 会永久失步:设备把新请求的
    // 字节当成旧帧 payload 吃掉,所有请求无响应,表现为"卡死"。
    try {
      await this.device.reset()
    } catch {
      // 少数平台/权限下 reset 不可用,尽力而为
    }
    await this.device.selectConfiguration(1)
    await this.device.claimInterface(0)

    const iface = this.device.configuration?.interfaces[0]
    if (iface) {
      for (const ep of iface.alternate.endpoints) {
        if (ep.direction === 'in') {
          this.epIn = ep.endpointNumber
          this.epInPacketSize = ep.packetSize
        }
        if (ep.direction === 'out') {
          this.epOut = ep.endpointNumber
          this.epOutPacketSize = ep.packetSize
        }
      }
    }

    this.rxLength = 0
    this.pendingRead = null
    this.requestId = 0

    navigator.usb.addEventListener('disconnect', this.onUsbDisconnect)
  }

  async disconnect (): Promise<void> {
    navigator.usb.removeEventListener('disconnect', this.onUsbDisconnect)
    try {
      if (this.device?.opened) {
        await this.device.releaseInterface(0)
        await this.device.close()
      }
    } catch {
      // ignore close errors
    }
  }

  nextId (): number {
    this.requestId = (this.requestId + 1) >>> 0
    if (this.requestId === 0) this.requestId = 1
    return this.requestId
  }

  async sendFrame (type: MsgType, payload: Uint8Array<ArrayBufferLike> = new Uint8Array(0), reqId?: number): Promise<number> {
    const id = reqId ?? this.nextId()
    logUsbProtocolFrame('TX', { type, requestId: id, flags: 0, payload })
    const frame = encodeFrame(type, id, payload)
    await this.writeAll(frame)
    return id
  }

  /** 与固件 responder.c read_frame_buffered 同一套自愈逻辑:帧内容层面的错误
   * (坏 magic/version、payload_len 越界、CRC 不符)一律视为字节流失步,扫下一个
   * MAGIC 重新对帧后继续收,绝不抛错——以前这里直接 throw,一个坏帧头就把
   * rxBuffer 卡成永久错误,之后所有请求(包括判活)都立刻死于同一个残头。 */
  async recvFrame (): Promise<Frame> {
    try {
      return await this.recvFrameInner()
    } catch (error) {
      // 读超时/传输失败:缓冲里的半截帧已不可信——断帧的前缀带着真 MAGIC,
      // 后续字节会恰好补进 plen 字段拼出"看似合法"的巨长帧头,resync 识别
      // 不了,只会一轮轮空等超时(对齐固件的 FRAME_STALE 整体丢弃)
      this.rxLength = 0
      throw error
    }
  }

  private async recvFrameInner (): Promise<Frame> {
    for (;;) {
      while (this.rxLength < HEADER_SIZE) {
        await this.readSome(HEADER_SIZE - this.rxLength)
      }

      const dv = new DataView(this.rxBuffer.buffer, 0, this.rxLength)
      if (dv.getUint32(0, true) !== MAGIC || dv.getUint16(4, true) !== VERSION) {
        this.resyncToMagic()
        continue
      }
      const payloadLen = dv.getUint32(16, true)
      if (payloadLen > MAX_PAYLOAD) {
        this.resyncToMagic()
        continue
      }

      const frameLen = HEADER_SIZE + payloadLen
      while (this.rxLength < frameLen) {
        await this.readSome(frameLen - this.rxLength)
      }

      let frame: Frame
      try {
        frame = decodeFrame(this.rxBuffer.subarray(0, frameLen))
      } catch {
        this.resyncToMagic()
        continue
      }
      this.consumeRx(frameLen)
      logUsbProtocolFrame('RX', frame)
      return frame
    }
  }

  /** 失步自愈:从偏移 1 起找下一个 MAGIC(小端 53 41 50 45),丢弃它之前的字节;
   * 找不到时保留末尾至多 3 字节(可能是跨读边界的半个 MAGIC)。 */
  private resyncToMagic (): void {
    const buf = this.rxBuffer
    for (let i = 1; i + 4 <= this.rxLength; i++) {
      if (buf[i] === 0x53 && buf[i + 1] === 0x41 && buf[i + 2] === 0x50 && buf[i + 3] === 0x45) {
        this.consumeRx(i)
        return
      }
    }
    const keep = Math.min(3, Math.max(0, this.rxLength - 1))
    this.consumeRx(this.rxLength - keep)
  }

  private consumeRx (n: number): void {
    this.rxLength -= n
    if (this.rxLength > 0) {
      this.rxBuffer.copyWithin(0, n, n + this.rxLength)
    }
  }

  /** WebUSB 的 transfer 没有超时也无法单独取消;挂起太久时只能 reset 整个
   * 设备来解除(顺带清掉设备端协议状态,下次连接即恢复),然后抛错。 */
  private async withTimeout<T> (p: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.device.reset().then(
          () => {
            // reset 成功 = 设备协议状态清零、在途传输已取消,宿主缓冲里的
            // 残帧一并作废;不清的话下个请求会把残头当帧解析,连接就废了
            this.rxLength = 0
          },
          () => { /* 尽力而为 */ },
        )
        reject(new Error(`USB ${label} 超时(${this.timeout / 1000}s),已 reset 设备`))
      }, this.timeout)
    })
    try {
      return await Promise.race([p, timeoutP])
    } finally {
      clearTimeout(timer)
    }
  }

  private async writeAll (data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      const chunk = data.slice(offset, offset + USB_REQUEST_CHUNK)
      const result = await this.withTimeout(this.device.transferOut(this.epOut, chunk), 'write')
      if (result.status !== 'ok') {
        throw new Error(`USB write failed: ${result.status}`)
      }
      offset += result.bytesWritten
    }
    // 帧总长为端点最大包整数倍时补零长包(ZLP)通知设备传输结束:否则设备端
    // read() 收不到短包会一直等,请求帧挂在内核里、设备不应答。与 pyhost
    // client.py 和设备端 write_zlp 对齐。
    if (data.length % this.epOutPacketSize === 0) {
      try {
        await this.withTimeout(this.device.transferOut(this.epOut, new Uint8Array(0)), 'write-zlp')
      } catch {
        // ZLP 补发失败不致命,尽力而为(与 pyhost 一致)
      }
    }
  }

  /** 读入若干字节。needed 是当前还缺的字节数,请求量按它向上取整到 IN 端点
   * 包大小——设备只在写长度非包整数倍(短包)或帧总长整除 64(补 ZLP)时才产生
   * 传输边界;payload 恰为 64 整数倍时流停在整包上,固定请求 16KiB 会永远
   * 收不满(下载 4KB/8KB 文件、stdout 恰 44 字节等必卡到超时)。按需请求则
   * URB 收满即完成,不依赖短包,与 pyhost 的读法一致。 */
  private async readSome (needed: number): Promise<void> {
    if (!this.pendingRead) {
      // 上次超时遗留的 transferIn 可能仍挂在内核队列里,设备下一批数据会先
      // 落进它;必须复用等它完成,再发一个只会两边互相偷字节、永久失步
      const mps = this.epInPacketSize
      const want = Math.min(USB_REQUEST_CHUNK, Math.ceil(Math.max(needed, 1) / mps) * mps)
      const p = this.device.transferIn(this.epIn, want).then(
        result => {
          this.pendingRead = null
          if (result.status !== 'ok' || !result.data) {
            throw new Error(`USB read failed: ${result.status}`)
          }
          this.appendRx(new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength))
        },
        (error: unknown) => {
          this.pendingRead = null
          throw error
        },
      )
      p.catch(() => { /* 超时放弃等待后无人接住 rejection 的兜底 */ })
      this.pendingRead = p
    }
    await this.withTimeout(this.pendingRead, 'read')
  }

  private appendRx (data: Uint8Array): void {
    if (this.rxLength + data.length > this.rxBuffer.length) {
      const newBuf = new Uint8Array(this.rxBuffer.length * 2)
      newBuf.set(this.rxBuffer.subarray(0, this.rxLength))
      this.rxBuffer = newBuf
    }
    this.rxBuffer.set(data, this.rxLength)
    this.rxLength += data.length
  }
}
