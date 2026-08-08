import type { CanvasSize, Clip, ClipTrack, Easing, Keyframe } from './model'
import { clipEndUs } from './model'

/** 某一时刻一个 clip 的完整变换状态（预览 set 回 Konva、导出喂渲染器都用它） */
export interface TransformState {
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  opacity: number
}

const EASING_FN: Record<Easing, (p: number) => number> = {
  linear: p => p,
  easeIn: p => p * p * p,
  easeOut: p => 1 - (1 - p) ** 3,
  easeInOut: p => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2),
}

export function applyEasing (easing: Easing, progress: number): number {
  return EASING_FN[easing](progress)
}

/**
 * 二分：返回最后一个 t <= tUs 的关键帧下标；tUs 早于首帧返回 -1。
 * keyframes 必须按 t 升序。
 */
export function findKeyframeIndex (keyframes: readonly Keyframe[], tUs: number): number {
  let lo = 0
  let hi = keyframes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (keyframes[mid].t <= tUs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

function lerp (a: number, b: number, p: number): number {
  return a + (b - a) * p
}

function stateOf (kf: Keyframe): TransformState {
  return {
    x: kf.x,
    y: kf.y,
    rotation: kf.rotation,
    scaleX: kf.scaleX,
    scaleY: kf.scaleY,
    opacity: kf.opacity,
  }
}

/**
 * 采样 clip 在局部时刻 localUs（相对 clip 起点）的变换。
 * 首帧之前取首帧值、末帧之后取末帧值（钳制）；区间内按左端关键帧的 easing 插值。
 * rotation 是连续角度直接 lerp（0→720 就是转两圈），不做最短弧归一化。
 * 无关键帧返回 null（调用方回退 defaultTransform）。
 */
export function sampleClip (clip: Pick<Clip, 'keyframes'>, localUs: number): TransformState | null {
  const kfs = clip.keyframes
  if (kfs.length === 0) {
    return null
  }
  const i = findKeyframeIndex(kfs, localUs)
  if (i < 0) {
    return stateOf(kfs[0])
  }
  if (i >= kfs.length - 1) {
    return stateOf(kfs.at(-1)!)
  }
  const a = kfs[i]
  const b = kfs[i + 1]
  const span = b.t - a.t
  const progress = span <= 0 ? 1 : (localUs - a.t) / span
  const p = applyEasing(a.easing, progress)
  return {
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    rotation: lerp(a.rotation, b.rotation, p),
    scaleX: lerp(a.scaleX, b.scaleX, p),
    scaleY: lerp(a.scaleY, b.scaleY, p),
    opacity: lerp(a.opacity, b.opacity, p),
  }
}

/** 空关键帧 clip 的默认摆放（居中恒等），renderer 与 Konva 预览共用保证一致 */
export function defaultTransform (canvas: CanvasSize): TransformState {
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  }
}

/**
 * 落关键帧：同 t（容差 1us）覆盖，否则按 t 升序插入。返回新数组（不改原数组）。
 */
export function upsertKeyframe (keyframes: readonly Keyframe[], kf: Keyframe): Keyframe[] {
  const out = [...keyframes]
  const i = findKeyframeIndex(out, kf.t)
  if (i >= 0 && Math.abs(out[i].t - kf.t) <= 1) {
    out[i] = kf
    return out
  }
  out.splice(i + 1, 0, kf)
  return out
}

/**
 * 视频 clip：局部时刻 → 源素材时刻（speed 是比率拉伸的播放速率）。
 * 超出源末尾钳制到末尾 = 冻结尾帧（等价 v2 的 trimOut 钳制）；图片调用方直接传 0 不走这里。
 */
export function clipTimeToSourceTime (clip: Pick<Clip, 'trimInUs' | 'speed'>, localUs: number, sourceDurationUs: number): number {
  const end = Math.max(sourceDurationUs, clip.trimInUs)
  return Math.min(clip.trimInUs + Math.max(localUs, 0) * clip.speed, end)
}

/** 二分查活跃 clip：区间 [startUs, startUs+durationUs) 左闭右开；clips 按 startUs 升序 */
export function findActiveClip (track: ClipTrack, tUs: number): Clip | null {
  const clips = track.clips
  let lo = 0
  let hi = clips.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (clips[mid].startUs <= tUs) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (ans < 0) {
    return null
  }
  const clip = clips[ans]
  return tUs < clipEndUs(clip) ? clip : null
}

/** 时间轴上紧邻在 clip 之前且首尾相接（±1us 容差）的 clip；crossfade 找冻结源用 */
export function adjacentPrevClip (track: ClipTrack, clip: Clip): Clip | null {
  const i = track.clips.findIndex(c => c.id === clip.id)
  if (i <= 0) {
    return null
  }
  const prev = track.clips[i - 1]
  return Math.abs(clipEndUs(prev) - clip.startUs) <= 1 ? prev : null
}
