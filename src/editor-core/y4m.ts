/**
 * y4m（YUV4MPEG2）流生成：RGBA → I420（BT.601 limited range，与 ffmpeg
 * 默认 RGB→yuv420p 转换一致），逐帧拼 FRAME 块。
 */

const encoder = new TextEncoder()

export const FRAME_MARKER = encoder.encode('FRAME\n')

/** C420mpeg2 = MPEG-2 色度对位，对应 H.264 常规 4:2:0 */
export function buildY4mHeader (width: number, height: number, fps = 60): Uint8Array {
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`y4m 要求偶数尺寸: ${width}x${height}`)
  }
  return encoder.encode(
    `YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420mpeg2\n`,
  )
}

/** 一帧 I420 载荷大小（不含 FRAME 头） */
export function i420FrameSize (width: number, height: number): number {
  return width * height * 3 / 2
}

/**
 * RGBA → I420，BT.601 studio swing：
 *   Y = 16 + 0.257R + 0.504G + 0.098B
 *   U = 128 - 0.148R - 0.291G + 0.439B
 *   V = 128 + 0.439R - 0.368G - 0.071B
 * 色度按 2x2 块平均后下采样。alpha 忽略（渲染器已合成到黑底）。
 */
export function rgbaToI420 (
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  out?: Uint8Array,
): Uint8Array {
  const ySize = width * height
  const cSize = ySize / 4
  const dst = out ?? new Uint8Array(ySize + cSize * 2)
  if (dst.length < ySize + cSize * 2) {
    throw new Error('I420 输出 buffer 太小')
  }

  for (let row = 0; row < height; row++) {
    let src = row * width * 4
    let dstY = row * width
    for (let col = 0; col < width; col++, src += 4, dstY++) {
      const r = rgba[src]
      const g = rgba[src + 1]
      const b = rgba[src + 2]
      dst[dstY] = clampByte(16 + 0.257 * r + 0.504 * g + 0.098 * b)
    }
  }

  const uBase = ySize
  const vBase = ySize + cSize
  const halfW = width / 2
  for (let cy = 0; cy < height / 2; cy++) {
    for (let cx = 0; cx < halfW; cx++) {
      let r = 0
      let g = 0
      let b = 0
      const px = cx * 2
      const py = cy * 2
      for (const [dx, dy] of BLOCK_2X2) {
        const i = ((py + dy) * width + px + dx) * 4
        r += rgba[i]
        g += rgba[i + 1]
        b += rgba[i + 2]
      }
      r /= 4
      g /= 4
      b /= 4
      const ci = cy * halfW + cx
      dst[uBase + ci] = clampByte(128 - 0.148 * r - 0.291 * g + 0.439 * b)
      dst[vBase + ci] = clampByte(128 + 0.439 * r - 0.368 * g - 0.071 * b)
    }
  }
  return dst
}

const BLOCK_2X2: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]]

function clampByte (v: number): number {
  return v < 0 ? 0 : (v > 255 ? 255 : Math.round(v))
}
