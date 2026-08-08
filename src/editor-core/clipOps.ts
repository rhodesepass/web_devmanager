/**
 * clip 编辑操作的纯函数层：切割/放置校验/边缘 resize，全部返回新对象不改入参。
 * 所有 mutation 必须经这里保证不变量（clips 按 startUs 升序、互不重叠）——
 * 自动保存走 serialize 的严格校验，恢复失败即丢工程，不变量破坏是灾难性的。
 */

import type { CanvasSize, Clip, ClipTrack, Keyframe } from './model'
import { defaultTransform, sampleClip } from './interpolate'
import { clipEndUs, MIN_CLIP_US, newId } from './model'

function sampledKeyframe (clip: Clip, localUs: number, easing: Keyframe['easing'], canvas: CanvasSize): Keyframe {
  const s = sampleClip(clip, localUs) ?? defaultTransform(canvas)
  return { t: localUs, ...s, easing }
}

/** 被跨越区间左端帧的 easing（切点前后各落一个采样帧时沿用，保持动画曲线观感） */
function easingAt (clip: Clip, localUs: number): Keyframe['easing'] {
  let easing: Keyframe['easing'] = 'linear'
  for (const kf of clip.keyframes) {
    if (kf.t > localUs) {
      break
    }
    easing = kf.easing
  }
  return easing
}

/**
 * 剪刀：atLocalUs ∈ (0, durationUs) 之外返回 null。
 * 左半保 id 与 transitionIn（切点在其右缘）；右半新 id、trimInUs 顺延、keyframes 重基、
 * transitionIn=null（新切点默认硬切）、effects 深拷贝（参数独立可调）。
 * 切点两侧各落一个采样关键帧，保证两半动画连续。
 */
export function splitClip (clip: Clip, atLocalUs: number, canvas: CanvasSize): [Clip, Clip] | null {
  if (atLocalUs <= 0 || atLocalUs >= clip.durationUs) {
    return null
  }
  const easing = easingAt(clip, atLocalUs)
  const cutKf = sampledKeyframe(clip, atLocalUs, easing, canvas)

  const leftKfs = clip.keyframes.filter(kf => kf.t < atLocalUs)
  leftKfs.push({ ...cutKf })

  const rightKfs: Keyframe[] = [{ ...cutKf, t: 0 }]
  for (const kf of clip.keyframes) {
    if (kf.t > atLocalUs) {
      rightKfs.push({ ...kf, t: kf.t - atLocalUs })
    }
  }

  const left: Clip = {
    ...clip,
    durationUs: atLocalUs,
    // 静态 clip 两半各保留一份静态值帧，不引入切点采样帧
    keyframes: clip.animated ? leftKfs : clip.keyframes.map(kf => ({ ...kf })),
    effects: clip.effects.map(fx => ({ ...fx, params: { ...fx.params } })),
  }
  const right: Clip = {
    id: newId('clip'),
    assetId: clip.assetId,
    startUs: clip.startUs + atLocalUs,
    durationUs: clip.durationUs - atLocalUs,
    // 源素材被消耗的量 = 时间轴时长 × 播放速率
    trimInUs: clip.trimInUs + Math.round(atLocalUs * clip.speed),
    speed: clip.speed,
    animated: clip.animated,
    keyframes: clip.animated ? rightKfs : clip.keyframes.map(kf => ({ ...kf, t: 0 })).slice(0, 1),
    effects: clip.effects.map(fx => ({ id: newId('fx'), type: fx.type, params: { ...fx.params } })),
    transitionIn: null,
  }
  return [left, right]
}

/** 放置合法性：忽略 ignoreClipId 后，[startUs, startUs+durationUs) 与轨内任何 clip 不相交 */
export function canPlaceClip (track: ClipTrack, startUs: number, durationUs: number, ignoreClipId?: string): boolean {
  if (startUs < 0 || durationUs <= 0) {
    return false
  }
  const endUs = startUs + durationUs
  for (const c of track.clips) {
    if (c.id === ignoreClipId) {
      continue
    }
    if (startUs < clipEndUs(c) && c.startUs < endUs) {
      return false
    }
  }
  return true
}

