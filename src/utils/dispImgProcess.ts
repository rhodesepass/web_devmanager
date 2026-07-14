import { DISP_IMG_JPEG_QUALITY, type DispImgResolution } from '@/types/dispimg'

/**
 * 把 Cropper 裁出的画布重采样到目标分辨率并编码成 JPEG。
 * 裁剪框已锁定 9:16，这里只做缩放 + 编码，不再补黑边。
 */
export function encodeCroppedCanvas (
  cropped: HTMLCanvasElement,
  resolution: DispImgResolution,
  quality: number = DISP_IMG_JPEG_QUALITY,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = resolution.width
  canvas.height = resolution.height

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return Promise.reject(new Error('无法创建 2D 画布上下文'))
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // 黑底兜底：源若含透明像素，编码成 JPEG 时透明会变黑，这里显式填黑保证一致
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(cropped, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('JPEG 编码失败'))
        }
      },
      'image/jpeg',
      quality,
    )
  })
}

export function nextDispImgFileName (): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  const suffix = Date.now() % 1_000_000
  return `IMG_${ts}_${suffix}.jpg`
}

export function isJpegName (name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.jpg') || lower.endsWith('.jpeg')
}
