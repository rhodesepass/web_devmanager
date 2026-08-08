/**
 * 编辑器工程数据模型（editor-core 内部真源，与 epconfig.json 无关）。
 * 时间单位一律 us；坐标为画布像素；rotation 存连续角度（可 >360 可负），
 * 插值直接 lerp，显示层才 mod 360。
 *
 * v3：片段化时间轴——素材箱（AssetMeta）+ 轨道上的 Clip（时间轴位置/源内偏移），
 * 段时长不再是参数，由内容推导（segmentDurationUs）。
 */

export interface CanvasSize {
  width: 360 | 720
  height: 640 | 1280
}

export const CANVAS_360: CanvasSize = { width: 360, height: 640 }
export const CANVAS_720: CanvasSize = { width: 720, height: 1280 }

export type Easing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'

export interface Keyframe {
  /** us，相对 clip 起点 */
  t: number
  /** 元素中心在画布上的坐标 */
  x: number
  y: number
  /** 连续角度（度），不取模 */
  rotation: number
  scaleX: number
  scaleY: number
  /** 0..1 */
  opacity: number
  /** 本关键帧到下一关键帧这段的缓动 */
  easing: Easing
}

export type AssetKind = 'video' | 'image'

/** 素材箱条目：可序列化元数据；二进制以同 id 存 IndexedDB，运行时引用在 UI 层 mediaByAsset */
export interface AssetMeta {
  id: string
  name: string
  kind: AssetKind
  /** 原始像素尺寸，scale=1 时按此尺寸绘制 */
  width: number
  height: number
  /** 视频源总时长 us；图片恒 0 */
  durationUs: number
  mimeType: string
  sizeBytes: number
}

/** clip 切点过渡（与段级 TransitionLoopConfig 是两个体系，不合并） */
export type ClipTransitionType = 'dipToBlack' | 'dipToWhite' | 'crossfade'

export const CLIP_TRANSITION_TYPES: ClipTransitionType[] = ['dipToBlack', 'dipToWhite', 'crossfade']

export interface ClipTransition {
  type: ClipTransitionType
  /** us，总时长：dip 为切点两侧各一半；crossfade 为切点后的交叠区 */
  durationUs: number
}

export type EffectType = 'brightness' | 'contrast' | 'saturate' | 'grayscale' | 'blur' | 'hueRotate'

/** 静态特效实例；参数语义由 effects.ts registry 定义，本文件只存数据 */
export interface EffectInstance {
  id: string
  type: EffectType
  /** 参数名→值，缺省项按 registry default 补齐 */
  params: Record<string, number>
}

export interface Clip {
  id: string
  /** 指向 Project.assets */
  assetId: string
  /** us，clip 左边缘在段时间轴上的位置，>=0 */
  startUs: number
  /** us，时间轴占据长度，>0；视频可超源剩余长度（冻结尾帧） */
  durationUs: number
  /** us，clip 本地 0 时刻对应源素材内时刻；图片恒 0 */
  trimInUs: number
  /** 播放速率（比率拉伸工具改写），源时刻 = trimInUs + localUs×speed；>0，图片忽略 */
  speed: number
  /**
   * PR 式秒表：false = 静态摆放（keyframes 只有一帧承载静态值，编辑直接覆盖它，不产生动画）；
   * true = 动画模式（编辑在播放头处落关键帧）
   */
  animated: boolean
  /** t 相对 clip 起点，按升序；空 = 居中恒等摆放 */
  keyframes: Keyframe[]
  /** 按数组顺序串联 ctx.filter */
  effects: EffectInstance[]
  /** 本 clip 头部切点（startUs 处）的过渡；null = 硬切 */
  transitionIn: ClipTransition | null
}

export interface ClipTrack {
  id: string
  name: string
  /** 按 startUs 升序、区间 [startUs, startUs+durationUs) 互不重叠 */
  clips: Clip[]
}

/** v3 段：无 duration 字段，时长 = 内容长度（segmentDurationUs） */
export interface Segment {
  /** z 序 = 数组顺序（先画下层） */
  tracks: ClipTrack[]
}

/** renderer/exporter 的输入快照 */
export interface SegmentView {
  canvas: CanvasSize
  fps: number
  encodePreset: EncodePreset
  /** segmentDurationUs 计算结果的快照 */
  durationUs: number
  tracks: ClipTrack[]
  assetById: ReadonlyMap<string, AssetMeta>
}