/** 追加落点：轨道末尾（最后 clip 结束点），空轨 0 */
export function appendPositionUs (track: ClipTrack): number {
  let max = 0
  for (const c of track.clips) {
    max = Math.max(max, clipEndUs(c))
  }
  return max
}

/**
 * 左缘 resize：右缘不动，newLeftUs 钳在合法区间内。
 * 视频左移余量 = 当前 trimInUs（不能读到源素材 0 之前）；图片自由（trimInUs 恒 0 不动）。
 * 关键帧重基 t = max(0, t - delta)：动画锚点跟随 clip 头（标准 NLE 行为），
 * 左扩时头部区间由首帧钳制采样自然补齐。
 */
export function resizeClipLeft (clip: Clip, newLeftUs: number, isVideo: boolean): Clip {
  const endUs = clipEndUs(clip)
  // 视频左扩余量：还能往前读 trimInUs/speed 的时间轴时长
  const minLeft = isVideo ? Math.max(0, clip.startUs - clip.trimInUs / clip.speed) : 0
  const left = Math.min(Math.max(newLeftUs, minLeft), endUs - MIN_CLIP_US)
  const delta = left - clip.startUs
  if (delta === 0) {
    return clip
  }
  const keyframes: Keyframe[] = []
  for (const kf of clip.keyframes) {
    const t = Math.max(0, kf.t - delta)
    // 重基后 t=0 处可能堆叠多帧，保留时间上最靠后的一帧（其余在 0 之前已无意义）
    if (keyframes.length > 0 && keyframes.at(-1)!.t === t) {
      keyframes[keyframes.length - 1] = { ...kf, t }
    } else {
      keyframes.push({ ...kf, t })
    }
  }
  return {
    ...clip,
    startUs: left,
    durationUs: endUs - left,
    trimInUs: isVideo ? Math.max(0, Math.round(clip.trimInUs + delta * clip.speed)) : 0,
    keyframes,
  }
}

/** 右缘 resize：只改 durationUs；视频允许超源剩余长度（冻结尾帧），下限 MIN_CLIP_US */
export function resizeClipRight (clip: Clip, newEndUs: number): Clip {
  const durationUs = Math.max(newEndUs - clip.startUs, MIN_CLIP_US)
  if (durationUs === clip.durationUs) {
    return clip
  }
  return { ...clip, durationUs }
}

/**
 * 比率拉伸（PR 的 Rate Stretch）：拖边缘改的不是 trim 而是播放速率，
 * 源素材消耗量（durationUs×speed）保持不变，内容整体快放/慢放。
 * 图片 clip 速率无意义，调用方应走普通 resize。
 */
export function stretchClip (clip: Clip, edge: 'left' | 'right', newEdgeUs: number): Clip {
  const endUs = clipEndUs(clip)
  const sourceSpanUs = clip.durationUs * clip.speed
  if (edge === 'right') {
    const durationUs = Math.max(Math.round(newEdgeUs) - clip.startUs, MIN_CLIP_US)
    if (durationUs === clip.durationUs) {
      return clip
    }
    return { ...clip, durationUs, speed: sourceSpanUs / durationUs }
  }
  const left = Math.min(Math.max(Math.round(newEdgeUs), 0), endUs - MIN_CLIP_US)
  if (left === clip.startUs) {
    return clip
  }
  const durationUs = endUs - left
  return { ...clip, startUs: left, durationUs, speed: sourceSpanUs / durationUs }
}

/** 按 startUs 升序插入，返回新数组 */
export function insertClipSorted (clips: readonly Clip[], clip: Clip): Clip[] {
  const out = [...clips]
  let i = 0
  while (i < out.length && out[i].startUs <= clip.startUs) {
    i++
  }
  out.splice(i, 0, clip)
  return out
}
