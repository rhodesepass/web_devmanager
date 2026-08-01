import type { OpenedUsb } from './usbFlash'
import { FEL_USB_TIMEOUT_MS, MAX_BULK_CHUNK } from './constants'
import { reopenFel, resetFelDevice } from './usbFlash'

const USB_WRITE_REQUEST = 0x12
const USB_READ_REQUEST = 0x11

const FEL_VERIFY = 0x0_01
const FEL_WRITE = 0x1_01
const FEL_EXEC = 0x1_02
const FEL_READ = 0x1_03

/**
 * BROM bulk 端点的最大包长（USB2 高速 = 512）。IN 请求只能比它**大**不能比它小，
 * 所以即使设备退到全速（64）用 512 也是安全的。
 */
const FEL_PACKET_SIZE = 512

/** 单笔 transferOut 的上限。取整包倍数，太大的 URB 在部分主机上会直接报 transfer error。 */
const FEL_OUT_CHUNK = 8 * FEL_PACKET_SIZE

/** exec 返回后 BROM 需要一点时间回到 FEL 收发循环，紧跟着发大块数据容易出错 */
const EXEC_SETTLE_MS = 30

function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface FelVersion {
  id: number
  firmware: number
  protocol: number
  dflag: number
  dlength: number
  scratchpad: number
}

export class FelClient {
  private epIn: number
  private epOut: number

  constructor (
    private readonly opened: OpenedUsb,
    private readonly timeoutMs = FEL_USB_TIMEOUT_MS,
  ) {
    if (opened.epIn == null || opened.epOut == null) {
      throw new Error('FEL 缺少 BULK 端点')
    }
    this.epIn = opened.epIn
    this.epOut = opened.epOut
  }

  get device (): USBDevice {
    return this.opened.device
  }

  async version (): Promise<FelVersion> {
    await this.sendFelRequest(FEL_VERIFY, 0, 0)
    const versionBuf = await this.usbRead(32)
    await this.readFelStatus()
    const dv = new DataView(versionBuf.buffer, versionBuf.byteOffset, versionBuf.byteLength)
    return {
      id: dv.getUint32(8, true),
      firmware: dv.getUint32(12, true),
      protocol: dv.getUint16(16, true),
      dflag: dv.getUint8(18),
      dlength: dv.getUint8(19),
      scratchpad: dv.getUint32(20, true),
    }
  }

  async exec (address: number): Promise<void> {
    await this.sendFelRequest(FEL_EXEC, address, 0)
    await this.readFelStatus()
    await sleep(EXEC_SETTLE_MS)
  }

