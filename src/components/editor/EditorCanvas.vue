<template>
  <div class="canvas-wrap">
    <div
      ref="containerRef"
      class="canvas-container"
      :class="{ 'canvas-container--pan': spaceHeld }"
      @pointerdown="onPanPointerDown"
      @pointermove="onPanPointerMove"
      @pointerup="onPanPointerUp"
    />

    <div class="canvas-controls">
      <span class="text-caption font-mono mr-1">{{ zoomPct }}%</span>

      <v-btn
        density="comfortable"
        icon="mdi-fit-to-page-outline"
        size="x-small"
        title="适配窗口（滚轮缩放，空格/中键平移）"
        variant="tonal"
        @click="fitView"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { Clip, ClipTrack } from '@/editor-core/model'
  import Konva from 'konva'
  import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
  import { useEditorPlayback } from '@/composables/useEditorPlayback'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
  import { effectsToFilter } from '@/editor-core/effects'
  import {
    adjacentPrevClip,
    defaultTransform,
    findActiveClip,
    sampleClip,
  } from '@/editor-core/interpolate'
  import { clipEndUs } from '@/editor-core/model'
  import { collectDipOverlays, crossfadeProgress } from '@/editor-core/transitions'
  import { ArknightsOverlayPreview } from './overlayPreview'

  const {
    project,
    activeSegment,
    activeSegmentId,
    selectedClipId,
    setKeyframe,
    setStaticTransform,
    getAsset,
    getAssetMedia,
    getClipVideo,
  } = useEditorProject()
  const { playheadUs, playing } = useEditorPlayback()
  const { spaceHeld, markPanOccurred } = useEditorShortcuts()

  const containerRef = ref<HTMLDivElement>()

  // fit 视图下画布外的留白比例
  const MARGIN_RATIO = 0.1
  /** Transformer 锚点屏幕尺寸（px）；Konva 10 的锚点不随 stage scale 缩放，直接给屏幕值 */
  const ANCHOR_SCREEN_PX = 12

  let stage: Konva.Stage | undefined
  let contentLayer: Konva.Layer | undefined
  let bgLayer: Konva.Layer | undefined
  let transitionLayer: Konva.Layer | undefined
  let overlayLayer: Konva.Layer | undefined
  let uiLayer: Konva.Layer | undefined
  let transformer: Konva.Transformer | undefined
  let overlayPreview: ArknightsOverlayPreview | undefined
  let anim: Konva.Animation | undefined
  let resizeObserver: ResizeObserver | undefined
  let dipBlack: Konva.Rect | undefined
  let dipWhite: Konva.Rect | undefined
  const nodeByClip = new Map<string, Konva.Shape>()
  // seeked 监听按 clipId 记录，节点重建/卸载时摘除，避免累积
  const videoHandlers = new Map<string, { video: HTMLVideoElement, handler: () => void }>()

  let fitScale = 1
  let userZoom = 1
  let panX = 0
  let panY = 0
  const zoomPct = ref(100)
  let panDrag: { startX: number, startY: number, panX: number, panY: number } | null = null

  function makeCheckerTile (): HTMLCanvasElement {
    const tile = document.createElement('canvas')
    tile.width = 32
    tile.height = 32
    const ctx = tile.getContext('2d')!
    ctx.fillStyle = '#3a3a3a'
    ctx.fillRect(0, 0, 32, 32)
    ctx.fillStyle = '#2e2e2e'
    ctx.fillRect(0, 0, 16, 16)
    ctx.fillRect(16, 16, 16, 16)
    return tile
  }

  function currentScale (): number {
    return fitScale * userZoom
  }

  /** canvas filter 的 blur px 不随 CTM 缩放，预览必须乘上 stage 缩放×pixelRatio 才与导出观感一致 */
  function blurScaleFactor (): number {
    const pixelRatio = contentLayer?.getCanvas().getPixelRatio() ?? 1
    return currentScale() * pixelRatio
  }

  function layoutStage () {
    if (!stage || !containerRef.value) {
      return
    }
    const boxW = containerRef.value.clientWidth
    const boxH = containerRef.value.clientHeight
    if (boxW < 10 || boxH < 10) {
      return
    }
    const { width: cw, height: ch } = project.value.canvas
    fitScale = Math.min(
      boxW / (cw * (1 + MARGIN_RATIO * 2)),
      boxH / (ch * (1 + MARGIN_RATIO * 2)),
    )
    const scale = currentScale()
    stage.size({ width: boxW, height: boxH })
    stage.scale({ x: scale, y: scale })
    stage.position({
      x: boxW / 2 + panX - scale * cw / 2,
      y: boxH / 2 + panY - scale * ch / 2,
    })
    zoomPct.value = Math.round(userZoom * 100)
    rebuildStaticShapes()
    // 缩放变化影响 blur 的屏幕换算
    applyPlayhead()
    stage.batchDraw()
  }

  function fitView () {
    userZoom = 1
    panX = 0
    panY = 0
    layoutStage()
  }

  function onWheel (event: WheelEvent) {
    if (!stage || !containerRef.value) {
      return
    }
    event.preventDefault()
    const rect = containerRef.value.getBoundingClientRect()
    const qx = event.clientX - rect.left
    const qy = event.clientY - rect.top
    const oldScale = currentScale()
    // 指针指向的画布坐标点，缩放前后保持在同一屏幕位置
    const cx = (qx - stage.x()) / oldScale
    const cy = (qy - stage.y()) / oldScale
    userZoom = Math.min(Math.max(userZoom * Math.exp(-event.deltaY * 0.0015), 0.25), 5)
    const scale = fitScale * userZoom
    const boxW = containerRef.value.clientWidth
    const boxH = containerRef.value.clientHeight
    const { width: cw, height: ch } = project.value.canvas
    panX = qx - scale * cx - boxW / 2 + scale * cw / 2
    panY = qy - scale * cy - boxH / 2 + scale * ch / 2
    layoutStage()
  }

  function onPanPointerDown (event: PointerEvent) {
    const wantPan = event.button === 1 || (event.button === 0 && spaceHeld.value)
    if (!wantPan) {
      return
    }
    event.preventDefault()
    markPanOccurred()
    panDrag = { startX: event.clientX, startY: event.clientY, panX, panY }
    containerRef.value?.setPointerCapture(event.pointerId)
  }

  function onPanPointerMove (event: PointerEvent) {
    if (!panDrag) {
      return
    }
    panX = panDrag.panX + (event.clientX - panDrag.startX)
    panY = panDrag.panY + (event.clientY - panDrag.startY)
    layoutStage()
  }

  function onPanPointerUp () {
    panDrag = null
  }

  function rebuildStaticShapes () {
    if (!bgLayer || !uiLayer) {
      return
    }
    const { width: cw, height: ch } = project.value.canvas
    bgLayer.destroyChildren()
    bgLayer.add(new Konva.Rect({
      x: 0,
      y: 0,
      width: cw,
      height: ch,
      fillPatternImage: makeCheckerTile() as unknown as HTMLImageElement,
      fillPatternRepeat: 'repeat',
      listening: false,
    }))

    for (const n of uiLayer.find('.scrim')) n.destroy()
    // scrim 范围放大到 ±4 倍画布：平移/缩小后仍盖得住溢出内容
    const mx = cw * 4
    const my = ch * 4
    const scrims = [
      { x: -mx, y: -my, width: cw + mx * 2, height: my },
      { x: -mx, y: ch, width: cw + mx * 2, height: my },
      { x: -mx, y: 0, width: mx, height: ch },
      { x: cw, y: 0, width: mx, height: ch },
    ]
    for (const rect of scrims) {
      uiLayer.add(new Konva.Rect({
        ...rect,
        name: 'scrim',
        fill: 'rgba(18,18,18,0.55)',
        listening: false,
      }))
    }
    for (const n of uiLayer.find('.canvas-border')) n.destroy()
    uiLayer.add(new Konva.Rect({
      x: 0,
      y: 0,
      width: cw,
      height: ch,
      name: 'canvas-border',
      stroke: '#66aaff',
      strokeWidth: 1.5,
      strokeScaleEnabled: false,
      listening: false,
    }))
    // dip 过渡色板尺寸跟画布档位
    dipBlack?.size({ width: cw, height: ch })
    dipWhite?.size({ width: cw, height: ch })
    transformer?.moveToTop()
  }

  /** 画布交互产生的 rotation 归一到与当前采样值最近的等价角（保持连续角度语义） */
  function continuousRotation (reference: number, raw: number): number {
    return raw + 360 * Math.round((reference - raw) / 360)
  }

  /** clip 对象会被 clipOps 整体替换（新引用），一律按 id 现查 */
  function currentClipById (clipId: string): Clip | null {
    for (const track of activeSegment.value.tracks) {
      const clip = track.clips.find(c => c.id === clipId)
      if (clip) {
        return clip
      }
    }
    return null
  }

  function commitNodeAsKeyframe (clipId: string, node: Konva.Shape) {
    const clip = currentClipById(clipId)
    if (!clip) {
      return
    }
    const t = Math.min(Math.max(Math.round(playheadUs.value - clip.startUs), 0), clip.durationUs)
    const sampled = sampleClip(clip, t)
    const state = {
      x: node.x(),
      y: node.y(),
      rotation: continuousRotation(sampled?.rotation ?? 0, node.rotation()),
      scaleX: node.scaleX(),
      scaleY: node.scaleY(),
      opacity: sampled?.opacity ?? 1,
    }
    // PR 式秒表：未开启动画时只更新静态值，不产生关键帧动画
    if (!clip.animated) {
      setStaticTransform(clip.id, state)
      return
    }
    const existing = clip.keyframes.find(k => Math.abs(k.t - t) <= 1)
    setKeyframe(clip.id, { t, ...state, easing: existing?.easing ?? 'linear' })
  }

  function createNode (clip: Clip): Konva.Shape | undefined {
    const asset = getAsset(clip.assetId)
    if (!asset) {
      return undefined
    }
    let source: CanvasImageSource | undefined
    if (asset.kind === 'video') {
      source = getClipVideo(clip.id) ?? undefined
    } else {
      source = getAssetMedia(asset.id)?.image
    }
    if (!source) {
      return undefined
    }
    const clipId = clip.id
    const node = new Konva.Shape({
      width: asset.width,
      height: asset.height,
      offsetX: asset.width / 2,
      offsetY: asset.height / 2,
      draggable: true,
      // 特效串挂在自定义 attr 上，applyPlayhead 负责刷新
      fxFilter: '',
      sceneFunc: (ctx, shape) => {
        const native = (ctx as unknown as { _context: CanvasRenderingContext2D })._context
        const filter = shape.getAttr('fxFilter') as string
        native.filter = filter || 'none'
        ctx.drawImage(source, 0, 0, shape.width(), shape.height())
        native.filter = 'none'
      },
      hitFunc: (ctx, shape) => {
        ctx.beginPath()
        ctx.rect(0, 0, shape.width(), shape.height())
        ctx.closePath()
        ctx.fillStrokeShape(shape)
      },
    })
    node.on('click tap', () => {
      selectedClipId.value = clipId
    })
    node.on('dragstart', () => {
      selectedClipId.value = clipId
    })
    node.on('dragend transformend', () => {
      commitNodeAsKeyframe(clipId, node)
    })
    if (asset.kind === 'video' && source instanceof HTMLVideoElement) {
      const handler = () => contentLayer?.batchDraw()
      source.addEventListener('seeked', handler)
      videoHandlers.set(clipId, { video: source, handler })
    }
    return node
  }

  function removeVideoHandler (clipId: string) {
    const entry = videoHandlers.get(clipId)
    if (entry) {
      entry.video.removeEventListener('seeked', entry.handler)
      videoHandlers.delete(clipId)
    }
  }

  function syncNodes () {
    if (!contentLayer) {
      return
    }
    const seen = new Set<string>()
    let z = 0
    for (const track of activeSegment.value.tracks) {
      for (const clip of track.clips) {
        seen.add(clip.id)
        let node = nodeByClip.get(clip.id)
        if (!node) {
          node = createNode(clip)
          if (!node) {
            continue
          }
          nodeByClip.set(clip.id, node)
          contentLayer.add(node)
        }
        node.zIndex(z++)
      }
    }
    for (const [id, node] of nodeByClip) {
      if (!seen.has(id)) {
        node.destroy()
        nodeByClip.delete(id)
        removeVideoHandler(id)
      }
    }
    syncTransformer()
    applyPlayhead()
    contentLayer.batchDraw()
  }

  /** 选中 clip 在播放头范围内才可变换（不能变换看不见的东西） */
  const selectedClipActive = computed(() => {
    const id = selectedClipId.value
    if (!id) {
      return false
    }
    const clip = currentClipById(id)
    return !!clip && playheadUs.value >= clip.startUs && playheadUs.value < clipEndUs(clip)
  })

  function syncTransformer () {
    if (!transformer) {
      return
    }
    const node = selectedClipId.value && selectedClipActive.value
      ? nodeByClip.get(selectedClipId.value)
      : undefined
    transformer.nodes(node ? [node] : [])
    uiLayer?.batchDraw()
  }

  function applyClipNode (node: Konva.Shape, clip: Clip, localUs: number, alphaMul: number, blurScale: number) {
    const s = sampleClip(clip, localUs) ?? defaultTransform(project.value.canvas)
    node.visible(true)
    node.position({ x: s.x, y: s.y })
    node.rotation(s.rotation)
    node.scale({ x: s.scaleX, y: s.scaleY })
    node.opacity(Math.min(Math.max(s.opacity * alphaMul, 0), 1))
    node.setAttr('fxFilter', effectsToFilter(clip.effects, blurScale))
  }

  function applyPlayhead () {
    const tUs = playheadUs.value
    const blurScale = blurScaleFactor()
    for (const track of activeSegment.value.tracks as ClipTrack[]) {
      const active = findActiveClip(track, tUs)
      let crossfadeP: number | null = null
      let frozenPrev: Clip | null = null
      if (active?.transitionIn?.type === 'crossfade') {
        const dur = Math.min(active.transitionIn.durationUs, active.durationUs)
        crossfadeP = crossfadeProgress(tUs, active.startUs, dur)
        if (crossfadeP !== null) {
          frozenPrev = adjacentPrevClip(track, active)
        }
      }
      for (const clip of track.clips) {
        const node = nodeByClip.get(clip.id)
        if (!node) {
          continue
        }
        if (clip === active) {
          applyClipNode(node, clip, tUs - clip.startUs, crossfadeP ?? 1, blurScale)
        } else if (frozenPrev && clip === frozenPrev && crossfadeP !== null) {
          // 交叠期前段冻结末帧渐出（video 元素停在末尾即近似冻结）
          applyClipNode(node, clip, clip.durationUs, 1 - crossfadeP, blurScale)
        } else {
          node.visible(false)
        }
      }
    }
    // dip 全画布色板（所有轨道之上）
    const overlays = collectDipOverlays(activeSegment.value.tracks, tUs)
    const black = overlays.find(o => o.color === '#000000')
    const white = overlays.find(o => o.color === '#FFFFFF')
    dipBlack?.opacity(black?.alpha ?? 0)
    dipWhite?.opacity(white?.alpha ?? 0)
    transitionLayer?.batchDraw()
    contentLayer?.batchDraw()
  }

  function onKeyDown (event: KeyboardEvent) {
    // 默认锁等比缩放，按住 Shift 自由变形
    transformer?.keepRatio(!event.shiftKey)
  }

  function onKeyUp (event: KeyboardEvent) {
    transformer?.keepRatio(!event.shiftKey)
  }

  onMounted(() => {
    stage = new Konva.Stage({
      container: containerRef.value!,
      width: 10,
      height: 10,
    })
    bgLayer = new Konva.Layer({ listening: false })
    contentLayer = new Konva.Layer()
    transitionLayer = new Konva.Layer({ listening: false })
    overlayLayer = new Konva.Layer({ listening: false })
    uiLayer = new Konva.Layer()
    overlayPreview = new ArknightsOverlayPreview(overlayLayer)
    dipBlack = new Konva.Rect({ x: 0, y: 0, fill: '#000000', opacity: 0, listening: false })
    dipWhite = new Konva.Rect({ x: 0, y: 0, fill: '#FFFFFF', opacity: 0, listening: false })
    transitionLayer.add(dipBlack, dipWhite)
    transformer = new Konva.Transformer({
      keepRatio: true,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      rotationSnapTolerance: 6,
      anchorSize: ANCHOR_SCREEN_PX,
      rotateAnchorOffset: 28,
      borderStroke: '#66aaff',
      anchorStroke: '#66aaff',
      anchorStyleFunc: anchor => {
        // 命中区扩到视觉尺寸 2 倍（视觉矩形占 (0,0)-(w,h)，中心 (w/2,h/2)）
        anchor.hitFunc((ctx, shape) => {
          const w = shape.width()
          const h = shape.height()
          ctx.beginPath()
          ctx.rect(-w / 2, -h / 2, w * 2, h * 2)
          ctx.closePath()
          ctx.fillStrokeShape(shape)
        })
      },
    })
    uiLayer.add(transformer)
    stage.add(bgLayer, contentLayer, transitionLayer, overlayLayer, uiLayer)

    stage.on('click tap', event => {
      if (event.target === stage) {
        selectedClipId.value = null
      }
    })

    layoutStage()
    syncNodes()

    resizeObserver = new ResizeObserver(() => layoutStage())
    resizeObserver.observe(containerRef.value!)
    containerRef.value!.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    containerRef.value?.removeEventListener('wheel', onWheel)
    resizeObserver?.disconnect()
    anim?.stop()
    overlayPreview?.destroy()
    stage?.destroy()
    nodeByClip.clear()
    for (const id of [...videoHandlers.keys()]) {
      removeVideoHandler(id)
    }
  })

  // 空格平移期间 Konva 节点不吃拖拽
  watch(spaceHeld, held => {
    stage?.listening(!held)
    if (!held) {
      panDrag = null
    }
  })

  watch(
    () => activeSegment.value.tracks.map(t => `${t.id}:${t.clips.map(c => c.id).join('.')}`).join(','),
    syncNodes,
  )
  watch([selectedClipId, selectedClipActive], syncTransformer)
  watch(() => `${project.value.canvas.width}`, () => fitView())
  watchEffect(() => applyPlayhead())

  // overlay 是设备运行时叠加在 loop 上的图层，intro 段编辑时不显示
  const overlayVisible = computed(() => {
    const ov = project.value.overlay
    return activeSegmentId.value === 'loop'
      && ov.type !== 'none'
      && playheadUs.value >= ov.appearTimeUs
  })
  watch(
    () => [JSON.stringify(project.value.overlay), overlayVisible.value] as const,
    () => {
      overlayPreview?.setScale(project.value.canvas.width / 360)
      void overlayPreview?.update(project.value.overlay, overlayVisible.value)
    },
    { immediate: false },
  )

  // 播放中视频帧持续刷新
  watch(playing, isPlaying => {
    if (isPlaying) {
      anim = new Konva.Animation(() => {}, contentLayer)
      anim.start()
    } else {
      anim?.stop()
      anim = undefined
      contentLayer?.batchDraw()
    }
  })
</script>

<style scoped>
.canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}

.canvas-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgb(24, 24, 24);
}

.canvas-container--pan {
  cursor: grab;
}

.canvas-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(18, 18, 18, 0.6);
}

.font-mono {
  font-family: monospace;
}
</style>
