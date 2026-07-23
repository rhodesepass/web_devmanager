<template>
  <div>
    <PageHeader
      subtitle="查看、上传与下载设备上的应用"
      title="APP 管理"
    />

    <v-alert v-if="!connected" class="mb-4" type="info" variant="tonal">
      请先连接设备以管理设备上的 App。
    </v-alert>

    <div v-if="connected" class="d-flex flex-wrap align-center ga-2 mb-4">
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
        text="为加快图标加载，App 图标会缓存在浏览器本地。若图标显示异常，可点此清除缓存并重新加载。"
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

      <v-btn
        :disabled="transferring"
        prepend-icon="mdi-storefront-outline"
        to="/apps/share"
        variant="tonal"
      >
        应用商店
      </v-btn>

      <v-spacer />

      <v-chip
        v-if="updatableUuids.size > 0"
        color="warning"
        prepend-icon="mdi-update"
        size="small"
        variant="tonal"
        @click="$router.push('/apps/share')"
      >
        {{ updatableUuids.size }} 个应用可更新
      </v-chip>

      <v-chip
        v-if="sdMounted"
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

      <AppList
        :disabled="transferring"
        :items="apps"
        :loading="loading"
        :sd-mounted="sdMounted"
        :updatable-uuids="updatableUuids"
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
        <v-card title="上传 App">
          <v-card-text>
            <p class="text-body-2 text-medium-emphasis mb-4">
              选择包含 appconfig.json 的 App zip 包，将解压后上传到设备。
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
        title="删除 App"
        @confirm="onDeleteConfirm"
      />
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { AppStorage, RemoteApp, SharedAppEntry } from '@/types/app'
  import { computed, onMounted, ref, toRef } from 'vue'
  import AppList from '@/components/AppList.vue'
  import ConfirmDialog from '@/components/ConfirmDialog.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useApps } from '@/composables/useApps'
  import { useNotifications } from '@/composables/useNotifications'
  import { useUsb } from '@/composables/useUsb'
  import { clearAllAppIconCache } from '@/utils/appIconCache'
  import { formatBytes } from '@/utils/format'
  import { fetchSharedAppManifest, updatableUuidSet } from '@/utils/sharedApps'

  const { notify } = useNotifications()
  const { connected, client, devInfo } = useUsb()

  const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')

  const {
    apps,
    loading,
    transferring,
    transferProgress,
    storageOptions,
    refresh,
    uploadZip,
    downloadZip,
    deleteApp,
  } = useApps(toRef(client), sdMounted)

  // 商店 manifest 后台静默拉取,失败不打扰(离线也能正常管理设备应用)
  const storeEntries = ref<SharedAppEntry[]>([])

  const updatableUuids = computed(() =>
    updatableUuidSet(storeEntries.value, apps.value),
  )

  onMounted(async () => {
    try {
      storeEntries.value = await fetchSharedAppManifest()
    } catch {
      // 静默失败
    }
  })

  const transferPercent = computed(() => {
    const p = transferProgress.value
    if (!p || p.total <= 0) return 0
    return Math.min(100, Math.round((p.bytes / p.total) * 100))
  })

  const showUploadDialog = ref(false)
  const uploadStorage = ref<AppStorage>('nand')
  const fileInput = ref<HTMLInputElement | null>(null)
  const pendingDelete = ref<RemoteApp | null>(null)

  const showDeleteConfirm = computed({
    get: () => pendingDelete.value != null,
    set: (v: boolean) => {
      if (!v) pendingDelete.value = null
    },
  })

  const deleteMessage = computed(() => {
    const a = pendingDelete.value
    if (!a) return ''
    return `确定删除 App「${a.info.name}」？此操作不可恢复。`
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

  async function onDownload (item: RemoteApp) {
    try {
      await downloadZip(item)
    } catch {
    // errors handled in composable
    }
  }

  async function onDeleteConfirm () {
    const a = pendingDelete.value
    if (!a) return
    pendingDelete.value = null
    await deleteApp(a)
  }

  async function onClearIconCache () {
    clearAllAppIconCache()
    notify('已清除图标缓存，正在重新加载…', 'info')
    await refresh()
  }
</script>
