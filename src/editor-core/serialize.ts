import type { Project } from './model'
import { EFFECTS } from './effects'
import { CLIP_TRANSITION_TYPES, TRANSITION_TYPES } from './model'

/**
 * 工程序列化。version 门控：只认 3。
 * 自动保存（IndexedDB）存的就是这份产物，恢复失败即丢工程——
 * 校验必须与 clipOps 维护的不变量（clips 升序不重叠）一致。
 */

export function serializeProject (project: Project): string {
  return JSON.stringify(project, null, 2)
}

function validateAssets (raw: unknown): Set<string> {
  if (!Array.isArray(raw)) {
    throw new TypeError('工程文件缺少 assets')
  }
  const ids = new Set<string>()
  for (const a of raw as Record<string, unknown>[]) {
    if (typeof a !== 'object' || a === null) {
      throw new TypeError('assets 条目格式错误')
    }
    if (typeof a.id !== 'string' || a.id === '' || ids.has(a.id)) {
      throw new TypeError('assets 条目 id 非法或重复')
    }
    if (a.kind !== 'video' && a.kind !== 'image') {
      throw new TypeError('assets 条目 kind 非法')
    }
    if (typeof a.width !== 'number' || a.width <= 0 || typeof a.height !== 'number' || a.height <= 0) {
      throw new TypeError('assets 条目尺寸非法')
    }
    if (typeof a.durationUs !== 'number' || a.durationUs < 0) {
      throw new TypeError('assets 条目 durationUs 非法')
    }
    ids.add(a.id)
  }
  return ids
}

function validateKeyframes (kfs: unknown, label: string): void {
  if (!Array.isArray(kfs)) {
    throw new TypeError(`${label} clip 缺少 keyframes`)
  }
  for (let i = 1; i < kfs.length; i++) {
    if ((kfs[i] as { t: number }).t < (kfs[i - 1] as { t: number }).t) {
      throw new Error(`${label} clip 关键帧未按 t 升序`)
    }
  }
}

function validateEffects (effects: unknown, label: string): void {
  if (!Array.isArray(effects)) {
    throw new TypeError(`${label} clip 缺少 effects`)
  }
  for (const fx of effects as Record<string, unknown>[]) {
    if (typeof fx !== 'object' || fx === null
      || typeof fx.type !== 'string' || !(fx.type in EFFECTS)) {
      throw new TypeError(`${label} clip 含未知特效`)
    }
    const params = fx.params
    if (typeof params !== 'object' || params === null
      || Object.values(params as Record<string, unknown>).some(v => typeof v !== 'number')) {
      throw new TypeError(`${label} clip 特效参数非法`)
    }
  }
}

function validateClip (clip: unknown, assetIds: Set<string>, label: string): { startUs: number, endUs: number } {
  if (typeof clip !== 'object' || clip === null) {
    throw new TypeError(`${label} clip 格式错误`)
  }
  const c = clip as Record<string, unknown>
  if (typeof c.assetId !== 'string' || !assetIds.has(c.assetId)) {
    throw new Error(`${label} clip 引用了不存在的素材`)
  }
  if (typeof c.startUs !== 'number' || c.startUs < 0) {
    throw new TypeError(`${label} clip startUs 非法`)
  }
  if (typeof c.durationUs !== 'number' || c.durationUs <= 0) {
    throw new TypeError(`${label} clip durationUs 非法`)
  }
  if (typeof c.trimInUs !== 'number' || c.trimInUs < 0) {
    throw new TypeError(`${label} clip trimInUs 非法`)
  }
  // speed 是后追加字段：缺省补 1，存在则必须为正数
  if (c.speed === undefined) {
    c.speed = 1
  } else if (typeof c.speed !== 'number' || !(c.speed > 0)) {
    throw new TypeError(`${label} clip speed 非法`)
  }
  // animated（PR 式秒表）后追加：缺省按"已有多帧=有动画"推断
  if (c.animated === undefined) {
    c.animated = Array.isArray(c.keyframes) && c.keyframes.length > 1
  } else if (typeof c.animated !== 'boolean') {
    throw new TypeError(`${label} clip animated 非法`)
  }
  validateKeyframes(c.keyframes, label)
  validateEffects(c.effects, label)
  if (c.transitionIn !== null && c.transitionIn !== undefined) {
    const t = c.transitionIn as Record<string, unknown>
    const validType = typeof t.type === 'string' && (CLIP_TRANSITION_TYPES as string[]).includes(t.type)
    if (!validType || typeof t.durationUs !== 'number' || t.durationUs <= 0) {
      throw new TypeError(`${label} clip transitionIn 非法`)
    }
  }
  return { startUs: c.startUs, endUs: c.startUs + c.durationUs }
}

