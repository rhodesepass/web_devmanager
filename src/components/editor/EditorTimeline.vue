<template>
  <div class="timeline-root">
    <div class="timeline-header px-2">
      <v-btn-toggle
        class="tool-toggle"
        density="comfortable"
        mandatory
        :model-value="toolMode"
        variant="outlined"
        @update:model-value="onToolChange"
      >
        <v-btn
          class="tool-btn"
          icon="mdi-cursor-default-outline"
          title="光标 (V)：选择/移动/拖边缘裁剪"
          value="select"
        />

        <v-btn
          class="tool-btn"
          icon="mdi-box-cutter"
          title="剃刀 (B)：点击片段处切割（C = 在播放头处切割）"
          value="razor"
        />

        <v-btn
          class="tool-btn"
          icon="mdi-play-speed"
          title="比率拉伸 (R)：拖边缘改播放速率（快进/慢放），内容不增减"
          value="stretch"
        />
      </v-btn-toggle>

      <span class="text-caption text-medium-emphasis ml-2">{{ toolHint }}</span>

      <v-spacer />

      <v-btn
        density="compact"
        icon="mdi-magnify-minus-outline"
        size="x-small"
        variant="text"
        @click="onZoomBy(1 / 1.5)"
      />

      <v-slider
        v-model="zoomSlider"
        class="timeline-zoom-slider"
        density="compact"
        hide-details
        :max="1"
        :min="0"
        :step="0.01"
      />

      <v-btn
        density="compact"
        icon="mdi-magnify-plus-outline"
        size="x-small"
        variant="text"
        @click="onZoomBy(1.5)"
      />
    </div>

    <div
      ref="scrollRef"
      class="timeline-scroll"
      @wheel="onWheel"
    >
      <div class="timeline-body" :style="{ width: `${bodyWidth}px` }">
        <div class="ruler-row" @pointerdown="onRulerDown">
          <div
            v-for="tick in ticks"
            :key="tick.t"
            class="tick"
            :style="{ left: `${timeToLeft(tick.t)}px` }"
          >
            <span class="tick-label">{{ tick.label }}</span>
          </div>

          <div class="ruler-corner" @pointerdown.stop />
        </div>

        <div
          v-for="track in displayTracks"
          :key="track.id"
          class="track-row"
        >
          <div class="track-header" @pointerdown.stop>
            <template v-if="editingTrackId === track.id">
              <input
                :ref="focusRenameInput"
                class="track-rename"
                :value="track.name"
                @blur="commitRename(track.id, $event)"
                @keydown.enter="commitRename(track.id, $event)"
              >
            </template>

            <template v-else>
              <span class="track-name text-caption" @dblclick="editingTrackId = track.id">{{ track.name }}</span>
            </template>

            <v-spacer />

            <v-btn
              density="compact"
              icon="mdi-arrow-up-thin"
              size="x-small"
              title="上移一层（更靠前显示）"
              variant="text"
              @click="moveTrack(track.id, 1)"
            />

            <v-btn
              density="compact"
              icon="mdi-arrow-down-thin"
              size="x-small"
              title="下移一层"
              variant="text"
              @click="moveTrack(track.id, -1)"
            />

            <v-btn
              density="compact"
              icon="mdi-delete-outline"
              size="x-small"
              title="删除轨道（含片段）"
              variant="text"
              @click="removeTrack(track.id)"
            />
          </div>

          <div
            class="track-lane"
            :class="{ 'track-lane--razor': toolMode === 'razor', 'track-lane--stretch': toolMode === 'stretch' }"
            @dragleave="onLaneDragLeave(track.id)"
            @dragover.prevent="onLaneDragOver(track.id, $event)"
            @drop.prevent="onLaneDrop(track.id, $event)"
          >
            <TimelineClip
              v-for="clip in track.clips"
              :key="clip.id"
              :asset-kind="getAsset(clip.assetId)?.kind ?? 'image'"
              :clip="clip"
              :crossfade-orphan="isCrossfadeOrphan(track, clip)"
              :display-duration-us="displayDuration(clip)"
              :display-start-us="displayStart(clip)"
              :kf-override="kfOverrideFor(clip)"
              :name="getAsset(clip.assetId)?.name ?? '?'"
              :selected="clip.id === selectedClipId"
              @body-down="onClipBodyDown(track, clip, $event)"
              @kf-down="(ev, t) => onKfDown(clip, ev, t)"
              @kf-remove="t => removeKeyframe(clip.id, t)"
              @trim-down="(ev, edge) => onTrimDown(track, clip, ev, edge)"
            />

            <div
              v-if="dropGhost && dropGhost.trackId === track.id"
              class="drop-ghost"
              :style="{ left: `${usToPx(dropGhost.startUs)}px`, width: `${usToPx(dropGhost.durationUs)}px` }"
            />
          </div>
        </div>

        <div
          class="track-add-row"
          @dragover.prevent="onAddRowDragOver"
          @drop.prevent="onAddRowDrop"
        >
          <div class="track-add-inner" @pointerdown.stop>
            <v-btn
              density="compact"
              prepend-icon="mdi-plus"
              size="small"
              variant="text"
              @click="addTrack()"
            >
              添加轨道
            </v-btn>

            <span v-if="dropGhost?.trackId === NEW_TRACK" class="text-caption text-medium-emphasis">松开以新建轨道</span>
          </div>
        </div>

        <div class="playhead" :style="{ left: `${timeToLeft(displayPlayheadUs)}px` }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
  import type { Clip, ClipTrack } from '@/editor-core/model'
  import { computed, ref, watch } from 'vue'
  import { useEditorPlayback } from '@/composables/useEditorPlayback'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { HEADER_W, useTimelineViewport } from '@/composables/useTimelineViewport'
  import { adjacentPrevClip } from '@/editor-core/interpolate'
  import { clipEndUs, DEFAULT_IMAGE_CLIP_US, MIN_CLIP_US } from '@/editor-core/model'
  import TimelineClip from './TimelineClip.vue'

  const {
    activeSegment,
    activeSegmentDurationUs,
    selectedClipId,
    getAsset,
    addTrack,
    removeTrack,
    renameTrack,
    moveTrack,
    addClip,
    moveClip,
    resizeClip,
    stretchClipEdge,
    splitClipAt,
    removeKeyframe,
    moveKeyframe,
    draggingAssetId,
  } = useEditorProject()
  const { playheadUs, playing, seek } = useEditorPlayback()
  const {
    scrollRef,
    usToPx,
    timeToLeft,
    clientXToTime,
    zoomSlider,
    zoomAnchored,
    clampPps,
    pxPerSecond,
    snapUs,
    startEdgeAutoScroll,
    toolMode,
  } = useTimelineViewport()

  const toolHint = computed(() => {
    switch (toolMode.value) {
      case 'razor': {
        return '点击片段切割'
      }
      case 'stretch': {
        return '拖片段边缘改播放速率'
      }
      default: {
        return '拖动排布；拖边缘裁剪；右键菱形删关键帧'
      }
    }
  })

  function onToolChange (value: unknown) {
    if (value === 'select' || value === 'razor' || value === 'stretch') {
      toolMode.value = value
    }
  }

  const NEW_TRACK = '__new__'

  // 顶行 = 最上层（数组尾部），与画布 z 序直觉一致（手写倒序：tsconfig lib 无 toReversed）
  const displayTracks = computed(() => {
    const tracks = activeSegment.value.tracks
    const out: ClipTrack[] = []
    for (let i = tracks.length - 1; i >= 0; i--) {
      out.push(tracks[i])
    }
    return out
  })

  const bodyWidth = computed(() =>
    timeToLeft(Math.max(activeSegmentDurationUs.value, 5_000_000)) + 300)

  const ticks = computed(() => {
    const out: { t: number, label: string }[] = []
    const totalSec = Math.ceil(Math.max(activeSegmentDurationUs.value, 5_000_000) / 1_000_000) + 1
    // 放大后加密刻度、缩小后抽稀，保持刻度间距在 40~200px
    const stepSec = pxPerSecond.value >= 160 ? 0.5 : (pxPerSecond.value >= 40 ? 1 : 5)
    for (let s = 0; s <= totalSec; s += stepSec) {
      out.push({ t: Math.round(s * 1_000_000), label: `${s}s` })
    }
    return out
  })

  // ---- 缩放 ----

  function onZoomBy (factor: number) {
    if (dragState.value) {
      return
    }
    void zoomAnchored(clampPps(pxPerSecond.value * factor))
  }

  function onWheel (event: WheelEvent) {
    if (!event.ctrlKey || dragState.value) {
      return
    }
    event.preventDefault()
    const el = scrollRef.value
    if (!el) {
      return
    }
    const cursorInView = event.clientX - el.getBoundingClientRect().left
    void zoomAnchored(clampPps(pxPerSecond.value * Math.exp(-event.deltaY * 0.002)), cursorInView)
  }

  // ---- 标尺 seek ----

  function onRulerDown (event: PointerEvent) {
    const move = (ev: PointerEvent) => seek(clientXToTime(ev.clientX))
    move(event)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- clip 拖动 / trim ----

  interface DragState {
    mode: 'move' | 'trim-left' | 'trim-right'
    trackId: string
    clipId: string
    /** move：指针按下点相对 clip 左缘的时间偏移 */
    grabOffsetUs: number
    currentStartUs: number
    currentDurationUs: number
    clientX: number
    moved: boolean
  }

  const dragState = ref<DragState | null>(null)

  function displayStart (clip: Clip): number {
    const d = dragState.value
    return d && d.clipId === clip.id ? d.currentStartUs : clip.startUs
  }

  function displayDuration (clip: Clip): number {
    const d = dragState.value
    return d && d.clipId === clip.id ? d.currentDurationUs : clip.durationUs
  }

  /** 全段所有 clip 的边缘（排除自身）+ 0 + 播放头，磁吸候选 */
  function snapCandidates (excludeClipId: string): number[] {
    const out = [0, playheadUs.value]
    for (const track of activeSegment.value.tracks) {
      for (const c of track.clips) {
        if (c.id === excludeClipId) {
          continue
        }
        out.push(c.startUs, clipEndUs(c))
      }
    }
    return out
  }

  function neighbors (track: ClipTrack, clipId: string): { prevEnd: number, nextStart: number } {
    const i = track.clips.findIndex(c => c.id === clipId)
    const prev = track.clips[i - 1]
    const next = track.clips[i + 1]
    return {
      prevEnd: prev ? clipEndUs(prev) : 0,
      nextStart: next ? next.startUs : Number.MAX_SAFE_INTEGER,
    }
  }

  function beginDrag (state: DragState, onMove: (ev: PointerEvent) => void, onUp: () => void) {
    dragState.value = state
    const stopScroll = startEdgeAutoScroll(
      () => dragState.value?.clientX ?? 0,
      () => {
        if (dragState.value) {
          onMove({ clientX: dragState.value.clientX, altKey: false } as PointerEvent)
        }
      },
    )
    const move = (ev: PointerEvent) => {
      if (dragState.value) {
        dragState.value.clientX = ev.clientX
      }
      onMove(ev)
    }
    const up = () => {
      stopScroll()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onUp()
      dragState.value = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onClipBodyDown (track: ClipTrack, clip: Clip, event: PointerEvent) {
    if (event.button !== 0) {
      return
    }
    selectedClipId.value = clip.id
    if (toolMode.value === 'razor') {
      splitClipAt(clip.id, clientXToTime(event.clientX))
      return
    }
    if (toolMode.value === 'stretch') {
      // 拉伸工具主体不拖动，只选中；改速率走边缘手柄
      return
    }
    const { prevEnd, nextStart } = neighbors(track, clip.id)
    const state: DragState = {
      mode: 'move',
      trackId: track.id,
      clipId: clip.id,
      grabOffsetUs: clientXToTime(event.clientX) - clip.startUs,
      currentStartUs: clip.startUs,
      currentDurationUs: clip.durationUs,
      clientX: event.clientX,
      moved: false,
    }
    beginDrag(state, ev => {
      const d = dragState.value
      if (!d) {
        return
      }
      let proposed = clientXToTime(d.clientX) - d.grabOffsetUs
      if (!ev.altKey) {
        // 对左缘与右缘分别试吸附，取更近者；未吸附（返回原值）不参与比较
        const cands = snapCandidates(clip.id)
        const snappedStart = snapUs(proposed, cands)
        const snappedEnd = snapUs(proposed + clip.durationUs, cands)
        const dStart = snappedStart === proposed ? Number.POSITIVE_INFINITY : Math.abs(snappedStart - proposed)
        const dEnd = snappedEnd === proposed + clip.durationUs
          ? Number.POSITIVE_INFINITY
          : Math.abs(snappedEnd - (proposed + clip.durationUs))
        if (dStart <= dEnd && dStart !== Number.POSITIVE_INFINITY) {
          proposed = snappedStart
        } else if (dEnd < dStart) {
          proposed = snappedEnd - clip.durationUs
        }
      }
      // 钳制不重叠（不挤开邻居）
      d.currentStartUs = Math.round(Math.min(
        Math.max(proposed, prevEnd, 0),
        nextStart - clip.durationUs,
      ))
      d.moved = true
    }, () => {
      const d = dragState.value
      if (d?.moved && d.currentStartUs !== clip.startUs) {
        moveClip(clip.id, d.currentStartUs)
      }
    })
  }

  function onTrimDown (track: ClipTrack, clip: Clip, event: PointerEvent, edge: 'left' | 'right') {
    if (event.button !== 0 || toolMode.value === 'razor') {
      return
    }
    selectedClipId.value = clip.id
    const stretching = toolMode.value === 'stretch'
    const asset = getAsset(clip.assetId)
    const isVideo = asset?.kind === 'video'
    const { prevEnd, nextStart } = neighbors(track, clip.id)
    const endUs = clipEndUs(clip)
    // 拉伸模式不吃源素材余量限制（改的是速率不是 trim）
    const minLeft = Math.max(prevEnd, isVideo && !stretching
      ? Math.max(0, clip.startUs - clip.trimInUs / clip.speed)
      : 0)
    const maxEnd = Math.min(
      nextStart,
      isVideo && asset && !stretching
        ? clip.startUs + Math.max((asset.durationUs - clip.trimInUs) / clip.speed, MIN_CLIP_US)
        : Number.MAX_SAFE_INTEGER,
    )
    const state: DragState = {
      mode: edge === 'left' ? 'trim-left' : 'trim-right',
      trackId: track.id,
      clipId: clip.id,
      grabOffsetUs: 0,
      currentStartUs: clip.startUs,
      currentDurationUs: clip.durationUs,
      clientX: event.clientX,
      moved: false,
    }
    beginDrag(state, ev => {
      const d = dragState.value
      if (!d) {
        return
      }
      let proposed = clientXToTime(d.clientX)
      if (!ev.altKey) {
        proposed = snapUs(proposed, [0, playheadUs.value, edge === 'left' ? prevEnd : nextStart])
      }
      if (edge === 'left') {
        const left = Math.round(Math.min(Math.max(proposed, minLeft), endUs - MIN_CLIP_US))
        d.currentStartUs = left
        d.currentDurationUs = endUs - left
      } else {
        const end = Math.round(Math.min(Math.max(proposed, clip.startUs + MIN_CLIP_US), maxEnd))
        d.currentDurationUs = end - clip.startUs
      }
      d.moved = true
    }, () => {
      const d = dragState.value
      if (!d?.moved) {
        return
      }
      const apply = stretching ? stretchClipEdge : resizeClip
      if (edge === 'left' && d.currentStartUs !== clip.startUs) {
        apply(clip.id, 'left', d.currentStartUs)
      } else if (edge === 'right' && d.currentDurationUs !== clip.durationUs) {
        apply(clip.id, 'right', clip.startUs + d.currentDurationUs)
      }
    })
  }

  // ---- 关键帧拖动 ----

  const kfDrag = ref<{ clipId: string, fromT: number, currentT: number } | null>(null)

  function kfOverrideFor (clip: Clip) {
    return kfDrag.value && kfDrag.value.clipId === clip.id
      ? { fromT: kfDrag.value.fromT, currentT: kfDrag.value.currentT }
      : null
  }

  function onKfDown (clip: Clip, event: PointerEvent, fromT: number) {
    if (event.button !== 0) {
      return
    }
    selectedClipId.value = clip.id
    const startX = event.clientX
    kfDrag.value = { clipId: clip.id, fromT, currentT: fromT }
    const move = (ev: PointerEvent) => {
      if (!kfDrag.value) {
        return
      }
      const deltaUs = Math.round((ev.clientX - startX) / pxPerSecond.value * 1_000_000)
      kfDrag.value.currentT = Math.min(Math.max(0, fromT + deltaUs), clip.durationUs)
    }
    const up = () => {
      if (kfDrag.value && kfDrag.value.currentT !== fromT) {
        moveKeyframe(clip.id, fromT, kfDrag.value.currentT)
        seek(clip.startUs + kfDrag.value.currentT)
      }
      kfDrag.value = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- 过渡警示 ----

  function isCrossfadeOrphan (track: ClipTrack, clip: Clip): boolean {
    return clip.transitionIn?.type === 'crossfade' && !adjacentPrevClip(track, clip)
  }

  // ---- 素材箱拖入 ----

  const dropGhost = ref<{ trackId: string, startUs: number, durationUs: number } | null>(null)

  function draggedDurationUs (): number {
    const asset = draggingAssetId.value ? getAsset(draggingAssetId.value) : null
    if (!asset) {
      return DEFAULT_IMAGE_CLIP_US
    }
    return asset.kind === 'video' ? Math.max(asset.durationUs, MIN_CLIP_US) : DEFAULT_IMAGE_CLIP_US
  }

  function onLaneDragOver (trackId: string, event: DragEvent) {
    if (!draggingAssetId.value) {
      return
    }
    const startUs = snapUs(clientXToTime(event.clientX), [0, playheadUs.value])
    dropGhost.value = { trackId, startUs, durationUs: draggedDurationUs() }
  }

  function onLaneDragLeave (trackId: string) {
    if (dropGhost.value?.trackId === trackId) {
      dropGhost.value = null
    }
  }

  function onLaneDrop (trackId: string, event: DragEvent) {
    const assetId = draggingAssetId.value ?? event.dataTransfer?.getData('application/x-epass-asset')
    dropGhost.value = null
    if (!assetId) {
      return
    }
    addClip(trackId, assetId, snapUs(clientXToTime(event.clientX), [0, playheadUs.value]))
  }

  function onAddRowDragOver () {
    if (draggingAssetId.value) {
      dropGhost.value = { trackId: NEW_TRACK, startUs: 0, durationUs: draggedDurationUs() }
    }
  }

  function onAddRowDrop (event: DragEvent) {
    const assetId = draggingAssetId.value ?? event.dataTransfer?.getData('application/x-epass-asset')
    dropGhost.value = null
    if (!assetId) {
      return
    }
    const track = addTrack()
    addClip(track.id, assetId, Math.max(0, clientXToTime(event.clientX)))
  }

  // ---- 轨道改名 ----

  const editingTrackId = ref<string | null>(null)

  function focusRenameInput (el: unknown) {
    if (el instanceof HTMLInputElement) {
      el.focus()
    }
  }

  function commitRename (trackId: string, event: Event) {
    const input = event.target as HTMLInputElement
    renameTrack(trackId, input.value)
    editingTrackId.value = null
  }

  // ---- 播放头 ----

  const displayPlayheadUs = computed(() => playheadUs.value)

  // 播放中播放头跑出视口时跟随滚动
  watch(playheadUs, us => {
    const el = scrollRef.value
    if (!playing.value || !el) {
      return
    }
    const px = timeToLeft(us)
    if (px < el.scrollLeft + HEADER_W + 20 || px > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, px - HEADER_W - (el.clientWidth - HEADER_W) / 2)
    }
  })
</script>

<style scoped>
.timeline-root {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: rgba(127, 127, 127, 0.06);
}

.timeline-header {
  flex: 0 0 40px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.2);
}

.tool-toggle {
  height: 32px;
}

.tool-btn {
  width: 40px;
  height: 32px !important;
}

.tool-btn :deep(.v-icon) {
  font-size: 20px;
}

.timeline-zoom-slider {
  max-width: 140px;
}

.timeline-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.timeline-body {
  position: relative;
  min-width: 100%;
}

.ruler-row {
  position: sticky;
  top: 0;
  z-index: 4;
  height: 26px;
  background: rgb(var(--v-theme-surface));
  border-bottom: 1px solid rgba(127, 127, 127, 0.4);
  cursor: pointer;
  touch-action: none;
}

.ruler-corner {
  position: sticky;
  left: 0;
  z-index: 5;
  width: 140px;
  height: 100%;
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(127, 127, 127, 0.3);
  cursor: default;
}

.tick {
  position: absolute;
  top: 0;
  height: 100%;
  border-left: 1px solid rgba(127, 127, 127, 0.5);
  padding-left: 3px;
}

.tick-label {
  font-size: 10px;
  opacity: 0.6;
}

.track-row {
  position: relative;
  height: 48px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
}

.track-header {
  position: sticky;
  left: 0;
  z-index: 3;
  width: 140px;
  height: 100%;
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(127, 127, 127, 0.3);
  display: flex;
  align-items: center;
  gap: 0;
  padding: 0 2px 0 8px;
}

.track-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.track-rename {
  width: 90px;
  font-size: 12px;
  background: rgba(127, 127, 127, 0.15);
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 3px;
  padding: 1px 4px;
  outline: none;
  color: inherit;
}

.track-lane {
  position: absolute;
  left: 140px;
  right: 0;
  top: 0;
  bottom: 0;
}

.track-lane--razor :deep(.tl-clip) {
  cursor: crosshair;
}

.track-lane--stretch :deep(.tl-clip) {
  cursor: default;
}

.track-lane--stretch :deep(.tl-clip-handle) {
  background: rgba(255, 200, 80, 0.25);
}

.track-lane--stretch :deep(.tl-clip-handle:hover) {
  background: rgba(255, 200, 80, 0.6);
}

.track-add-row {
  position: relative;
  height: 36px;
}

.track-add-inner {
  position: sticky;
  left: 0;
  width: fit-content;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
}

.drop-ghost {
  position: absolute;
  top: 4px;
  height: 40px;
  border: 2px dashed rgba(138, 180, 248, 0.8);
  border-radius: 4px;
  background: rgba(138, 180, 248, 0.15);
  pointer-events: none;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ff5252;
  pointer-events: none;
  z-index: 2;
}
</style>
