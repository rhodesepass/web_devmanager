import type {
  AssetMeta,
  CanvasSize,
  Clip,
  ClipTrack,
  ClipTransition,
  EffectType,
  Keyframe,
  Project,
  Segment,
  SegmentId,
} from '@/editor-core/model'
import { computed, ref, shallowReactive, watch } from 'vue'
import {
  appendPositionUs,
  canPlaceClip,
  insertClipSorted,
  resizeClipLeft,
  resizeClipRight,
  splitClip,
  stretchClip,
} from '@/editor-core/clipOps'
import { createEffectInstance } from '@/editor-core/effects'
import { defaultTransform, sampleClip, upsertKeyframe } from '@/editor-core/interpolate'
import {
  clipEndUs,
  createClip,
  createClipTrack,
  createProject,
  MIN_CLIP_US,
  newId,
  segmentDurationUs,
} from '@/editor-core/model'
import { deserializeProject, serializeProject } from '@/editor-core/serialize'
import {
  clearEditorDb,
  deleteAsset as dbDeleteAsset,
  deleteProjectJson,
  loadAllAssets,
  loadProjectJson,
  saveAsset,
  saveProjectJson,
} from '@/utils/editorDb'
import { useNotifications } from './useNotifications'

/** UI 层持有的素材运行时引用（core 不认识 File/DOM，这里是唯一存放处） */
export interface AssetMedia {
  file: File
  objectUrl: string
  /** 元数据探测 + 导出取帧共用（导出串行 seek，per-asset 单元素够用） */
  video?: HTMLVideoElement
  image?: HTMLImageElement
}

const project = ref<Project>(createProject())
const activeSegmentId = ref<SegmentId>('loop')
const selectedClipId = ref<string | null>(null)
const restoring = ref(false)
// HTML5 DnD 的 dataTransfer 在 dragover 阶段读不到数据，素材箱拖出时把 id 放这
const draggingAssetId = ref<string | null>(null)
/** 工程内容版本号：任何变动 +1（导出结果失效判定等用） */
const projectRevision = ref(0)

// File/DOM 引用不进 project（不可序列化），按 assetId 挂在这
const mediaByAsset = shallowReactive(new Map<string, AssetMedia>())
// 预览专用：同素材多 clip 各需独立 currentTime，按 clipId 懒创建
const videoByClip = new Map<string, HTMLVideoElement>()
// 素材箱缩略图 dataURL
const thumbByAsset = shallowReactive(new Map<string, string>())

let restored = false
let persistAsked = false

function loadVideoMeta (url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = url
    video.addEventListener('loadedmetadata', () => resolve(video), { once: true })
    video.addEventListener('error', () => reject(new Error('视频加载失败')), { once: true })
  })
}

function loadImage (url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.src = url
    img.addEventListener('load', () => resolve(img), { once: true })
    img.addEventListener('error', () => reject(new Error('图片加载失败')), { once: true })
  })
}

/** 视频素材缩略图：seek 到 min(0.5s, dur/2) 抽一帧 */
function captureVideoThumb (video: HTMLVideoElement): Promise<string | null> {
  return new Promise(resolve => {
    const target = Math.min(0.5, (video.duration || 1) / 2)
    const onSeeked = () => {
      try {
        const w = 96
        const h = Math.max(1, Math.round(w * video.videoHeight / Math.max(1, video.videoWidth)))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        resolve(null)
      }
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', () => resolve(null), { once: true })
    video.currentTime = target
  })
}

function findClip (clipId: string): { track: ClipTrack, clip: Clip, index: number } | null {
  for (const seg of Object.values(project.value.segments)) {
    for (const track of seg.tracks) {
      const index = track.clips.findIndex(c => c.id === clipId)
      if (index !== -1) {
        return { track, clip: track.clips[index], index }
      }
    }
  }
  return null
}

function disposeClipVideo (clipId: string) {
  const video = videoByClip.get(clipId)
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
    videoByClip.delete(clipId)
  }
}

// 自动保存：工程 JSON 体积小（纯元数据/关键帧），deep watch + 防抖可接受
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(project, () => {
  projectRevision.value++
  if (restoring.value) {
    return
  }
  if (saveTimer) {
    clearTimeout(saveTimer)
  }
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveProjectJson(serializeProject(project.value)).catch(() => {
      // 存不进去（配额/隐私模式）不打断编辑，恢复时按缺失处理
    })
  }, 800)
}, { deep: true })

