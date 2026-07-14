export interface DispImgInfo {
  name: string
  sizeBytes: number
  /** 懒加载生成的预览 objectURL，未加载时为 null */
  thumbUrl: string | null
  /** 预览加载后解析出的实际像素宽/高，未知时为 null */
  width: number | null
  height: number | null
}

export interface DispImgTransferProgress {
  fileName: string
  bytes: number
  total: number
  isUpload: boolean
}

export interface DispImgResolution {
  value: string
  label: string
  width: number
  height: number
}

/** 设备上扩列图目录（相对路径，与素材的 assets 同级） */
export const DISP_IMG_DIR = 'dispimg'

/** 裁剪框固定竖屏比例，两种成品分辨率都是 9:16 */
export const DISP_IMG_ASPECT = 9 / 16

export const DISP_IMG_JPEG_QUALITY = 0.9

export const DISP_IMG_RESOLUTIONS: DispImgResolution[] = [
  { value: '360x640', label: '360 × 640（标准）', width: 360, height: 640 },
  { value: '720x1280', label: '720 × 1280（高清）', width: 720, height: 1280 },
]

/** 按宽度就近归档到预设分辨率，返回档位宽度（360 / 720）；未知返回 null */
export function nearestDispImgWidth (width: number | null): number | null {
  if (!width || width <= 0) {
    return null
  }
  return DISP_IMG_RESOLUTIONS.reduce(
    (best, r) => (Math.abs(r.width - width) < Math.abs(best - width) ? r.width : best),
    DISP_IMG_RESOLUTIONS[0].width,
  )
}
