/**
 * clip 切点过渡的纯数学，预览（Konva）与导出（OfflineRenderer）共用保证一致。
 *
 * dip（闪黑/闪白）：全画布色板叠加画在所有轨道之上——不侵入相邻 clip 的绘制路径，
 * 段首/前有空隙/多轨等边界全部自动成立；切点处 alpha=1 天然盖住底下的硬切。
 * crossfade：前段冻结尾帧 ×(1-p) 画在本 clip 下方 + 本 clip ×p；
 * 无首尾相接的前 clip 时冻结层缺席，退化为从黑渐入。
 */

import type { ClipTrack } from './model'

/** 切点两侧对称三角形：|t-cut| <= D/2 内 alpha = 1 - |t-cut|/(D/2)，窗外 0。
 * 窗口越出段首尾只裁剪，峰值恒 1（loop 段首 cut=0 时正好盖循环接缝）。 */
export function dipAlpha (tUs: number, cutUs: number, durationUs: number): number {
  const half = durationUs / 2
  if (half <= 0) {
    return 0
  }
  const dist = Math.abs(tUs - cutUs)
  if (dist >= half) {
    return 0
  }
  return 1 - dist / half
}

/** crossfade 进度：t ∈ [cut, cut+D) 返回 p ∈ [0,1)，区间外返回 null（不在交叠期） */
export function crossfadeProgress (tUs: number, cutUs: number, durationUs: number): number | null {
  if (durationUs <= 0 || tUs < cutUs || tUs >= cutUs + durationUs) {
    return null
  }
  return (tUs - cutUs) / durationUs
}

export interface DipOverlay {
  color: '#000000' | '#FFFFFF'
  alpha: number
}

/** 汇总一帧的全画布 dip 叠加：同色取 max，最多黑白各一条 */
export function collectDipOverlays (tracks: readonly ClipTrack[], tUs: number): DipOverlay[] {
  let black = 0
  let white = 0
  for (const track of tracks) {
    for (const clip of track.clips) {
      const t = clip.transitionIn
      if (!t || t.type === 'crossfade') {
        continue
      }
      const alpha = dipAlpha(tUs, clip.startUs, t.durationUs)
      if (alpha <= 0) {
        continue
      }
      if (t.type === 'dipToBlack') {
        black = Math.max(black, alpha)
      } else {
        white = Math.max(white, alpha)
      }
    }
  }
  const out: DipOverlay[] = []
  if (black > 0) {
    out.push({ color: '#000000', alpha: black })
  }
  if (white > 0) {
    out.push({ color: '#FFFFFF', alpha: white })
  }
  return out
}
