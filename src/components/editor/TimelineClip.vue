<template>
  <div
    class="tl-clip"
    :class="{
      'tl-clip--selected': selected,
      'tl-clip--video': assetKind === 'video',
      'tl-clip--image': assetKind === 'image',
    }"
    :style="{ left: `${usToPx(displayStartUs)}px`, width: `${usToPx(displayDurationUs)}px` }"
    @pointerdown="$emit('body-down', $event)"
  >
    <div
      v-if="transitionWidthPx > 0"
      class="tl-clip-transition"
      :class="{ 'tl-clip-transition--warn': crossfadeOrphan }"
      :style="{ width: `${transitionWidthPx}px` }"
      :title="transitionTitle"
    >
      <v-icon :icon="transitionIcon" size="12" />
    </div>

    <span class="tl-clip-label">
      <v-icon :icon="assetKind === 'video' ? 'mdi-movie-outline' : 'mdi-image-outline'" size="12" />
      {{ name }}
      <span v-if="assetKind === 'video' && Math.abs(clip.speed - 1) > 0.001" class="tl-clip-speed">
        ×{{ clip.speed.toFixed(2) }}
      </span>
    </span>

    <template v-if="selected && clip.animated">
      <div
        v-for="kf in clip.keyframes"
        :key="kf.t"
        class="tl-clip-kf"
        :style="{ left: `${usToPx(kfDisplayT(kf.t))}px` }"
        @contextmenu.prevent="$emit('kf-remove', kf.t)"
        @pointerdown.stop="$emit('kf-down', $event, kf.t)"
      />
    </template>

    <div class="tl-clip-handle tl-clip-handle--left" @pointerdown.stop="$emit('trim-down', $event, 'left')" />
    <div class="tl-clip-handle tl-clip-handle--right" @pointerdown.stop="$emit('trim-down', $event, 'right')" />
  </div>
</template>

<script setup lang="ts">
  import type { AssetKind, Clip } from '@/editor-core/model'
  import { computed } from 'vue'
  import { useTimelineViewport } from '@/composables/useTimelineViewport'

  const props = defineProps<{
    clip: Clip
    name: string
    assetKind: AssetKind
    selected: boolean
    /** 拖动/trim 中的瞬态覆盖值（未拖动时与模型一致） */
    displayStartUs: number
    displayDurationUs: number
    /** crossfade 但前邻不紧贴（渲染会退化为从黑渐入）时给警示色 */
    crossfadeOrphan: boolean
    /** 拖动中的关键帧覆盖 */
    kfOverride: { fromT: number, currentT: number } | null
  }>()

  defineEmits<{
    'body-down': [event: PointerEvent]
    'trim-down': [event: PointerEvent, edge: 'left' | 'right']
    'kf-down': [event: PointerEvent, t: number]
    'kf-remove': [t: number]
  }>()

  const { usToPx } = useTimelineViewport()

  const transitionWidthPx = computed(() => {
    const t = props.clip.transitionIn
    if (!t) {
      return 0
    }
    // dip 横跨切点两侧，块内只能画右半；crossfade 整段都在块内
    const insideUs = t.type === 'crossfade' ? t.durationUs : t.durationUs / 2
    return Math.min(usToPx(Math.min(insideUs, props.displayDurationUs)), usToPx(props.displayDurationUs))
  })

  const transitionIcon = computed(() => {
    switch (props.clip.transitionIn?.type) {
      case 'dipToBlack': {
        return 'mdi-circle'
      }
      case 'dipToWhite': {
        return 'mdi-circle-outline'
      }
      case 'crossfade': {
        return 'mdi-transition'
      }
      default: {
        return ''
      }
    }
  })

  const transitionTitle = computed(() => {
    const t = props.clip.transitionIn
    if (!t) {
      return ''
    }
    const names = { dipToBlack: '闪黑', dipToWhite: '闪白', crossfade: '叠化' }
    const base = `${names[t.type]} ${Math.round(t.durationUs / 1000)}ms`
    return props.crossfadeOrphan ? `${base}（前邻不紧贴，将退化为从黑渐入）` : base
  })

  function kfDisplayT (t: number): number {
    return props.kfOverride && props.kfOverride.fromT === t ? props.kfOverride.currentT : t
  }
</script>

<style scoped>
.tl-clip {
  position: absolute;
  top: 4px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid rgba(127, 127, 127, 0.5);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  touch-action: none;
  display: flex;
  align-items: center;
}

.tl-clip--video {
  background: rgba(80, 120, 180, 0.35);
}

.tl-clip--image {
  background: rgba(90, 160, 110, 0.35);
}

.tl-clip--selected {
  border: 2px solid #8ab4f8;
  box-shadow: 0 0 6px rgba(138, 180, 248, 0.4);
}

.tl-clip-label {
  font-size: 11px;
  opacity: 0.85;
  padding: 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.tl-clip-speed {
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(255, 200, 80, 0.3);
  font-size: 10px;
}

.tl-clip-transition {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.35), transparent);
  border-right: 1px dashed rgba(255, 255, 255, 0.4);
  display: flex;
  align-items: flex-start;
  padding: 1px 2px;
  pointer-events: none;
}

.tl-clip-transition--warn {
  background: linear-gradient(90deg, rgba(255, 160, 60, 0.5), transparent);
}

.tl-clip-kf {
  position: absolute;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-left: -4.5px;
  transform: translateY(-50%) rotate(45deg);
  background: #f8c471;
  border: 1px solid #fff5;
  cursor: ew-resize;
  z-index: 2;
}

.tl-clip-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  z-index: 3;
}

.tl-clip-handle--left {
  left: 0;
}

.tl-clip-handle--right {
  right: 0;
}

.tl-clip-handle:hover {
  background: rgba(138, 180, 248, 0.5);
}
</style>
