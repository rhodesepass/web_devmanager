import { encodeFrame, decodeFrame, HEADER_SIZE, MAX_PAYLOAD, MsgType } from '@/protocol'
import { USB_REQUEST_CHUNK, DEFAULT_TIMEOUT } from './constants'
import type { Frame } from '@/protocol'

export type DisconnectCallback = () => void

export class UsbTransport {
  private device!: USBDevice
  private epIn = 0x81
  private epOut = 0x02
  private rxBuffer = new Uint8Array(1024 * 1024)
  private rxLength = 0
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
    await this.device.selectConfiguration(1)
    await this.device.claimInterface(0)

    const iface = this.device.configuration?.interfaces[0]
    if (iface) {
      for (const ep of iface.alternate.endpoints) {
        if (ep.direction === 'in') this.epIn = ep.endpointNumber
        if (ep.direction === 'out') this.epOut = ep.endpointNumber
      }
    }

    this.rxLength = 0
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
    const frame = encodeFrame(type, id, payload)
    await this.writeAll(frame)
    return id
  }

  async recvFrame (): Promise<Frame> {
    while (this.rxLength < HEADER_SIZE) {
      await this.readSome()
    }

    const dv = new DataView(this.rxBuffer.buffer, 0, this.rxLength)
    const payloadLen = dv.getUint32(16, true)

    if (payloadLen > MAX_PAYLOAD) {
      throw new Error(`payload too large: ${payloadLen}`)
    }

    const frameLen = HEADER_SIZE + payloadLen
    while (this.rxLength < frameLen) {
      await this.readSome()
    }

    const frameBuf = this.rxBuffer.slice(0, frameLen)
    this.rxLength -= frameLen
    if (this.rxLength > 0) {
      this.rxBuffer.copyWithin(0, frameLen, frameLen + this.rxLength)
    }

    return decodeFrame(frameBuf)
  }

  private async writeAll (data: Uint8Array): Promise<void> {
    let offset = 0
    while (offset < data.length) {
      const chunk = data.slice(offset, offset + USB_REQUEST_CHUNK)
      const result = await this.device.transferOut(this.epOut, chunk)
      if (result.status !== 'ok') {
        throw new Error(`USB write failed: ${result.status}`)
      }
      offset += result.bytesWritten
    }
  }

  private async readSome (): Promise<void> {
    const result = await this.device.transferIn(this.epIn, USB_REQUEST_CHUNK)
    if (result.status !== 'ok' || !result.data) {
      throw new Error(`USB read failed: ${result.status}`)
    }

    const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)

    if (this.rxLength + data.length > this.rxBuffer.length) {
      const newBuf = new Uint8Array(this.rxBuffer.length * 2)
      newBuf.set(this.rxBuffer.subarray(0, this.rxLength))
      this.rxBuffer = newBuf
    }

    this.rxBuffer.set(data, this.rxLength)
    this.rxLength += data.length
  }
}