export type OperatorClass
  = | 'vanguard' | 'guard' | 'defender' | 'sniper'
    | 'caster' | 'medic' | 'supporter' | 'specialist'

export type LogoPreset = 'arknights' | 'starrail'

export interface ArknightsOverlay {
  type: 'arknights'
  /** us，必须 >0（规约硬性要求） */
  appearTimeUs: number
  operatorName: string
  operatorCode: string
  barcodeText: string
  auxText: string
  staffText: string
  /** #RRGGBB */
  color: string
  logoPreset: LogoPreset | null
  classIcon: OperatorClass | null
  /**
   * 自定义 logo，PNG dataURL（保 alpha，UI 裁剪限 ≤120×60 的 360 基准尺寸）。
   * 非空时优先于 logoPreset。设备端量化到 24 色调色板，扁平色块效果最好。
   */
  customLogo?: string | null
  /** 自定义职业图标，PNG dataURL（50×50）；非空时优先于 classIcon。16 色配额 */
  customClassIcon?: string | null
  /** 非空时替代左上角罗德岛 logo */
  topLeftRhodes: string
  /** 非空时覆盖右上角 bar 文字 */
  topRightBarText: string
}

/**
 * 图片叠加 UI：设备把整张图按原大小、屏幕左上角原点静态绘制，
 * appear_time 后整层从底部 ease-in-out 滑入（duration）。
 * image 模式独占 254 色配额，三种 overlay 里色彩还原最好。
 */
export interface ImageOverlay {
  type: 'image'
  /** us，必须 >0（规约硬性要求） */
  appearTimeUs: number
  /** us，必须 >0，进场滑入时长 */
  durationUs: number
  /** PNG dataURL（保 alpha）；UI 裁剪锁 9:16 输出整屏 360×640；null = 不显示图片 */
  image: string | null
}

export type OverlayConfig = { type: 'none' } | ArknightsOverlay | ImageOverlay

export type SegmentId = 'loop' | 'intro'

export type TransitionType = 'fade' | 'move' | 'swipe'

/** intro→loop 过渡（epconfig transition_loop）；总时长 = 3×durationUs */
export interface TransitionLoopConfig {
  type: TransitionType
  durationUs: number
  /** #RRGGBB */
  backgroundColor: string
}

export type ProjectFps = 30 | 60
/** 映射 encode-params.ts 的 profile：动画→hq_*、真实视频→hq_video_*、快速预览→fast_* */
export type EncodePreset = 'animation' | 'realistic' | 'fast'

export interface Project {
  version: 3
  canvas: CanvasSize
  /** 输出帧率；预览播放不受影响（墙钟驱动），只影响导出编码与帧栅格 */
  fps: ProjectFps
  /** 素材箱：与 clip 引用解耦、可复用；删除素材需级联删 clip */
  assets: AssetMeta[]
  segments: { loop: Segment, intro: Segment }
  /** intro 段是否参与导出；false 时段数据保留（非破坏性开关，对齐安卓两份同构状态） */
  introEnabled: boolean
  /** null = 硬切，epconfig 不写 transition_loop */
  transitionLoop: TransitionLoopConfig | null
  /** 进入素材时的过渡（epconfig transition_in，与 transition_loop 同构）；null = 写 type none */
  transitionIn: TransitionLoopConfig | null
  /** 压制档位（见 src/config/encode-params.ts 调校档案） */
  encodePreset: EncodePreset
  overlay: OverlayConfig
  /** 素材名（epconfig.name / zip 文件名用） */
  name: string
  description: string
}

export const PROJECT_FPS = 60
export const DEFAULT_IMAGE_CLIP_US = 3_000_000
export const MIN_CLIP_US = 100_000
export const TRANSITION_TYPES: TransitionType[] = ['fade', 'move', 'swipe']

export function createProject (canvas: CanvasSize = CANVAS_360): Project {
  return {
    version: 3,
    canvas,
    fps: PROJECT_FPS,
    assets: [],
    segments: {
      loop: { tracks: [] },
      intro: { tracks: [] },
    },
    introEnabled: false,
    // 过渡默认给 fade 500ms（用户可改为硬切）
    transitionLoop: { type: 'fade', durationUs: 500_000, backgroundColor: '#000000' },
    transitionIn: { type: 'fade', durationUs: 500_000, backgroundColor: '#000000' },
    encodePreset: 'animation',
    overlay: { type: 'none' },
    name: '未命名素材',
    description: '',
  }
}

