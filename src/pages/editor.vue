<template>
  <div>
    <PageHeader
      subtitle="制作设备素材：入场/循环两段剪辑 + 干员信息叠加，导出合规素材包"
      title="素材工作台"
    />

    <v-alert
      v-if="!crossOriginIsolated"
      class="mb-4"
      density="compact"
      type="warning"
      variant="tonal"
    >
      当前环境未启用跨源隔离（SharedArrayBuffer 不可用），导出将使用单线程编码，速度会明显变慢。
    </v-alert>

    <div v-if="restoring" class="d-flex align-center ga-3 py-8 justify-center">
      <v-progress-circular indeterminate size="32" />
      <span class="text-body-2 text-medium-emphasis">正在恢复上次的工程…</span>
    </div>

    <v-row v-else>
      <v-col cols="12" md="7">
        <v-card class="pa-3 mb-4" variant="tonal">
          <div class="d-flex align-center mb-3">
            <div class="text-body-1">素材信息</div>

            <v-spacer />

            <v-btn
              density="comfortable"
              :loading="importingProject"
              prepend-icon="mdi-file-import-outline"
              size="small"
              title="从工程备份（.epedit.zip）恢复，覆盖当前工程"
              variant="text"
              @click="importInput?.click()"
            >
              导入工程
            </v-btn>

            <input
              ref="importInput"
              accept=".zip,application/zip"
              class="d-none"
              type="file"
              @change="onPickImport"
            >

            <v-btn
              density="comfortable"
              :loading="exportingProject"
              prepend-icon="mdi-file-export-outline"
              size="small"
              title="导出工程备份（剪辑数据 + 全部素材文件，无压缩 zip）"
              variant="text"
              @click="exportProjectFile"
            >
              导出工程
            </v-btn>

            <v-btn
              density="comfortable"
              prepend-icon="mdi-file-restore-outline"
              size="small"
              variant="text"
              @click="newDialog = true"
            >
              重置工程
            </v-btn>
          </div>

          <v-text-field
            v-model="project.name"
            density="compact"
            hide-details
            label="素材名称"
            variant="outlined"
          />

          <v-textarea
            v-model="project.description"
            auto-grow
            class="mt-2"
            density="compact"
            hide-details
            label="描述"
            rows="2"
            variant="outlined"
          />

          <div class="d-flex align-center ga-3 mt-2 flex-wrap">
            <v-select
              density="compact"
              hide-details
              :items="canvasOptions"
              label="画布档位"
              :model-value="canvasKey"
              style="max-width: 160px"
              variant="outlined"
              @update:model-value="onCanvasChange"
            />

            <v-select
              density="compact"
              hide-details
              :items="fpsOptions"
              label="输出帧率"
              :model-value="project.fps"
              style="max-width: 130px"
              variant="outlined"
              @update:model-value="onFpsChange"
            />

            <v-select
              density="compact"
              hide-details
              :items="presetOptions"
              label="压制预设"
              :model-value="project.encodePreset"
              style="max-width: 160px"
              variant="outlined"
              @update:model-value="onPresetChange"
            />

            <v-btn
              density="comfortable"
              icon="mdi-information-outline"
              size="small"
              title="查看当前档位的 ffmpeg 指令与调校说明"
              variant="text"
              @click="encodeInfoDialog = true"
            />
          </div>

          <div class="text-caption text-medium-emphasis mt-1">
            切换档位不换算既有关键帧坐标；压制预设影响 x264 tune（动画适合大色块低噪声画面）
          </div>
        </v-card>

        <div class="mb-4">
          <VideoConfigCard class="mb-4" />
          <TransitionCard />
        </div>

        <v-btn
          color="primary"
          :disabled="exporting"
          prepend-icon="mdi-export"
          size="large"
          @click="showExport = true"
        >
          导出素材
        </v-btn>
      </v-col>

      <v-col cols="12" md="5">
        <OverlayPanel />
        <OverlayStaticPreview />
      </v-col>
    </v-row>

    <ExportDialog v-model="showExport" />

    <EncodeInfoDialog v-model="encodeInfoDialog" />

    <v-dialog v-model="importDialog" max-width="400">
      <v-card>
        <v-card-title class="text-body-1">导入工程</v-card-title>

        <v-card-text class="text-body-2">
          将用「{{ pendingImportFile?.name }}」覆盖当前工程与素材箱（含浏览器本地的自动保存），
          且不可恢复。确定？
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" @click="importDialog = false">取消</v-btn>
          <v-btn color="error" size="small" variant="tonal" @click="onConfirmImport">覆盖并导入</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="newDialog" max-width="380">
      <v-card>
        <v-card-title class="text-body-1">重置工程</v-card-title>

        <v-card-text class="text-body-2">
          将清空当前工程与素材箱（含浏览器本地存储的自动保存），且不可恢复。确定？
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" @click="newDialog = false">取消</v-btn>
          <v-btn color="error" size="small" variant="tonal" @click="onNewProject">清空并重置</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import type { EncodePreset, ProjectFps } from '@/editor-core/model'
  import { computed, onMounted, ref } from 'vue'
  import EncodeInfoDialog from '@/components/editor/EncodeInfoDialog.vue'
  import ExportDialog from '@/components/editor/ExportDialog.vue'
  import OverlayPanel from '@/components/editor/OverlayPanel.vue'
  import OverlayStaticPreview from '@/components/editor/OverlayStaticPreview.vue'
  import TransitionCard from '@/components/editor/TransitionCard.vue'
  import VideoConfigCard from '@/components/editor/VideoConfigCard.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useEditorExport } from '@/composables/useEditorExport'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { useNotifications } from '@/composables/useNotifications'
  import { CANVAS_360, CANVAS_720 } from '@/editor-core/model'
  import { serializeProject } from '@/editor-core/serialize'
  import { buildStoredZip, sanitizeZipFilename, triggerBlobDownload } from '@/utils/zipMaterial'
  // overlay 预览字体（设备端为 BebasNeue / Source Sans）
  import '@fontsource/bebas-neue'
  import '@fontsource/source-sans-3'

  const crossOriginIsolated = globalThis.crossOriginIsolated
  const {
    project,
    restoring,
    setCanvasSize,
    restoreFromDb,
    resetProject,
    importProjectArchive,
    getAssetMedia,
  } = useEditorProject()
  const { notify } = useNotifications()
  const { exporting } = useEditorExport()
  const showExport = ref(false)
  const newDialog = ref(false)
  const encodeInfoDialog = ref(false)

  onMounted(() => {
    void restoreFromDb()
  })

  async function onNewProject () {
    newDialog.value = false
    await resetProject()
  }

  const exportingProject = ref(false)
  const importingProject = ref(false)
  const importDialog = ref(false)
  const importInput = ref<HTMLInputElement>()
  const pendingImportFile = ref<File | null>(null)

  function onPickImport (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }
    pendingImportFile.value = file
    importDialog.value = true
  }

  async function onConfirmImport () {
    const file = pendingImportFile.value
    importDialog.value = false
    pendingImportFile.value = null
    if (!file) {
      return
    }
    importingProject.value = true
    try {
      await importProjectArchive(file)
      notify('工程已导入', 'success')
    } catch (error) {
      notify(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      importingProject.value = false
    }
  }

  /** 工程备份 = 剪辑数据 json + 全部素材原文件，STORE 打包（视频已压缩，再 DEFLATE 白费时间） */
  async function exportProjectFile () {
    exportingProject.value = true
    try {
      const encoder = new TextEncoder()
      const files: { name: string, data: Uint8Array | Blob }[] = [
        { name: 'project.epedit.json', data: encoder.encode(serializeProject(project.value)) },
      ]
      for (const asset of project.value.assets) {
        const media = getAssetMedia(asset.id)
        if (media) {
          files.push({ name: `assets/${asset.id}`, data: media.file })
        }
      }
      const blob = await buildStoredZip(files)
      triggerBlobDownload(blob, `${sanitizeZipFilename(project.value.name)}.epedit.zip`)
    } finally {
      exportingProject.value = false
    }
  }

  const canvasOptions = [
    { title: '360x640', value: '360' },
    { title: '720x1280', value: '720' },
  ]

  const canvasKey = computed(() => String(project.value.canvas.width))

  function onCanvasChange (key: string) {
    setCanvasSize(key === '720' ? CANVAS_720 : CANVAS_360)
  }

  const fpsOptions: { title: string, value: ProjectFps }[] = [
    { title: '60 fps', value: 60 },
    { title: '30 fps', value: 30 },
  ]

  const presetOptions: { title: string, value: EncodePreset }[] = [
    { title: '动画', value: 'animation' },
    { title: '真实视频', value: 'realistic' },
    { title: '快速（预览）', value: 'fast' },
  ]

  function onFpsChange (value: ProjectFps) {
    project.value.fps = value
  }

  function onPresetChange (value: EncodePreset) {
    project.value.encodePreset = value
  }
</script>
