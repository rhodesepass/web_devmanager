<template>
  <div
    class="material-share"
    :class="{ 'material-share--embed': isEmbed }"
  >
    <div class="material-share-top">
      <PageHeader
        v-if="!isEmbed"
        subtitle="无需连接设备即可浏览与下载；连接后可传入通行证"
        title="素材预览"
      />

      <div
        class="d-flex flex-wrap align-center ga-3 mb-4"
        :class="{ 'sticky-search': isEmbed }"
      >
      <v-text-field
        v-model="searchQuery"
        autocomplete="off"
        class="search-field"
        clearable
        density="comfortable"
        hide-details
        placeholder="搜索素材名称或描述…"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
      />

      <span class="text-caption text-medium-emphasis">
        {{ filteredAssets.length }} / {{ allAssets.length }}
      </span>

      <v-spacer v-if="!isEmbed" />

      <v-btn
        v-if="!isEmbed"
        :disabled="busy"
        prepend-icon="mdi-arrow-left"
        :to="busy ? undefined : '/materials'"
        variant="text"
      >
        设备素材
      </v-btn>

      <v-btn
        :disabled="busy"
        :loading="loading"
        prepend-icon="mdi-refresh"
        variant="tonal"
        @click="loadManifest"
      >
        刷新
      </v-btn>
      </div>

      <v-alert
      v-if="loadError"
      class="mb-4"
      type="error"
      variant="tonal"
    >
      {{ loadError }}
      <template #append>
        <v-btn size="small" variant="text" @click="loadManifest">重试</v-btn>
      </template>
    </v-alert>

    <v-alert
      v-if="!isEmbed && !connected && showConnectHint"
      class="mb-4"
      type="info"
      variant="tonal"
    >
      连接通行证后可使用「传入通行证」将素材直接上传到设备。
    </v-alert>

    <v-card
      v-if="downloading && downloadProgress"
      class="mb-4 pa-4"
      variant="tonal"
    >
      <div class="text-body-2 mb-2">
        正在下载：{{ downloadProgress.name }}
      </div>
      <v-progress-linear
        color="primary"
        height="8"
        :indeterminate="downloadProgress.total == null"
        :model-value="downloadPercent"
        rounded
      />
      <div
        v-if="downloadProgress.total != null"
        class="text-caption text-medium-emphasis mt-1"
      >
        {{ formatBytes(downloadProgress.loaded) }} / {{ formatBytes(downloadProgress.total) }}
      </div>
    </v-card>

    <v-card
      v-if="!isEmbed && transferring && transferProgress"
      class="mb-4 pa-4"
      variant="tonal"
    >
      <div class="text-body-2 mb-2">
        上传：{{ transferProgress.fileName }}
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
    </div>

    <div class="material-share-body">
      <div v-if="loading && allAssets.length === 0" class="d-flex justify-center py-12">
        <v-progress-circular color="primary" indeterminate />
      </div>

      <v-virtual-scroll
        v-else-if="assetRows.length > 0"
        class="material-grid-scroll"
        height="100%"
        :item-height="ROW_HEIGHT"
        item-key="key"
        :items="assetRows"
      >
        <template #default="{ item: row }">
          <v-row class="material-grid-row" dense>
            <v-col
              v-for="asset in row.assets"
              :key="asset.uuid"
              cols="6"
              lg="2"
              md="3"
              sm="4"
            >
              <SharedMaterialCard
                :asset="asset"
                :disabled="busy"
                :downloading="downloadingAssetUuid === asset.uuid"
                @download="onDownloadClick"
              />
            </v-col>
          </v-row>
        </template>
      </v-virtual-scroll>

      <v-alert
        v-else-if="!loading"
        type="info"
        variant="tonal"
      >
        {{ searchQuery.trim() ? '没有匹配的素材' : '素材清单为空' }}
      </v-alert>
    </div>

    <v-dialog v-if="!isEmbed" v-model="showTargetDialog" max-width="400">
      <v-card title="选择下载方式">
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-0">
            {{ pendingAsset?.name }}
          </p>
        </v-card-text>
        <v-card-actions class="flex-column align-stretch pa-4 pt-0 ga-2">
          <v-btn
            block
            prepend-icon="mdi-download"
            variant="tonal"
            @click="onChooseLocal"
          >
            下载到本地
          </v-btn>
          <v-btn
            block
            color="primary"
            prepend-icon="mdi-usb"
            variant="flat"
            @click="onChoosePass"
          >
            {{ connected ? '传入通行证' : '连接设备后传入' }}
          </v-btn>
          <v-btn block variant="text" @click="showTargetDialog = false">
            取消
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-if="!isEmbed" v-model="showStorageDialog" max-width="420">
      <v-card title="传入通行证">
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">
            将下载素材 zip 并解压上传到设备。
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
          <v-btn variant="text" @click="showStorageDialog = false">取消</v-btn>
          <v-btn
            color="primary"
            :loading="downloading || transferring"
            @click="confirmUploadToPass"
          >
            开始上传
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { MaterialStorage, SharedMaterialAsset } from '@/types/material'
  import { computed, onMounted, ref, toRef } from 'vue'
  import { useRouter } from 'vue-router'
  import { useDisplay } from 'vuetify'
  import PageHeader from '@/components/PageHeader.vue'
  import { useEmbedMode } from '@/composables/useEmbedMode'
  import SharedMaterialCard from '@/components/SharedMaterialCard.vue'
  import { useMaterials } from '@/composables/useMaterials'
  import { useNotifications } from '@/composables/useNotifications'
  import { useTransferLock } from '@/composables/useTransferLock'
  import { useUsb } from '@/composables/useUsb'
  import { formatBytes } from '@/utils/format'
  import {
    downloadSharedMaterialZipFile,
    fetchSharedMaterialManifest,
    filterSharedMaterials,
    navigateSharedMaterialDownload,
    triggerSharedMaterialLocalDownload,
  } from '@/utils/sharedMaterials'

  /** 与 SharedMaterialCard 布局对齐的固定行高（px） */
  const ROW_HEIGHT = 460

  interface MaterialAssetRow {
    key: string
    assets: SharedMaterialAsset[]
  }

  const router = useRouter()
  const { smAndUp, mdAndUp, lgAndUp } = useDisplay()
  const { isEmbed } = useEmbedMode()
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  const { connected, client, devInfo } = useUsb()

  const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')

  const {
    transferring,
    transferProgress,
    storageOptions,
    uploadZip,
  } = useMaterials(toRef(client), sdMounted)

  const allAssets = ref<SharedMaterialAsset[]>([])
  const searchQuery = ref('')
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const downloading = ref(false)
  const downloadingAssetUuid = ref<string | null>(null)
  const downloadProgress = ref<{
    name: string
    loaded: number
    total: number | null
  } | null>(null)

  const showTargetDialog = ref(false)
  const showStorageDialog = ref(false)
  const pendingAsset = ref<SharedMaterialAsset | null>(null)
  const uploadStorage = ref<MaterialStorage>('nand')
  const showConnectHint = ref(true)

  const filteredAssets = computed(() =>
    filterSharedMaterials(allAssets.value, searchQuery.value),
  )

  const columnsPerRow = computed(() => {
    if (lgAndUp.value) {
      return 6
    }
    if (mdAndUp.value) {
      return 4
    }
    if (smAndUp.value) {
      return 3
    }
    return 2
  })

  const assetRows = computed((): MaterialAssetRow[] => {
    const assets = filteredAssets.value
    const cols = columnsPerRow.value
    const rows: MaterialAssetRow[] = []
    for (let i = 0; i < assets.length; i += cols) {
      const chunk = assets.slice(i, i + cols)
      rows.push({
        key: chunk.map(a => a.uuid).join('|'),
        assets: chunk,
      })
    }
    return rows
  })

  const busy = computed(
    () => loading.value || downloading.value || transferring.value,
  )

  const downloadPercent = computed(() => {
    const p = downloadProgress.value
    if (!p || p.total == null || p.total <= 0) {
      return 0
    }
    return Math.min(100, Math.round((p.loaded / p.total) * 100))
  })

  const transferPercent = computed(() => {
    const p = transferProgress.value
    if (!p || p.total <= 0) {
      return 0
    }
    return Math.min(100, Math.round((p.bytes / p.total) * 100))
  })

  const storageSelectItems = computed(() =>
    storageOptions.value.map(o => ({
      label: o.displayLabel,
      value: o.storage,
    })),
  )

  async function loadManifest () {
    loading.value = true
    loadError.value = null
    try {
      allAssets.value = await fetchSharedMaterialManifest()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      loadError.value = msg
      notify(`加载素材清单失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  function onDownloadClick (asset: SharedMaterialAsset) {
    if (isEmbed.value) {
      try {
        navigateSharedMaterialDownload(asset)
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        notify(`下载失败: ${msg}`, 'error')
      }
      return
    }
    pendingAsset.value = asset
    showTargetDialog.value = true
  }

  function onChooseLocal () {
    showTargetDialog.value = false
    const asset = pendingAsset.value
    if (!asset) {
      return
    }
    void runLocalDownload(asset)
  }

  function onChoosePass () {
    if (!connected.value) {
      notify('请先连接通行证设备', 'warning')
      showTargetDialog.value = false
      void router.push('/')
      return
    }
    showTargetDialog.value = false
    uploadStorage.value = 'nand'
    showStorageDialog.value = true
  }

  async function runLocalDownload (asset: SharedMaterialAsset) {
    downloading.value = true
    downloadingAssetUuid.value = asset.uuid
    downloadProgress.value = { name: asset.name, loaded: 0, total: null }
    transferLock.begin('下载素材', asset.name)
    try {
      await triggerSharedMaterialLocalDownload(asset, (loaded, total) => {
        downloadProgress.value = { name: asset.name, loaded, total }
        transferLock.update(asset.name, loaded, total ?? 0)
      })
      notify(`已下载: ${asset.zip ?? asset.name}`, 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`下载失败: ${msg}`, 'error')
    } finally {
      downloading.value = false
      downloadingAssetUuid.value = null
      downloadProgress.value = null
      transferLock.end()
    }
  }

  async function confirmUploadToPass () {
    const asset = pendingAsset.value
    if (!asset || !connected.value) {
      return
    }
    showStorageDialog.value = false
    downloading.value = true
    downloadingAssetUuid.value = asset.uuid
    downloadProgress.value = { name: asset.name, loaded: 0, total: null }
    transferLock.begin('下载素材', asset.name)

    try {
      const file = await downloadSharedMaterialZipFile(asset, (loaded, total) => {
        downloadProgress.value = { name: asset.name, loaded, total }
        transferLock.update(asset.name, loaded, total ?? 0)
      })
      downloading.value = false
      downloadingAssetUuid.value = null
      downloadProgress.value = null
      transferLock.end()

      await uploadZip(file, uploadStorage.value)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`传入通行证失败: ${msg}`, 'error')
    } finally {
      downloading.value = false
      downloadingAssetUuid.value = null
      downloadProgress.value = null
      transferLock.end()
    }
  }

  onMounted(() => {
    void loadManifest()
  })
</script>

<style scoped>
.material-share {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
}

.material-share--embed {
  height: 100vh;
  min-height: 100vh;
}

.material-share-top {
  flex-shrink: 0;
}

.material-share-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}

.material-grid-scroll {
  height: 100%;
}

.material-grid-row {
  margin-bottom: 0;
}

.sticky-search {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-top: 8px;
  padding-bottom: 8px;
  background: rgb(var(--v-theme-surface));
}

.search-field {
  flex: 1;
  min-width: 200px;
  max-width: 400px;
}

.material-share--embed .search-field {
  max-width: none;
}
</style>
