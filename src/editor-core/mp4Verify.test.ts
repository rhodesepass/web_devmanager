import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { verifyMp4 } from './mp4Verify'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

function fixture (name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, name)))
}

describe('verifyMp4', () => {
  it('合规产物通过并给出正确摘要', () => {
    const result = verifyMp4(fixture('good.mp4'))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    const s = result.summary!
    expect(s.width).toBe(360)
    expect(s.height).toBe(640)
    expect(s.codec).toBe('avc1')
    expect(s.fps).toBeCloseTo(60, 1)
    expect(s.sampleCount).toBe(30)
    expect(s.avcCSize).toBeGreaterThan(0)
    expect(s.avcCSize).toBeLessThan(64 * 1024)
    expect(s.maxSampleSize).toBeGreaterThan(0)
  })

  it('拒绝带旋转元数据的产物', () => {
    const result = verifyMp4(fixture('rotated.mp4'))
    expect(result.ok).toBe(false)
    expect(result.errors.join(',')).toContain('旋转')
  })

  it('拒绝非 H.264 编码', () => {
    const result = verifyMp4(fixture('mp4v.mp4'))
    expect(result.ok).toBe(false)
    expect(result.errors.join(',')).toContain('H.264')
  })

  it('拒绝 fragmented MP4', () => {
    const result = verifyMp4(fixture('frag.mp4'))
    expect(result.ok).toBe(false)
    expect(result.errors.join(',')).toContain('fragmented')
  })

  it('拒绝非 MP4 数据', () => {
    const result = verifyMp4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(result.ok).toBe(false)
    expect(result.errors.join(',')).toContain('moov')
  })
})
