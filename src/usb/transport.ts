import { encodeFrame, decodeFrame, HEADER_SIZE, MAX_PAYLOAD, MsgType, logUsbProtocolFrame } from '@/protocol'
import { USB_REQUEST_CHUNK, DEFAULT_TIMEOUT } from './constants'
import type { Frame } from '@/protocol'

export type DisconnectCallback = () => void

export class UsbTransport {
  private device!: USBDevice
  private epIn = 0x81
  private epOut = 0x02
  private epOutPacketSize = 64
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
        if (ep.direction === 'in') this.epIn = ep.endpointNumber
        if (ep.direction === 'out') {
          this.epOut = ep.endpointNumber
          this.epOutPacketSize = ep.packetSize
        }
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
    logUsbProtocolFrame('TX', { type, requestId: id, flags: 0, payload })
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

    const frame = decodeFrame(frameBuf)
    logUsbProtocolFrame('RX', frame)
    return frame
  }

  /** WebUSB 的 transfer 没有超时也无法单独取消;挂起太久时只能 reset 整个
   * 设备来解除(顺带清掉设备端协议状态,下次连接即恢复),然后抛错。 */
  private async withTimeout<T> (p: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeoutP = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.device.reset().catch(() => { /* 尽力而为 */ })
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

  private async readSome (): Promise<void> {
    const result = await this.withTimeout(this.device.transferIn(this.epIn, USB_REQUEST_CHUNK), 'read')
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
