import { describe, expect, it } from 'vitest'
import { normalizeCfrStts } from './mp4Verify'

function box (type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  new DataView(out.buffer).setUint32(0, out.length)
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.codePointAt(i)!
  }
  out.set(payload, 8)
  return out
}

function concatBytes (...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

function u32s (...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  for (const [i, v] of values.entries()) {
    view.setUint32(i * 4, v)
  }
  return out
}

/** 最小化 moov：只含 normalizeCfrStts 所需的 box 路径 */
function buildFakeMp4 (sttsEntries: [count: number, delta: number][], mdhdDuration: number): Uint8Array {
  const hdlr = box('hdlr', concatBytes(u32s(0, 0), new TextEncoder().encode('vide'), u32s(0, 0, 0)))
  // mdhd v0: version/flags, creation, modification, timescale, duration
  const mdhd = box('mdhd', u32s(0, 0, 0, 15_360, mdhdDuration))
  const stts = box('stts', u32s(0, sttsEntries.length, ...sttsEntries.flat()))
  const stbl = box('stbl', stts)
  const minf = box('minf', stbl)
  const mdia = box('mdia', concatBytes(hdlr, mdhd, minf))
  const trak = box('trak', mdia)
  return box('moov', trak)
}

function readSttsDeltas (data: Uint8Array): number[] {
  // fake mp4 中 stts 载荷位置固定推导太脆，直接线性扫 'stts'
  let i = -1
  for (let k = 0; k < data.length - 4; k++) {
    if (data[k] === 0x73 && data[k + 1] === 0x74 && data[k + 2] === 0x74 && data[k + 3] === 0x73) {
      i = k
      break
    }
  }
  const view = new DataView(data.buffer)
  const count = view.getUint32(i + 8)
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    out.push(view.getUint32(i + 16 + k * 8))
  }
  return out
}

describe('normalizeCfrStts', () => {
  it('容差内的边界 delta 被归一为主流值并回写 mdhd duration', () => {
    const data = buildFakeMp4([[249, 256], [1, 261], [50, 256]], 64_005 + 12_800)
    expect(normalizeCfrStts(data)).toBe(true)
    expect(readSttsDeltas(data)).toEqual([256, 256, 256])
  })

  it('单条目不动', () => {
    const data = buildFakeMp4([[300, 256]], 76_800)
    expect(normalizeCfrStts(data)).toBe(false)
  })

  it('全部等值多条目不动', () => {
    const data = buildFakeMp4([[100, 256], [200, 256]], 76_800)
    expect(normalizeCfrStts(data)).toBe(false)
  })

  it('超容差（真 VFR）不动', () => {
    const data = buildFakeMp4([[100, 256], [100, 512]], 76_800)
    expect(normalizeCfrStts(data)).toBe(false)
    expect(readSttsDeltas(data)).toEqual([256, 512])
  })
})
