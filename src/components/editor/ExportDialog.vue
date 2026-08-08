<template>
  <v-dialog max-width="560" :model-value="modelValue" persistent>
    <v-card class="pa-4">
      <div class="text-h6 mb-3">导出素材</div>

      <template v-if="exporting">
        <div class="text-body-2 mb-2">{{ progress?.detail ?? '准备中…' }}</div>

        <v-progress-linear
          color="primary"
          height="10"
          :model-value="(progress?.ratio ?? 0) * 100"
          rounded
        />

        <div class="text-caption text-medium-emphasis mt-2">
          {{ isolationHint }}
        </div>

        <div v-if="ffmpegLog.length > 0" ref="logBox" class="ffmpeg-log mt-2">
          <div v-for="(line, i) in ffmpegLog" :key="i">{{ line }}</div>
        </div>
      </template>

      <template v-else-if="result">
        <div
          v-for="seg in resultSegments"
          :key="seg.id"
          class="mb-3"
        >
          <v-alert
            density="compact"
            :type="seg.result.verify.ok ? 'success' : 'error'"
            variant="tonal"
          >
            {{ seg.label }}：{{ seg.result.verify.ok ? '通过设备合规校验' : '未通过设备合规校验' }}
          </v-alert>

          <div v-if="seg.result.verify.summary" class="text-caption font-mono mt-1">
            {{ formatSummary(seg.result.verify.summary) }}
          </div>

          <ul v-if="seg.result.verify.errors.length > 0" class="text-body-2 text-error mt-1 ml-4">
            <li v-for="e in seg.result.verify.errors" :key="e">{{ e }}</li>
          </ul>

          <ul v-if="seg.result.verify.warnings.length > 0" class="text-body-2 text-warning mt-1 ml-4">
            <li v-for="w in seg.result.verify.warnings" :key="w">{{ w }}</li>
          </ul>
        </div>
      </template>

      <template v-else-if="exportError">
        <v-alert density="compact" type="error" variant="tonal">{{ exportError }}</v-alert>

        <div v-if="ffmpegLog.length > 0" class="ffmpeg-log mt-2">
          <div v-for="(line, i) in ffmpegLog" :key="i">{{ line }}</div>
        </div>
      </template>

      <template v-else>
        <div class="text-body-2">
          压制档位：{{ profileLabel }}（H.264 High / {{ project.fps }}fps CFR / closed GOP / 无音轨）
        </div>

        <div
          v-for="seg in pendingSegments"
          :key="seg.id"
          class="text-caption text-medium-emphasis mt-1"
        >
          {{ seg.label }}：{{ seg.frames }} 帧（{{ seg.seconds.toFixed(1) }}s @ {{ project.canvas.width }}x{{ project.canvas.height }}，{{ seg.clipCount }} 片段）
        </div>

        <div class="text-caption text-medium-emphasis mt-1">{{ isolationHint }}</div>

        <v-alert
          v-if="blockReason"
          class="mt-2"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ blockReason }}
        </v-alert>

        <div v-if="!blockReason && emptyTrackHint" class="text-caption text-medium-emphasis mt-1">
          {{ emptyTrackHint }}
        </div>
      </template>

      <div class="d-flex flex-wrap ga-2 mt-4">
        <v-btn
          v-if="!exporting && !result"
          color="primary"
          :disabled="blockReason !== ''"
          prepend-icon="mdi-export"
          @click="startExport"
        >
          开始导出
        </v-btn>

        <template v-if="allOk">
          <v-btn
            color="primary"
            :loading="packaging"
            prepend-icon="mdi-folder-zip-outline"
            @click="downloadZip"
          >
            下载素材包
          </v-btn>

          <v-btn
            v-for="opt in storageOptions"
            :key="opt.storage"
            :disabled="!connected"
            :loading="packaging"
            prepend-icon="mdi-upload"
            variant="tonal"
            @click="uploadToDevice(opt.storage)"
          >
            上传到{{ opt.displayLabel }}
          </v-btn>

          <v-btn
            v-for="seg in resultSegments"
            :key="seg.id"
            :loading="packaging"
            prepend-icon="mdi-download"
            variant="text"
            @click="downloadSegmentMp4(seg.id)"
          >
            仅 {{ seg.file }}
          </v-btn>
        </template>

        <v-spacer />

        <v-btn :disabled="exporting" variant="text" @click="close">关闭</v-btn>
      </div>

      <div v-if="allOk && !connected" class="text-caption text-medium-emphasis mt-1">
        未连接设备：可先下载素材包，稍后在「素材」页上传
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import type { SegmentId } from '@/editor-core/model'
  import { computed, nextTick, ref, watch } from 'vue'
  import { useEditorExport } from '@/composables/useEditorExport'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { useMaterials } from '@/composables/useMaterials'
  import { useUsb } from '@/composables/useUsb'
  import { profileLabelFor } from '@/editor-core/exporter'
  import { introScheduleOk, segmentView, totalFrames } from '@/editor-core/model'
  import { formatSummary } from '@/editor-core/mp4Verify'

  const { modelValue } = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{ 'update:modelValue': [boolean] }>()

  const { project } = useEditorProject()
  const { connected } = useUsb()
  const { storageOptions } = useMaterials()
  const {
    exporting,
    packaging,
    progress,
    result,
    allOk,
    exportError,
    ffmpegLog,
    startExport,
    downloadSegmentMp4,
    downloadZip,
    uploadToDevice,
  } = useEditorExport()

  // 新日志到来时贴底滚动
  const logBox = ref<HTMLDivElement>()
  watch(() => ffmpegLog.value.length, async () => {
    await nextTick()
    const el = logBox.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })

  const SEGMENT_META: Record<SegmentId, { label: string, file: string }> = {
    loop: { label: '循环段 loop.mp4', file: 'loop.mp4' },
    intro: { label: '入场段 intro.mp4', file: 'intro.mp4' },
  }

  const jobIds = computed<SegmentId[]>(() =>
    project.value.introEnabled ? ['loop', 'intro'] : ['loop'])

  const profileLabel = computed(() => profileLabelFor({
    canvas: project.value.canvas,
    encodePreset: project.value.encodePreset,
  }))

  const pendingSegments = computed(() => jobIds.value.map(id => {
    const view = segmentView(project.value, id)
    return {
      id,
      label: SEGMENT_META[id].label,
      frames: totalFrames(view),
      seconds: view.durationUs / 1_000_000,
      clipCount: view.tracks.reduce((sum, t) => sum + t.clips.length, 0),
      emptyTracks: view.tracks.filter(t => t.clips.length === 0).length,
    }
  }))

  const resultSegments = computed(() => {
    const r = result.value
    if (!r) {
      return []
    }
    const out = [{ id: 'loop' as SegmentId, ...SEGMENT_META.loop, result: r.loop }]
    if (r.intro) {
      out.push({ id: 'intro' as SegmentId, ...SEGMENT_META.intro, result: r.intro })
    }
    return out
  })

  /** 导出前置校验的 UI 侧镜像：不满足时禁用按钮并说明原因 */
  const blockReason = computed(() => {
    const proj = project.value
    for (const seg of pendingSegments.value) {
      if (seg.clipCount === 0) {
        return `${seg.label.slice(0, 3)}没有任何片段`
      }
      if (seg.frames <= 0) {
        return `${seg.label.slice(0, 3)}时长为 0`
      }
    }
    if (!introScheduleOk(proj)) {
      return '入场时长必须大于 2×入场过渡 + 循环过渡每步时长'
    }
    return ''
  })

  /** 不阻断的提示：空轨道对导出无影响，但通常是忘了删 */
  const emptyTrackHint = computed(() => {
    const n = pendingSegments.value.reduce((sum, s) => sum + s.emptyTracks, 0)
    return n > 0 ? `有 ${n} 条空轨道（不影响导出，可在剪辑器里清理）` : ''
  })

  const isolationHint = globalThis.crossOriginIsolated
    ? '多线程编码已启用。'
    : '当前环境无跨源隔离，单线程编码会明显偏慢。'

  function close () {
    emit('update:modelValue', false)
  }
</script>

<style scoped>
.font-mono {
  font-family: monospace;
}

.ffmpeg-log {
  max-height: 160px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 10px;
  line-height: 1.45;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 6px;
  padding: 6px 8px;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>