export function clipEndUs (clip: Clip): number {
  return clip.startUs + clip.durationUs
}

/** 段时长 = 所有轨道最大 clip 结束点；无 clip 返回 0 */
export function segmentDurationUs (seg: Segment): number {
  let max = 0
  for (const track of seg.tracks) {
    for (const clip of track.clips) {
      const end = clipEndUs(clip)
      if (end > max) {
        max = end
      }
    }
  }
  return max
}

export function segmentView (project: Project, id: SegmentId): SegmentView {
  const seg = project.segments[id]
  return {
    canvas: project.canvas,
    fps: project.fps,
    encodePreset: project.encodePreset,
    durationUs: segmentDurationUs(seg),
    tracks: seg.tracks,
    assetById: new Map(project.assets.map(a => [a.id, a])),
  }
}

let idSeq = 0

/** 稳定唯一 id；非安全上下文无 crypto.randomUUID 时退化为自增（仅本会话内唯一即够） */
export function newId (prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${++idSeq}`
  return `${prefix}-${uuid}`
}

export function createClipTrack (name: string): ClipTrack {
  return { id: newId('track'), name, clips: [] }
}

export function createClip (asset: AssetMeta, startUs: number, canvas: CanvasSize): Clip {
  return {
    id: newId('clip'),
    assetId: asset.id,
    startUs,
    durationUs: asset.kind === 'video' ? Math.max(asset.durationUs, MIN_CLIP_US) : DEFAULT_IMAGE_CLIP_US,
    trimInUs: 0,
    speed: 1,
    animated: false,
    keyframes: [createDefaultKeyframe(canvas, 0)],
    effects: [],
    transitionIn: null,
  }
}

export function createDefaultKeyframe (canvas: CanvasSize, t = 0): Keyframe {
  return {
    t,
    x: canvas.width / 2,
    y: canvas.height / 2,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    easing: 'linear',
  }
}

export function createImageOverlay (): ImageOverlay {
  return {
    type: 'image',
    appearTimeUs: 100_000,
    durationUs: 1_000_000,
    image: null,
  }
}

export function createArknightsOverlay (): ArknightsOverlay {
  return {
    type: 'arknights',
    appearTimeUs: 100_000,
    operatorName: 'OPERATOR',
    operatorCode: 'ARKNIGHT - UNK0',
    barcodeText: 'OPERATOR - ARKNIGHTS',
    auxText: 'Operator of Rhodes Island\nUndefined/Rhodes Island\n Hypergryph',
    staffText: 'STAFF',
    color: '#FF0000',
    logoPreset: 'arknights',
    classIcon: null,
    customLogo: null,
    customClassIcon: null,
    topLeftRhodes: '',
    topRightBarText: '',
  }
}

/** 帧号 → us（60fps 恒定） */
export function frameToUs (frame: number, fps: number = PROJECT_FPS): number {
  return Math.round(frame * 1_000_000 / fps)
}

/** 段总帧数（durationUs 不足整帧的部分舍去） */
export function totalFrames (view: SegmentView): number {
  return Math.floor(view.durationUs * view.fps / 1_000_000)
}

/** 帧栅格量化的段导出时长（== 实际编码出的 mp4 长度）；epconfig intro.duration 从这来 */
export function segmentExportDurationUs (project: Project, id: SegmentId): number {
  return frameToUs(totalFrames(segmentView(project, id)), project.fps)
}

/**
 * 设备排期约束：intro.duration - 2×transition_in.duration - transition_loop.duration
 * 为负会被设备钳到 100ms 并报错。introEnabled 时必须 > 0（返回 false 即违规）。
 */
export function introScheduleOk (project: Project): boolean {
  if (!project.introEnabled) {
    return true
  }
  const d1 = project.transitionIn?.durationUs ?? 0
  const d2 = project.transitionLoop?.durationUs ?? 0
  if (d1 === 0 && d2 === 0) {
    return true
  }
  return segmentExportDurationUs(project, 'intro') > 2 * d1 + d2
}
