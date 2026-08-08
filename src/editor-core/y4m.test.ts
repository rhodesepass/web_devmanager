import { describe, expect, it } from 'vitest'
import { buildY4mHeader, FRAME_MARKER, i420FrameSize, rgbaToI420 } from './y4m'

function solidRgba (width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r
    out[i + 1] = g
    out[i + 2] = b
    out[i + 3] = 255
  }
  return out
}

describe('y4m 头', () => {
  it('360x640@60 头字符串', () => {
    expect(new TextDecoder().decode(buildY4mHeader(360, 640)))
      .toBe('YUV4MPEG2 W360 H640 F60:1 Ip A1:1 C420mpeg2\n')
  })

  it('FRAME 分隔符', () => {
    expect(new TextDecoder().decode(FRAME_MARKER)).toBe('FRAME\n')
  })

  it('奇数尺寸报错', () => {
    expect(() => buildY4mHeader(361, 640)).toThrow('偶数')
  })

  it('帧载荷大小 = w*h*1.5', () => {
    expect(i420FrameSize(360, 640)).toBe(360 * 640 * 1.5)
    expect(i420FrameSize(720, 1280)).toBe(720 * 1280 * 1.5)
  })
})

describe('rgbaToI420 (BT.601 limited)', () => {
  it('纯黑 → Y=16, U=V=128', () => {
    const out = rgbaToI420(solidRgba(4, 4, 0, 0, 0), 4, 4)
    expect(out[0]).toBe(16)
    expect(out[16]).toBe(128)
    expect(out[20]).toBe(128)
  })

  it('纯白 → Y=235, U=V≈128', () => {
    const out = rgbaToI420(solidRgba(4, 4, 255, 255, 255), 4, 4)
    expect(out[0]).toBe(235)
    expect(Math.abs(out[16] - 128)).toBeLessThanOrEqual(1)
    expect(Math.abs(out[20] - 128)).toBeLessThanOrEqual(1)
  })

  it('纯红 → Y≈82, V≈240', () => {
    const out = rgbaToI420(solidRgba(4, 4, 255, 0, 0), 4, 4)
    expect(Math.abs(out[0] - 82)).toBeLessThanOrEqual(1)
    expect(Math.abs(out[16 + 4] - 240)).toBeLessThanOrEqual(1)
  })

  it('色度 2x2 平均：黑白棋盘的 U/V 居中、Y 保留原值', () => {
    const rgba = new Uint8ClampedArray(2 * 2 * 4)
    // (0,0) 白、(1,0) 黑、(0,1) 黑、(1,1) 白
    for (const [i, white] of [[0, true], [4, false], [8, false], [12, true]] as const) {
      const v = white ? 255 : 0
      rgba[i] = v
      rgba[i + 1] = v
      rgba[i + 2] = v
      rgba[i + 3] = 255
    }
    const out = rgbaToI420(rgba, 2, 2)
    expect(out[0]).toBe(235)
    expect(out[1]).toBe(16)
    expect(out[2]).toBe(16)
    expect(out[3]).toBe(235)
    // 平均灰 127.5 的 U/V 都应在 128 附近
    expect(Math.abs(out[4] - 128)).toBeLessThanOrEqual(1)
    expect(Math.abs(out[5] - 128)).toBeLessThanOrEqual(1)
  })

  it('输出布局 Y 平面在前、U/V 各占 1/4', () => {
    const out = rgbaToI420(solidRgba(8, 8, 10, 20, 30), 8, 8)
    expect(out.length).toBe(8 * 8 * 1.5)
  })
})
