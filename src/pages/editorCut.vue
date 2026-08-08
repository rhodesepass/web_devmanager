<template>
  <div class="cut-root">
    <div class="cut-toolbar px-2">
      <v-btn
        density="comfortable"
        :disabled="exporting"
        prepend-icon="mdi-arrow-left"
        size="small"
        variant="text"
        @click="router.push('/editor')"
      >
        工作台
      </v-btn>

      <v-divider class="mx-1" inset vertical />

      <v-btn-toggle
        density="compact"
        mandatory
        :model-value="activeSegmentId"
        variant="outlined"
        @update:model-value="onSwitchSegment"
      >
        <v-btn size="small" value="loop">LOOP 循环</v-btn>
        <v-btn size="small" value="intro">INTRO 入场</v-btn>
      </v-btn-toggle>

      <v-divider class="mx-1" inset vertical />

      <v-btn
        density="comfortable"
        icon="mdi-skip-previous"
        size="small"
        variant="text"
        @click="seek(0)"
      />

      <v-btn
        density="comfortable"
        :icon="playing ? 'mdi-pause' : 'mdi-play'"
        size="small"
        title="播放/暂停 (Space)"
        variant="tonal"
        @click="toggle"
      />

      <span class="text-body-2 font-mono ml-2">{{ formatUs(playheadUs) }} / {{ formatUs(activeSegmentDurationUs) }}</span>

      <v-spacer />

      <v-chip
        v-if="activeSegmentId === 'intro' && !project.introEnabled"
        color="warning"
        size="small"
        variant="tonal"
      >
        intro 未启用，导出时将被忽略
        <v-btn
          class="ml-2"
          density="compact"
          size="x-small"
          variant="text"
          @click="project.introEnabled = true"
        >
          启用
        </v-btn>
      </v-chip>

      <v-btn
        density="comfortable"
        :icon="binOpen ? 'mdi-folder-multiple-image' : 'mdi-folder-multiple-outline'"
        size="small"
        title="素材箱（左侧）"
        variant="text"
        @click="binOpen = !binOpen"
      />

      <v-btn
        density="comfortable"
        :icon="sideOpen ? 'mdi-dock-right' : 'mdi-dock-window'"
        size="small"
        title="属性面板（右侧）"
        variant="text"
        @click="sideOpen = !sideOpen"
      />
    </div>

    <div class="cut-main">
      <div v-show="binOpen" class="cut-bin">
        <div class="cut-side-section-title text-caption">素材箱</div>

        <div class="cut-bin-body">
          <MediaBinPanel />
        </div>
      </div>

      <div class="cut-canvas-area">
        <EditorCanvas />

        <div v-if="restoring" class="cut-empty">
          <v-progress-circular indeterminate size="48" />
        </div>

        <div v-else-if="isEmpty" class="cut-empty">
          <v-card class="pa-6 text-center" max-width="420" variant="tonal">
            <v-icon class="mb-2" icon="mdi-movie-open-outline" size="48" />
            <div class="text-h6 mb-1">工程为空</div>

            <div class="text-body-2 text-medium-emphasis mb-4">
              从右侧「素材」页导入视频/图片，再拖到时间轴（或点素材上的添加按钮）开始制作。
              素材与工程会自动保存在浏览器本地。
            </div>

            <v-btn color="primary" variant="tonal" @click="binOpen = true">
              打开素材箱
            </v-btn>
          </v-card>
        </div>
      </div>

      <div v-show="sideOpen" class="cut-side">
        <div class="cut-side-section-title text-caption">属性</div>

        <div class="cut-side-props">
          <PropertiesPanel />
        </div>
      </div>
    </div>

    <div
      class="cut-splitter"
      @pointerdown="onSplitterDown"
    />

    <div class="cut-timeline" :style="{ height: `${timelineHeight}px` }">
      <EditorTimeline />
    </div>

    <EditorSplash v-if="showSplash" @done="showSplash = false" />
  </div>
