import type { OpenedUsb } from './usbFlash'
import { FEL_USB_TIMEOUT_MS, MAX_BULK_CHUNK } from './constants'

const USB_WRITE_REQUEST = 0x12
const USB_READ_REQUEST = 0x11

const FEL_VERIFY = 0x0_01
const FEL_WRITE = 0x1_01
const FEL_EXEC = 0x1_02
const FEL_READ = 0x1_03

const IN_SENTINEL = 0xA5

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
    await this.bulkSend(this.epOut, payload, true)
    await this.readUsbResponse()
  }

  private async usbRead (length: number): Promise<Uint8Array> {
    await this.sendAwuc(USB_READ_REQUEST, length)
    const data = await this.bulkReceive(this.epIn, length)
    await this.readUsbResponse()
    return data
  }

  private async sendAwuc (type: number, length: number): Promise<void> {
    await this.bulkSend(this.epOut, buildAwuc(type, length), true)
  }

  private async readUsbResponse (): Promise<void> {
    const resp = new Uint8Array(13)
    const received = await this.bulkReceiveTolerant(this.epIn, resp)
    if (received >= 4) {
      const magic = String.fromCodePoint(...resp.subarray(0, 4))
      if (magic !== 'AWUS') {
        throw new Error(`Unexpected FEL response magic: ${magic}`)
      }
    } else {
      throw new Error('FEL AWUS response missing; device did not acknowledge the previous USB request')
    }
  }

  private async bulkSend (
    endpoint: number,
    data: Uint8Array,
    allowFalseNegative = false,
  ): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      const chunk = Math.min(MAX_BULK_CHUNK, data.length - offset)
      const buf = offset === 0 && chunk === data.length
        ? data
        : data.subarray(offset, offset + chunk)
      const result = await this.opened.device.transferOut(endpoint, buf as BufferSource)
      if (result.status !== 'ok' || result.bytesWritten === 0) {
        if (allowFalseNegative) {
          offset += chunk
          continue
        }
        throw new Error(`FEL usb bulk send failed: ${result.status}`)
      }
      offset += result.bytesWritten
    }
  }

  private async bulkReceive (endpoint: number, size: number): Promise<Uint8Array> {
    const out = new Uint8Array(size)
    let offset = 0
    while (offset < size) {
      const want = Math.min(MAX_BULK_CHUNK, size - offset)
      const buf = new Uint8Array(want).fill(IN_SENTINEL)
      const result = await this.opened.device.transferIn(endpoint, want)
      if (result.status !== 'ok' || !result.data) {
        if (want <= 64 && buf.some(b => b !== IN_SENTINEL)) {
          out.set(buf, offset)
          offset += want
          continue
        }
        throw new Error(`FEL usb bulk receive failed: ${result.status}`)
      }
      const chunk = new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength,
      )
      out.set(chunk.subarray(0, Math.min(chunk.length, size - offset)), offset)
      offset += chunk.length
    }
    return out
  }

  private async bulkReceiveTolerant (endpoint: number, out: Uint8Array): Promise<number> {
    let offset = 0
    let falseNegativeUsed = false
    while (offset < out.length) {
      const want = Math.min(MAX_BULK_CHUNK, out.length - offset)
      const buf = new Uint8Array(want).fill(IN_SENTINEL)
      const result = await this.opened.device.transferIn(endpoint, want)
      if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) {
        if (want <= 64 && buf.some(b => b !== IN_SENTINEL)) {
          out.set(buf, offset)
          offset += want
          continue
        }
        if (falseNegativeUsed) {
          return offset
        }
        falseNegativeUsed = true
        continue
      }
      const chunk = new Uint8Array(
        result.data.buffer,
        result.data.byteOffset,
        result.data.byteLength,
      )
      out.set(chunk.subarray(0, Math.min(chunk.length, out.length - offset)), offset)
      offset += chunk.length
    }
    return offset
  }
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
