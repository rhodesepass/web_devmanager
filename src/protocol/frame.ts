import { MAGIC, VERSION, HEADER_SIZE } from './constants'
import { crc32 } from './crc32'
import type { MsgType } from './constants'
import type { Frame } from './types'

export function encodeFrame (
  type: MsgType,
  requestId: number,
  payload: Uint8Array<ArrayBufferLike>,
  flags = 0,
): Uint8Array {
  const buf = new Uint8Array(HEADER_SIZE + payload.length)
  const dv = new DataView(buf.buffer)

  dv.setUint32(0, MAGIC, true)
  dv.setUint16(4, VERSION, true)
  dv.setUint16(6, type, true)
  dv.setUint32(8, flags, true)
  dv.setUint32(12, requestId, true)
  dv.setUint32(16, payload.length, true)
  dv.setUint32(20, crc32(payload), true)
  buf.set(payload, HEADER_SIZE)

  return buf
}

export function decodeFrame (buf: Uint8Array): Frame {
  if (buf.length < HEADER_SIZE) {
    throw new Error(`frame too short: ${buf.length} < ${HEADER_SIZE}`)
  }

  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

  const magic = dv.getUint32(0, true)
  if (magic !== MAGIC) {
    throw new Error(`bad magic: 0x${magic.toString(16)}`)
  }

  const version = dv.getUint16(4, true)
  if (version !== VERSION) {
    throw new Error(`bad version: ${version}`)
  }

  const type = dv.getUint16(6, true) as MsgType
  const flags = dv.getUint32(8, true)
  const requestId = dv.getUint32(12, true)
  const payloadLen = dv.getUint32(16, true)
  const payloadCrc = dv.getUint32(20, true)

  if (buf.length < HEADER_SIZE + payloadLen) {
    throw new Error(`incomplete frame: need ${HEADER_SIZE + payloadLen}, got ${buf.length}`)
  }

  const payload = buf.slice(HEADER_SIZE, HEADER_SIZE + payloadLen)

  if (payload.length > 0) {
    const actualCrc = crc32(payload)
    if (actualCrc !== payloadCrc) {
      throw new Error(`CRC mismatch: expected 0x${payloadCrc.toString(16)}, got 0x${actualCrc.toString(16)}`)
    }
  }

  return { type, requestId, flags, payload }
}
