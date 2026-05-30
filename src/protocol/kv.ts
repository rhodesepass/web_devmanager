const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeKv (items: [string, string][]): Uint8Array {
  let size = 2 // u16 count
  const encoded: [Uint8Array, Uint8Array][] = []

  for (const [k, v] of items) {
    const kb = encoder.encode(k)
    const vb = encoder.encode(v)
    encoded.push([kb, vb])
    size += 4 + kb.length + vb.length
  }

  const buf = new Uint8Array(size)
  const dv = new DataView(buf.buffer)

  dv.setUint16(0, items.length, true)

  let offset = 2
  for (const [kb, vb] of encoded) {
    dv.setUint16(offset, kb.length, true)
    dv.setUint16(offset + 2, vb.length, true)
    offset += 4
    buf.set(kb, offset)
    offset += kb.length
    buf.set(vb, offset)
    offset += vb.length
  }

  return buf
}

export function decodeKv (data: Uint8Array): Record<string, string> {
  if (data.length < 2) {
    throw new Error('KV data too short')
  }

  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = dv.getUint16(0, true)
  const result: Record<string, string> = {}

  let offset = 2
  for (let i = 0; i < count; i++) {
    if (offset + 4 > data.length) {
      throw new Error(`KV truncated at pair ${i}`)
    }
    const kLen = dv.getUint16(offset, true)
    const vLen = dv.getUint16(offset + 2, true)
    offset += 4

    if (offset + kLen + vLen > data.length) {
      throw new Error(`KV truncated reading pair ${i} values`)
    }

    const key = decoder.decode(data.slice(offset, offset + kLen))
    offset += kLen
    const value = decoder.decode(data.slice(offset, offset + vLen))
    offset += vLen

    result[key] = value
  }

  if (offset !== data.length) {
    throw new Error('KV trailing junk bytes')
  }

  return result
}