</template>

<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import EditorCanvas from '@/components/editor/EditorCanvas.vue'
  import EditorSplash from '@/components/editor/EditorSplash.vue'
  import EditorTimeline from '@/components/editor/EditorTimeline.vue'
  import MediaBinPanel from '@/components/editor/MediaBinPanel.vue'
  import PropertiesPanel from '@/components/editor/PropertiesPanel.vue'
  import { formatUs } from '@/components/editor/timeFormat'
  import { useEditorExport } from '@/composables/useEditorExport'
  import { useEditorPlayback } from '@/composables/useEditorPlayback'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { useEditorShortcuts } from '@/composables/useEditorShortcuts'
  import '@fontsource/bebas-neue'
  import '@fontsource/source-sans-3'

  const route = useRoute()
  const router = useRouter()
  const {
    project,
    restoring,
    activeSegmentId,
    activeSegmentDurationUs,
    setActiveSegment,
    restoreFromDb,
  } = useEditorProject()
  const { playheadUs, playing, toggle, seek, pause } = useEditorPlayback()
  const { exporting } = useEditorExport()
  const shortcuts = useEditorShortcuts()

  const sideOpen = ref(true)
  const binOpen = ref(true)
  const timelineHeight = ref(220)
  // 进入剪辑的 PRTS 过场：每次挂载播一次（loop/intro 互切走 router.replace 不重挂，不重播）
  const showSplash = ref(true)

  const isEmpty = computed(() =>
    project.value.assets.length === 0
    && project.value.segments.loop.tracks.every(t => t.clips.length === 0)
    && project.value.segments.intro.tracks.every(t => t.clips.length === 0))

  watch(() => route.params.segment, seg => {
    setActiveSegment(seg === 'intro' ? 'intro' : 'loop')
    pause()
    seek(0)
  }, { immediate: true })

  function onSwitchSegment (value: unknown) {
    if (value === 'loop' || value === 'intro') {
      router.replace(`/editor/cut/${value}`)
    }
  }

  function onSplitterDown (event: PointerEvent) {
    const startY = event.clientY
    const startH = timelineHeight.value
    const move = (ev: PointerEvent) => {
      const max = Math.round(window.innerHeight * 0.6)
      timelineHeight.value = Math.min(Math.max(startH + (startY - ev.clientY), 120), max)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  onMounted(() => {
    shortcuts.attach()
    void restoreFromDb()
  })

  // 模块级播放态不会随页面卸载自停，返回工作台前必须收掉 rAF 与 video.play
  onBeforeUnmount(() => {
    shortcuts.detach()
    pause()
  })
</script>

<style scoped>
.cut-root {
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cut-toolbar {
  flex: 0 0 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid rgba(127, 127, 127, 0.25);
}

.cut-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.cut-canvas-area {
  flex: 1 1 auto;
  min-width: 0;
  position: relative;
}

.cut-bin {
  flex: 0 0 260px;
  min-width: 0;
  border-right: 1px solid rgba(127, 127, 127, 0.25);
  display: flex;
  flex-direction: column;
}

.cut-bin-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.cut-side {
  flex: 0 0 300px;
  min-width: 0;
  border-left: 1px solid rgba(127, 127, 127, 0.25);
  display: flex;
  flex-direction: column;
}

.cut-side-section-title {
  flex: 0 0 auto;
  padding: 4px 10px 2px;
  opacity: 0.6;
  border-bottom: 1px solid rgba(127, 127, 127, 0.15);
}

.cut-side-props {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
}

.cut-splitter {
  flex: 0 0 6px;
  cursor: row-resize;
  background: rgba(127, 127, 127, 0.15);
  touch-action: none;
}

.cut-splitter:hover {
  background: rgba(102, 170, 255, 0.4);
}

.cut-timeline {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
}

.cut-empty {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(2px);
}

.font-mono {
  font-family: monospace;
}
</style>
