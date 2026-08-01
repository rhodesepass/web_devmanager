<template>
  <div>
    <PageHeader
      subtitle="查看、上传与下载设备上的动画素材包"
      title="素材管理"
    />

    <v-alert v-if="!connected" class="mb-4" type="info" variant="tonal">
      请先连接设备以管理设备上的素材；也可直接进入素材库浏览与下载分享素材。
    </v-alert>

    <div class="d-flex flex-wrap align-center ga-2 mb-4">
      <template v-if="connected">
        <v-btn
          :disabled="transferring"
          :loading="loading"
          prepend-icon="mdi-refresh"
          variant="tonal"
          @click="refresh"
        >
          刷新
        </v-btn>

        <v-btn
          color="primary"
          :disabled="transferring"
          prepend-icon="mdi-upload"
          @click="openUpload"
        >
          上传 zip
        </v-btn>

        <v-tooltip
          location="bottom"
          max-width="280"
          text="为加快图标加载，素材图标会缓存在浏览器本地。若图标显示异常，可点此清除缓存并重新加载。"
        >
          <template #activator="{ props: tooltipProps }">
            <v-btn
              v-bind="tooltipProps"
              :disabled="transferring"
              prepend-icon="mdi-image-remove-outline"
              variant="tonal"
              @click="onClearIconCache"
            >
              清除图标缓存
            </v-btn>
          </template>
        </v-tooltip>
      </template>

      <v-btn
        :disabled="transferring"
        prepend-icon="mdi-earth"
        to="/materials/share"
        variant="tonal"
      >
        素材库
      </v-btn>

      <v-spacer v-if="connected" />

      <v-chip
        v-if="connected && sdMounted"
        color="success"
        prepend-icon="mdi-sd"
        size="small"
        variant="tonal"
      >
        SD 已挂载
      </v-chip>
    </div>

    <template v-if="connected">
      <v-card
        v-if="transferring && transferProgress"
        class="mb-4 pa-4"
        variant="tonal"
      >
        <div class="text-body-2 mb-2">
          {{ transferProgress.isUpload ? '上传' : '下载' }}：
          {{ transferProgress.fileName }}
        </div>

        <v-progress-linear
          color="primary"
          height="8"
          :model-value="transferPercent"
          rounded
        />

        <div class="text-caption text-medium-emphasis mt-1">
          {{ formatBytes(transferProgress.bytes) }} / {{ formatBytes(transferProgress.total) }}
        </div>
      </v-card>

      <v-card
        v-if="loadProgress && !transferring"
        class="mb-4 pa-4"
        variant="tonal"
      >
        <div class="d-flex align-center justify-space-between text-body-2 mb-2">
          <span>{{ loadPhaseLabel }}</span>
          <span v-if="loadProgress.total > 0" class="text-medium-emphasis">
            {{ loadProgress.done }} / {{ loadProgress.total }}
          </span>
        </div>

        <v-progress-linear
          color="primary"
          height="8"
          :indeterminate="loadProgress.total === 0"
          :model-value="loadPercent"
          rounded
        />

        <div
          v-if="loadProgress.label"
          class="text-caption text-medium-emphasis mt-1 text-truncate"
        >
          {{ loadProgress.label }}
        </div>
      </v-card>

      <MaterialList
        :disabled="transferring"
        :items="materials"
        :loading="loading"
        :sd-mounted="sdMounted"
        @delete="pendingDelete = $event"
        @download="onDownload"
      />

      <input
        ref="fileInput"
        accept=".zip,application/zip"
        class="d-none"
        type="file"
        @change="onFileSelected"
      >

      <v-dialog v-model="showUploadDialog" max-width="420">
        <v-card title="上传素材">
          <v-card-text>
            <p class="text-body-2 text-medium-emphasis mb-4">
              选择包含 epconfig.json 的素材 zip 包，将解压后上传到设备。
            </p>

            <v-select
              v-model="uploadStorage"
              density="comfortable"
              hide-details
              item-title="label"
              item-value="value"
              :items="storageSelectItems"
              label="目标存储"
              variant="outlined"
            />
          </v-card-text>

          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showUploadDialog = false">取消</v-btn>
            <v-btn color="primary" @click="pickZipFile">选择 zip</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <ConfirmDialog
        v-model="showDeleteConfirm"
        :message="deleteMessage"
        title="删除素材"
        @confirm="onDeleteConfirm"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { MaterialStorage, RemoteMaterial } from '@/types/material'
  import { computed, ref } from 'vue'
  import ConfirmDialog from '@/components/ConfirmDialog.vue'
  import MaterialList from '@/components/MaterialList.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useMaterials } from '@/composables/useMaterials'
  import { useNotifications } from '@/composables/useNotifications'
  import { useUsb } from '@/composables/useUsb'
  import { formatBytes } from '@/utils/format'
  import { clearAllMaterialIconCache } from '@/utils/materialIconCache'

  const { notify } = useNotifications()
  const { connected, devInfo } = useUsb()

  const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')

  const {
    materials,
    loading,
    transferring,
    transferProgress,
    loadProgress,
    storageOptions,
    bindAutoLoad,
    refresh,
    uploadZip,
    downloadZip,
    deleteMaterial,
  } = useMaterials()

  bindAutoLoad()

  const transferPercent = computed(() => {
    const p = transferProgress.value
    if (!p || p.total <= 0) return 0
    return Math.min(100, Math.round((p.bytes / p.total) * 100))
  })

  const loadPercent = computed(() => {
    const p = loadProgress.value
    if (!p || p.total <= 0) return 0
    return Math.min(100, Math.round((p.done / p.total) * 100))
  })

  const loadPhaseLabel = computed(() => {
    switch (loadProgress.value?.phase) {
      case 'meta': { return '读取素材信息…' }
      case 'icon': { return '加载图标…' }
      default: { return '扫描素材目录…' }
    }
  })

  const showUploadDialog = ref(false)
  const uploadStorage = ref<MaterialStorage>('nand')
  const fileInput = ref<HTMLInputElement | null>(null)
  const pendingDelete = ref<RemoteMaterial | null>(null)

  const showDeleteConfirm = computed({
    get: () => pendingDelete.value != null,
    set: (v: boolean) => {
      if (!v) pendingDelete.value = null
    },
  })

  const deleteMessage = computed(() => {
    const m = pendingDelete.value
    if (!m) return ''
    return `确定删除素材「${m.info.name}」？此操作不可恢复。`
  })

  const storageSelectItems = computed(() =>
    storageOptions.value.map(o => ({
      label: o.displayLabel,
      value: o.storage,
    })),
  )

  function openUpload () {
    uploadStorage.value = 'nand'
    showUploadDialog.value = true
  }

  function pickZipFile () {
    showUploadDialog.value = false
    fileInput.value?.click()
  }

  async function onFileSelected (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      await uploadZip(file, uploadStorage.value)
    } catch {
    // errors handled in composable
    }
  }

  async function onDownload (item: RemoteMaterial) {
    try {
      await downloadZip(item)
    } catch {
    // errors handled in composable
    }
  }

  async function onDeleteConfirm () {
    const m = pendingDelete.value
    if (!m) return
    pendingDelete.value = null
    await deleteMaterial(m)
  }

  async function onClearIconCache () {
    clearAllMaterialIconCache()
    notify('已清除图标缓存，正在重新加载…', 'info')
    await refresh()
  }
</script>