  async read32 (address: number): Promise<number> {
    const raw = await this.read(address, 4)
    return new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true)
  }

  async write32 (address: number, value: number): Promise<void> {
    const data = new Uint8Array(4)
    new DataView(data.buffer).setUint32(0, value, true)
    await this.write(address, data)
  }

  async read (address: number, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length)
    let offset = 0
    while (offset < length) {
      const chunk = Math.min(64 * 1024, length - offset)
      await this.sendFelRequest(FEL_READ, address + offset, chunk)
      const data = await this.usbRead(chunk)
      await this.readFelStatus()
      out.set(data, offset)
      offset += chunk
    }
    return out
  }

  async write (address: number, data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      const chunk = Math.min(64 * 1024, data.length - offset)
      await this.sendFelRequest(FEL_WRITE, address + offset, chunk)
      await this.usbWrite(data.subarray(offset, offset + chunk))
      await this.readFelStatus()
      offset += chunk
    }
  }

  private async sendFelRequest (type: number, address: number, length: number): Promise<void> {
    const payload = new Uint8Array(16)
    const dv = new DataView(payload.buffer)
    dv.setUint32(0, type, true)
    dv.setUint32(4, address, true)
    dv.setUint32(8, length, true)
    dv.setUint32(12, 0, true)
    await this.usbWrite(payload)
  }

  private async readFelStatus (): Promise<void> {
    await this.usbRead(8)
  }

  private async usbWrite (payload: Uint8Array): Promise<void> {
    await this.sendAwuc(USB_WRITE_REQUEST, payload.length)
    await this.bulkSend(this.epOut, payload)
    await this.readUsbResponse()
  }

  /**
   * 数据阶段的读。长度由前面的 AWUC 声明，设备一定只发这么多，所以按
   * 实际长度请求。
   */
  private async usbRead (length: number): Promise<Uint8Array> {
    await this.sendAwuc(USB_READ_REQUEST, length)
    const data = await this.bulkReceive(this.epIn, length)
    await this.readUsbResponse()
    return data
  }

  private async sendAwuc (type: number, length: number): Promise<void> {
    await this.bulkSend(this.epOut, buildAwuc(type, length))
  }

  private async readUsbResponse (): Promise<void> {
    const resp = await this.receiveShortPacket(13)
    const magic = String.fromCodePoint(...resp.subarray(0, 4))
    if (magic !== 'AWUS') {
      throw new Error(`FEL 应答错位（收到 magic=${JSON.stringify(magic)}），协议已失步`)
    }
  }

  private async bulkSend (endpoint: number, data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      const chunk = Math.min(FEL_OUT_CHUNK, data.length - offset)
      const buf = data.subarray(offset, offset + chunk)
      const result = await this.opened.device.transferOut(endpoint, buf as BufferSource)
      if (result.status !== 'ok') {
        throw new Error(`FEL usb bulk send failed: ${result.status}`)
      }
      if (result.bytesWritten === 0) {
        throw new Error('FEL usb bulk send failed: 主机侧一个字节都没送出')
      }
      offset += result.bytesWritten
    }
  }

  /**
   * 请求长度**向上取整到整包**：WebUSB 下请求字节数小于设备实际发出的包长
   * 会被 Chrome 判为 babble 并作废整笔传输，之后管线再也对不齐。数据阶段
   * 的总长由 AWUC 声明，设备不会多发，所以多请求不会挂住也不会收到多余字节。
   */
  private async bulkReceive (endpoint: number, size: number): Promise<Uint8Array> {
    const out = new Uint8Array(size)
    let offset = 0
    let emptyRounds = 0
    while (offset < size) {
      const remain = size - offset
      const want = Math.min(
        MAX_BULK_CHUNK,
        Math.ceil(remain / FEL_PACKET_SIZE) * FEL_PACKET_SIZE,
      )
      const result = await this.opened.device.transferIn(endpoint, want)
      if (result.status !== 'ok' || !result.data) {
        throw new Error(`FEL usb bulk receive failed: ${result.status}`)
      }
      const chunk = new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength,
      )
      if (chunk.length === 0) {
        // 设备补的 ZLP，吞掉重读；连续空包说明对面已经不发了
        if (++emptyRounds > 4) {
          throw new Error('FEL usb bulk receive failed: 设备只回空包')
        }
        continue
      }
      emptyRounds = 0
      out.set(chunk.subarray(0, Math.min(chunk.length, size - offset)), offset)
      offset += chunk.length
    }
    return out
  }

  /**
   * 读 AWUS(13B)/FEL status(8B) 这类定长小包。**必须按整包长度请求**：
   * WebUSB 下如果请求字节数小于设备实际发出的包长，Chrome 会直接判 babble
   * 并把这笔传输作废，之后管线就再也对不齐了。设备发的是短包，多请求不会挂住。
   */
  private async receiveShortPacket (size: number): Promise<Uint8Array> {
    let emptyRounds = 0
    for (;;) {
      const result = await this.opened.device.transferIn(this.epIn, FEL_PACKET_SIZE)
      if (result.status !== 'ok' || !result.data) {
        throw new Error(`FEL usb bulk receive failed: ${result.status}`)
      }
      const chunk = new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength,
      )
      if (chunk.length === 0) {
        if (++emptyRounds > 4) {
          throw new Error('FEL 应答缺失：设备没有确认上一笔 USB 请求')
        }
        continue
      }
      if (chunk.length < size) {
        throw new Error(`FEL 应答长度不足（${chunk.length}/${size}），协议已失步`)
      }
      return chunk.subarray(0, size)
    }
  }
}

/**
 * FEL 传输出错后的恢复。
 *
 * close + clearHalt 只动主机侧，BROM 里那台协议状态机不受影响：一笔
 * AWUC 声明了 N 字节数据阶段却没收够，它就会继续把后面来的字节（也就是
 * 下一条命令的 AWUC 头）当成剩余 payload 吃掉，从此每一笔都错位，表现
 * 就是 babble、magic 全 0。只有 USB 端口复位（等价拔插一次线）能让它
 * 回到干净状态，所以这里先 reset 再重开，最后用 version() 验一次同步。
 */
export async function recoverFelClient (
  opened: OpenedUsb | null,
  attempts = 2,
): Promise<{ opened: OpenedUsb, fel: FelClient }> {
  let lastError: unknown = null
  let current = opened
  for (let i = 0; i < attempts; i++) {
    let next: OpenedUsb
    try {
      next = await resetFelDevice(current)
    } catch {
      // reset 不被支持或设备刚好在重新枚举，退回纯重开
      next = await reopenFel()
    }
    current = null
    const fel = new FelClient(next)
    try {
      await fel.version()
      return { opened: next, fel }
    } catch (error: unknown) {
      lastError = error
      current = next
    }
  }
  throw new Error(
    `FEL 恢复失败，设备仍未回到可用状态：${lastError instanceof Error ? lastError.message : String(lastError)}`,
    { cause: lastError },
  )
}

function buildAwuc (type: number, length: number): Uint8Array {
  const req = new Uint8Array(32)
  const dv = new DataView(req.buffer)
  req.set([0x41, 0x57, 0x55, 0x43], 0) // AWUC
  dv.setUint32(8, length, true)
  dv.setUint32(12, 0x0c_00_00_00, true)
  dv.setUint16(16, type, true)
  dv.setUint32(18, length, true)
  return req
}