function validateSegment (seg: unknown, assetIds: Set<string>, label: string): void {
  if (typeof seg !== 'object' || seg === null) {
    throw new TypeError(`工程文件缺少 ${label} 段`)
  }
  const obj = seg as Record<string, unknown>
  if (!Array.isArray(obj.tracks)) {
    throw new TypeError(`${label} 段缺少 tracks`)
  }
  for (const track of obj.tracks as Record<string, unknown>[]) {
    if (typeof track !== 'object' || track === null || !Array.isArray(track.clips)) {
      throw new TypeError(`${label} 段 track 缺少 clips`)
    }
    let prevEnd = -1
    let prevStart = -1
    for (const clip of track.clips) {
      const { startUs, endUs } = validateClip(clip, assetIds, label)
      if (startUs < prevStart) {
        throw new Error(`${label} 段 clip 未按 startUs 升序`)
      }
      if (startUs < prevEnd) {
        throw new Error(`${label} 段 clip 区间重叠`)
      }
      prevStart = startUs
      prevEnd = endUs
    }
  }
}

export function deserializeProject (text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('工程文件不是合法 JSON')
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new TypeError('工程文件格式错误')
  }
  const obj = raw as Record<string, unknown>
  if (obj.version !== 3) {
    throw new Error(`不支持的工程文件版本: ${String(obj.version)}`)
  }
  const canvas = obj.canvas as { width?: unknown, height?: unknown } | undefined
  const validCanvas
    = (canvas?.width === 360 && canvas?.height === 640)
      || (canvas?.width === 720 && canvas?.height === 1280)
  if (!validCanvas) {
    throw new Error('工程文件 canvas 只支持 360x640 / 720x1280')
  }
  const assetIds = validateAssets(obj.assets)
  const segments = obj.segments as Record<string, unknown> | undefined
  validateSegment(segments?.loop, assetIds, 'loop')
  validateSegment(segments?.intro, assetIds, 'intro')
  if (typeof obj.introEnabled !== 'boolean') {
    throw new TypeError('工程文件 introEnabled 非法')
  }
  for (const field of ['transitionLoop', 'transitionIn'] as const) {
    if (obj[field] !== null && obj[field] !== undefined) {
      const tl = obj[field] as Record<string, unknown>
      const validType = typeof tl.type === 'string' && (TRANSITION_TYPES as string[]).includes(tl.type)
      if (!validType || typeof tl.durationUs !== 'number' || tl.durationUs <= 0) {
        throw new TypeError(`工程文件 ${field} 非法`)
      }
    }
  }
  validateOutputSettings(obj)
  // v3 期内追加的字段：早先的自动保存里没有——缺省补默认而非判损坏
  ;(obj as { transitionIn?: unknown }).transitionIn ??= null
  ;(obj as { encodePreset?: unknown }).encodePreset ??= 'animation'
  ;(obj as { fps?: unknown }).fps ??= 60
  return raw as Project
}

function validateOutputSettings (obj: Record<string, unknown>): void {
  if (obj.fps !== undefined && obj.fps !== 30 && obj.fps !== 60) {
    throw new TypeError('工程文件 fps 只支持 30/60')
  }
  if (obj.encodePreset !== undefined
    && obj.encodePreset !== 'animation' && obj.encodePreset !== 'realistic' && obj.encodePreset !== 'fast') {
    throw new TypeError('工程文件 encodePreset 非法')
  }
}