export function useEditorProject () {
  const { notify } = useNotifications()

  const activeSegment = computed<Segment>(() => project.value.segments[activeSegmentId.value])
  const activeSegmentDurationUs = computed(() => segmentDurationUs(activeSegment.value))

  const selectedClip = computed<{ track: ClipTrack, clip: Clip } | null>(() => {
    if (!selectedClipId.value) {
      return null
    }
    for (const track of activeSegment.value.tracks) {
      const clip = track.clips.find(c => c.id === selectedClipId.value)
      if (clip) {
        return { track, clip }
      }
    }
    return null
  })

  function setActiveSegment (id: SegmentId) {
    if (activeSegmentId.value === id) {
      return
    }
    activeSegmentId.value = id
    // 选中项属于旧段，留着会让属性面板/Transformer 引用错段
    selectedClipId.value = null
  }

  // ---- 持久化 ----

  /** 进编辑器时恢复：幂等，editor.vue / editorCut.vue 的 onMounted 都 await 它 */
  async function restoreFromDb (): Promise<void> {
    if (restored) {
      return
    }
    restored = true
    restoring.value = true
    try {
      let stored: Project | null = null
      try {
        const text = await loadProjectJson()
        if (text !== null) {
          stored = deserializeProject(text)
        }
      } catch (error) {
        console.error('[editor] 工程数据反序列化失败：', error)
        await deleteProjectJson().catch(() => {})
        notify('上次的工程数据损坏，已重置（素材库保留）', 'warning')
      }

      const assets = await loadAllAssets()

      if (stored) {
        // blob 缺失的 asset：从工程移除并级联删引用 clip
        const lost = stored.assets.filter(a => !assets.has(a.id))
        if (lost.length > 0) {
          const lostIds = new Set(lost.map(a => a.id))
          stored.assets = stored.assets.filter(a => !lostIds.has(a.id))
          for (const seg of Object.values(stored.segments)) {
            for (const track of seg.tracks) {
              track.clips = track.clips.filter(c => !lostIds.has(c.assetId))
            }
          }
          notify(`${lost.length} 个素材的文件丢失，相关片段已移除`, 'warning')
        }
        project.value = stored
        // 孤儿记录回收只在工程有效时做——工程损坏重置时库里的素材不是孤儿，是幸存者
        const knownIds = new Set(stored.assets.map(a => a.id))
        for (const id of assets.keys()) {
          if (!knownIds.has(id)) {
            dbDeleteAsset(id).catch(() => {})
          }
        }
      } else {
        // 无工程（全新或损坏重置）：把库里的素材挂回素材箱，不丢用户导入过的文件
        for (const record of assets.values()) {
          project.value.assets.push(record.meta)
        }
      }

      // 重建运行时引用
      for (const meta of project.value.assets) {
        const record = assets.get(meta.id)
        if (!record) {
          continue
        }
        try {
          await mountAssetMedia(meta, record.file)
        } catch {
          notify(`素材「${meta.name}」加载失败`, 'warning')
        }
      }
    } finally {
      restoring.value = false
    }
    if (!persistAsked) {
      persistAsked = true
      navigator.storage?.persist?.().catch(() => {})
    }
  }

  async function resetProject () {
    for (const media of mediaByAsset.values()) {
      URL.revokeObjectURL(media.objectUrl)
    }
    mediaByAsset.clear()
    thumbByAsset.clear()
    for (const clipId of videoByClip.keys()) {
      disposeClipVideo(clipId)
    }
    project.value = createProject()
    activeSegmentId.value = 'loop'
    selectedClipId.value = null
    await clearEditorDb().catch(() => {})
  }

  /** 重建素材的运行时引用（objectUrl/解码元素/缩略图），恢复与导入共用 */
  async function mountAssetMedia (meta: AssetMeta, file: File): Promise<void> {
    const objectUrl = URL.createObjectURL(file)
    try {
      if (meta.kind === 'video') {
        const video = await loadVideoMeta(objectUrl)
        mediaByAsset.set(meta.id, { file, objectUrl, video })
        captureVideoThumb(video).then(thumb => {
          if (thumb) {
            thumbByAsset.set(meta.id, thumb)
          }
        })
      } else {
        const image = await loadImage(objectUrl)
        mediaByAsset.set(meta.id, { file, objectUrl, image })
        thumbByAsset.set(meta.id, objectUrl)
      }
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }
  }

  /**
   * 从 .epedit.zip（project.epedit.json + assets/<assetId>）恢复工程。
   * 覆盖当前工程与素材库（调用方先确认）；缺素材条目时级联删相关片段。
   */
  async function importProjectArchive (file: File): Promise<void> {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(file)
    const entry = zip.file('project.epedit.json')
    if (!entry) {
      throw new Error('压缩包里没有 project.epedit.json，不是工程备份')
    }
    const imported = deserializeProject(await entry.async('string'))

    await resetProject()

    const lostIds = new Set<string>()
    for (const meta of imported.assets) {
      const assetEntry = zip.file(`assets/${meta.id}`)
      if (!assetEntry) {
        lostIds.add(meta.id)
        continue
      }
      const assetFile = new File([await assetEntry.async('blob')], meta.name, { type: meta.mimeType })
      try {
        await mountAssetMedia(meta, assetFile)
      } catch {
        lostIds.add(meta.id)
        continue
      }
      try {
        await saveAsset(meta, assetFile)
      } catch {
        notify(`素材「${meta.name}」无法持久化（存储配额不足？），刷新后将丢失`, 'warning')
      }
    }
    if (lostIds.size > 0) {
      imported.assets = imported.assets.filter(a => !lostIds.has(a.id))
      for (const seg of Object.values(imported.segments)) {
        for (const track of seg.tracks) {
          track.clips = track.clips.filter(c => !lostIds.has(c.assetId))
        }
      }
      notify(`${lostIds.size} 个素材在备份中缺失或损坏，相关片段已移除`, 'warning')
    }
    project.value = imported
    activeSegmentId.value = 'loop'
    selectedClipId.value = null
  }

  // ---- 素材箱 ----

  async function importAsset (file: File): Promise<AssetMeta> {
    const objectUrl = URL.createObjectURL(file)
    const isVideo = file.type.startsWith('video/')
    let meta: AssetMeta
    let media: AssetMedia
    try {
      if (isVideo) {
        const video = await loadVideoMeta(objectUrl)
        meta = {
          id: newId('asset'),
          name: file.name,
          kind: 'video',
          width: video.videoWidth,
          height: video.videoHeight,
          durationUs: Math.floor(video.duration * 1_000_000),
          mimeType: file.type,
          sizeBytes: file.size,
        }
        media = { file, objectUrl, video }
      } else {
        const image = await loadImage(objectUrl)
        meta = {
          id: newId('asset'),
          name: file.name,
          kind: 'image',
          width: image.naturalWidth,
          height: image.naturalHeight,
          durationUs: 0,
          mimeType: file.type,
          sizeBytes: file.size,
        }
        media = { file, objectUrl, image }
      }
    } catch (error) {
      URL.revokeObjectURL(objectUrl)
      throw error
    }

    try {
      await saveAsset(meta, file)
    } catch {
      // 配额不足等：仅内存使用，刷新后按素材丢失容错
      notify('素材无法持久化（存储配额不足？），刷新页面后将丢失', 'warning')
    }

    mediaByAsset.set(meta.id, media)
    if (meta.kind === 'video' && media.video) {
      captureVideoThumb(media.video).then(thumb => {
        if (thumb) {
          thumbByAsset.set(meta.id, thumb)
        }
      })
    } else {
      thumbByAsset.set(meta.id, objectUrl)
    }
    project.value.assets.push(meta)
    return meta
  }

  function countClipsUsing (assetId: string): number {
    let n = 0
    for (const seg of Object.values(project.value.segments)) {
      for (const track of seg.tracks) {
        n += track.clips.filter(c => c.assetId === assetId).length
      }
    }
    return n
  }

  /** 级联删除引用 clip（UI 层先确认）；返回删掉的 clip 数 */
  function removeAsset (assetId: string): { removedClips: number } {
    let removedClips = 0
    for (const seg of Object.values(project.value.segments)) {
      for (const track of seg.tracks) {
        const doomed = track.clips.filter(c => c.assetId === assetId)
        for (const clip of doomed) {
          disposeClipVideo(clip.id)
          if (selectedClipId.value === clip.id) {
            selectedClipId.value = null
          }
          removedClips++
        }
        track.clips = track.clips.filter(c => c.assetId !== assetId)
      }
    }
    const i = project.value.assets.findIndex(a => a.id === assetId)
    if (i !== -1) {
      project.value.assets.splice(i, 1)
    }
    const media = mediaByAsset.get(assetId)
    if (media) {
      URL.revokeObjectURL(media.objectUrl)
      mediaByAsset.delete(assetId)
    }
    thumbByAsset.delete(assetId)
    dbDeleteAsset(assetId).catch(() => {})
    return { removedClips }
  }

  function getAssetMedia (assetId: string): AssetMedia | undefined {
    return mediaByAsset.get(assetId)
  }

  function getAsset (assetId: string): AssetMeta | undefined {
    return project.value.assets.find(a => a.id === assetId)
  }

  /** 只查已存在的预览元素，不创建（播放器遍历 pause 非活跃 clip 用） */
  function peekClipVideo (clipId: string): HTMLVideoElement | null {
    return videoByClip.get(clipId) ?? null
  }

  /** 预览专用：按 clipId 懒创建独立 video 元素（同素材多 clip 各自 currentTime） */
  function getClipVideo (clipId: string): HTMLVideoElement | null {
    const existing = videoByClip.get(clipId)
    if (existing) {
      return existing
    }
    const found = findClip(clipId)
    if (!found) {
      return null
    }
    const media = mediaByAsset.get(found.clip.assetId)
    if (!media || !media.video) {
      return null
    }
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    video.src = media.objectUrl
    videoByClip.set(clipId, video)
    return video
  }

  // ---- 轨道 ----

  function addTrack (name?: string): ClipTrack {
    const track = createClipTrack(name ?? `轨道 ${activeSegment.value.tracks.length + 1}`)
    activeSegment.value.tracks.push(track)
    return track
  }

  function removeTrack (trackId: string) {
    const tracks = activeSegment.value.tracks
    const i = tracks.findIndex(t => t.id === trackId)
    if (i === -1) {
      return
    }
    for (const clip of tracks[i].clips) {
      disposeClipVideo(clip.id)
      if (selectedClipId.value === clip.id) {
        selectedClipId.value = null
      }
    }
    tracks.splice(i, 1)
  }

  function renameTrack (trackId: string, name: string) {
    const track = activeSegment.value.tracks.find(t => t.id === trackId)
    if (track && name.trim()) {
      track.name = name.trim()
    }
  }

  /** z 序调整：delta = ±1 */
  function moveTrack (trackId: string, delta: number) {
    const tracks = activeSegment.value.tracks
    const i = tracks.findIndex(t => t.id === trackId)
    const j = i + delta
    if (i < 0 || j < 0 || j >= tracks.length) {
      return
    }
    ;[tracks[i], tracks[j]] = [tracks[j], tracks[i]]
  }

  // ---- clip ----

  /** 缺省落点 = 轨尾；给定落点冲突时顺延到轨尾 */
  function addClip (trackId: string, assetId: string, startUs?: number): Clip | null {
    const track = activeSegment.value.tracks.find(t => t.id === trackId)
    const asset = getAsset(assetId)
    if (!track || !asset) {
      return null
    }
    let clip = createClip(asset, startUs ?? appendPositionUs(track), project.value.canvas)
    if (!canPlaceClip(track, clip.startUs, clip.durationUs)) {
      clip = { ...clip, startUs: appendPositionUs(track) }
    }
    track.clips = insertClipSorted(track.clips, clip)
    selectedClipId.value = clip.id
    return clip
  }

  function removeClip (clipId: string) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    disposeClipVideo(clipId)
    found.track.clips = found.track.clips.filter(c => c.id !== clipId)
    if (selectedClipId.value === clipId) {
      selectedClipId.value = null
    }
  }

  /** canPlaceClip 校验，失败返回 false（UI 弹回） */
  function moveClip (clipId: string, newStartUs: number): boolean {
    const found = findClip(clipId)
    if (!found) {
      return false
    }
    const startUs = Math.max(0, Math.round(newStartUs))
    if (!canPlaceClip(found.track, startUs, found.clip.durationUs, clipId)) {
      return false
    }
    const updated = { ...found.clip, startUs }
    found.track.clips = insertClipSorted(found.track.clips.filter(c => c.id !== clipId), updated)
    return true
  }

  function resizeClip (clipId: string, edge: 'left' | 'right', us: number) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    const asset = getAsset(found.clip.assetId)
    const isVideo = asset?.kind === 'video'
    let target = Math.round(us)
    if (edge === 'right' && isVideo && asset) {
      // 视频右缘不超源剩余长度（时间轴时长 = 源剩余/speed；冻结语义仍由 sampleClip 兜底）
      const remainUs = (asset.durationUs - found.clip.trimInUs) / found.clip.speed
      const maxEnd = found.clip.startUs + Math.max(remainUs, MIN_CLIP_US)
      target = Math.min(target, maxEnd)
    }
    let updated = edge === 'left'
      ? resizeClipLeft(found.clip, target, isVideo)
      : resizeClipRight(found.clip, target)
    // 邻居钳制：不允许 resize 出重叠
    const prev = found.track.clips[found.index - 1]
    const next = found.track.clips[found.index + 1]
    if (edge === 'left' && prev && updated.startUs < clipEndUs(prev)) {
      updated = resizeClipLeft(found.clip, clipEndUs(prev), isVideo)
    }
    if (edge === 'right' && next && clipEndUs(updated) > next.startUs) {
      updated = resizeClipRight(found.clip, next.startUs)
    }
    found.track.clips = insertClipSorted(found.track.clips.filter(c => c.id !== clipId), updated)
  }

  /** 比率拉伸：拖边缘改播放速率（源消耗量不变）；图片速率无意义退化为普通 resize */
  function stretchClipEdge (clipId: string, edge: 'left' | 'right', us: number) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    const asset = getAsset(found.clip.assetId)
    if (asset?.kind !== 'video') {
      resizeClip(clipId, edge, us)
      return
    }
    let target = Math.round(us)
    // 邻居钳制：不许拉进旁边的 clip
    const prev = found.track.clips[found.index - 1]
    const next = found.track.clips[found.index + 1]
    if (edge === 'left') {
      target = Math.max(target, prev ? clipEndUs(prev) : 0)
    } else if (next) {
      target = Math.min(target, next.startUs)
    }
    const updated = stretchClip(found.clip, edge, target)
    found.track.clips = insertClipSorted(found.track.clips.filter(c => c.id !== clipId), updated)
  }

  /** 复制 clip 紧贴其后插入（空位不足顺延到轨尾）；返回新 clip */
  function duplicateClip (clipId: string): Clip | null {
    const found = findClip(clipId)
    if (!found) {
      return null
    }
    const src = found.clip
    let startUs = clipEndUs(src)
    if (!canPlaceClip(found.track, startUs, src.durationUs)) {
      startUs = appendPositionUs(found.track)
    }
    const copy: Clip = {
      ...src,
      id: newId('clip'),
      startUs,
      keyframes: src.keyframes.map(k => ({ ...k })),
      effects: src.effects.map(fx => ({ ...fx, id: newId('fx'), params: { ...fx.params } })),
      transitionIn: src.transitionIn ? { ...src.transitionIn } : null,
    }
    found.track.clips = insertClipSorted(found.track.clips, copy)
    selectedClipId.value = copy.id
    return copy
  }

  /** 在段时刻 atSegmentUs 处切割；返回右半（新 clip），不可切返回 null */
  function splitClipAt (clipId: string, atSegmentUs: number): Clip | null {
    const found = findClip(clipId)
    if (!found) {
      return null
    }
    const halves = splitClip(found.clip, Math.round(atSegmentUs) - found.clip.startUs, project.value.canvas)
    if (!halves) {
      return null
    }
    // 左半保 id 且 trimIn/startUs 不变，预览元素继续有效——绝不能 dispose：
    // 画布节点的 sceneFunc 闭包持有该元素，销毁会让左半永久黑屏
    const rest = found.track.clips.filter(c => c.id !== clipId)
    found.track.clips = insertClipSorted(insertClipSorted(rest, halves[0]), halves[1])
    return halves[1]
  }

  /**
   * 剪刀语义（时间轴按钮与快捷键共用）：有选中 clip 且播放头在其内 → 只切它；
   * 否则切所有轨播放头下的 clip。播放头在 clip 边缘 ±1 帧内不切。返回切割数。
   */
  function splitAtPlayheadUs (tUs: number): number {
    const FRAME_US = Math.round(1_000_000 / project.value.fps)
    const canCut = (clip: Clip) =>
      tUs - clip.startUs > FRAME_US && clipEndUs(clip) - tUs > FRAME_US
    const sel = selectedClip.value
    if (sel && tUs > sel.clip.startUs && tUs < clipEndUs(sel.clip)) {
      if (!canCut(sel.clip)) {
        return 0
      }
      const right = splitClipAt(sel.clip.id, tUs)
      if (right) {
        selectedClipId.value = right.id
        return 1
      }
      return 0
    }
    let n = 0
    let lastRight: Clip | null = null
    for (const track of activeSegment.value.tracks) {
      const clip = track.clips.find(c => c.startUs <= tUs && tUs < clipEndUs(c))
      if (!clip || !canCut(clip)) {
        continue
      }
      const right = splitClipAt(clip.id, tUs)
      if (right) {
        n++
        lastRight = right
      }
    }
    if (lastRight) {
      selectedClipId.value = lastRight.id
    }
    return n
  }

  // ---- 关键帧（t 一律 clip 局部） ----

  /** 静态模式写入：覆盖唯一的静态值帧（t=0），全时段生效 */
  function setStaticTransform (clipId: string, state: Omit<Keyframe, 't' | 'easing'>) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    found.clip.keyframes = [{ t: 0, ...state, easing: 'linear' }]
  }

  /**
   * PR 式秒表开关。开：当前值在 atLocalUs 落第一帧进入动画模式；
   * 关：当前播放头采样值收敛为唯一静态帧，丢弃所有关键帧。
   */
  function toggleAnimated (clipId: string, atLocalUs: number) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    const clip = found.clip
    const t = Math.min(Math.max(Math.round(atLocalUs), 0), clip.durationUs)
    const cur = sampleClip(clip, t) ?? defaultTransform(project.value.canvas)
    clip.keyframes = clip.animated
      ? [{ t: 0, ...cur, easing: 'linear' }]
      : [{ t, ...cur, easing: 'linear' }]
    clip.animated = !clip.animated
  }

  function setKeyframe (clipId: string, kf: Keyframe) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    found.clip.keyframes = upsertKeyframe(found.clip.keyframes, kf)
  }

  function removeKeyframe (clipId: string, t: number) {
    const found = findClip(clipId)
    if (!found || found.clip.keyframes.length <= 1) {
      return
    }
    found.clip.keyframes = found.clip.keyframes.filter(kf => kf.t !== t)
  }

  function moveKeyframe (clipId: string, fromT: number, toT: number) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    const kf = found.clip.keyframes.find(k => k.t === fromT)
    if (!kf) {
      return
    }
    const rest = found.clip.keyframes.filter(k => k !== kf)
    const t = Math.min(Math.max(0, toT), found.clip.durationUs)
    found.clip.keyframes = upsertKeyframe(rest, { ...kf, t })
  }

  // ---- 特效 / 过渡 ----

  function addEffect (clipId: string, type: EffectType) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    found.clip.effects = [...found.clip.effects, createEffectInstance(type)]
  }

  function updateEffectParams (clipId: string, effectId: string, params: Record<string, number>) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    const fx = found.clip.effects.find(f => f.id === effectId)
    if (fx) {
      fx.params = { ...fx.params, ...params }
    }
  }

  function removeEffect (clipId: string, effectId: string) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    found.clip.effects = found.clip.effects.filter(f => f.id !== effectId)
  }

  function setTransitionIn (clipId: string, transition: ClipTransition | null) {
    const found = findClip(clipId)
    if (!found) {
      return
    }
    found.clip.transitionIn = transition
      ? { ...transition, durationUs: Math.min(transition.durationUs, found.clip.durationUs) }
      : null
  }

  function setCanvasSize (canvas: CanvasSize) {
    project.value.canvas = canvas
  }

  return {
    project,
    restoring,
    projectRevision,
    draggingAssetId,
    activeSegmentId,
    activeSegment,
    activeSegmentDurationUs,
    setActiveSegment,
    selectedClipId,
    selectedClip,
    restoreFromDb,
    resetProject,
    importProjectArchive,
    importAsset,
    removeAsset,
    countClipsUsing,
    getAsset,
    getAssetMedia,
    getClipVideo,
    peekClipVideo,
    thumbByAsset,
    addTrack,
    removeTrack,
    renameTrack,
    moveTrack,
    addClip,
    removeClip,
    duplicateClip,
    moveClip,
    resizeClip,
    stretchClipEdge,
    splitClipAt,
    splitAtPlayheadUs,
    setKeyframe,
    setStaticTransform,
    toggleAnimated,
    removeKeyframe,
    moveKeyframe,
    addEffect,
    updateEffectParams,
    removeEffect,
    setTransitionIn,
    setCanvasSize,
  }
}
