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

      <v-alert
        class="mb-4"
        density="compact"
        type="info"
        variant="tonal"
      >
        {{ manifestVersion === 'new'
          ? '当前素材适用于 app 3.x 版本。'
          : '正在浏览旧版素材（适用于 3.x 之前的 app 版本）。' }}
        <template #append>
          <v-btn
            :disabled="busy"
            size="small"
            variant="text"
            @click="switchVersion(manifestVersion === 'new' ? 'old' : 'new')"
          >
            {{ manifestVersion === 'new' ? '旧版素材' : '返回 3.x 素材' }}
          </v-btn>
        </template>
      </v-alert>

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

      <v-btn
        v-if="!isEmbed"
        :color="selectionMode ? 'primary' : undefined"
        :disabled="busy"
        :prepend-icon="selectionMode ? 'mdi-close' : 'mdi-checkbox-multiple-marked-outline'"
        variant="tonal"
        @click="toggleSelectionMode"
      >
        {{ selectionMode ? '退出选择' : '批量选择' }}
      </v-btn>
      </div>

      <v-chip-group
        v-if="availableBadges.length > 0"
        v-model="selectedBadges"
        class="mb-2"
        column
        filter
        multiple
      >
        <v-chip
          v-for="badge in availableBadges"
          :key="badge"
          :color="badgeChipColor(badge)"
          size="small"
          :value="badge"
          variant="outlined"
        >
          {{ badge }}
        </v-chip>
      </v-chip-group>

      <div
        v-if="!isEmbed && selectionMode"
        class="d-flex flex-wrap align-center ga-2 mb-4"
      >
        <v-btn
          :disabled="busy || filteredAssets.length === 0"
          size="small"
          variant="tonal"
          @click="toggleSelectAll"
        >
          {{ allVisibleSelected ? '取消全选' : '全选当前' }}
        </v-btn>

        <span class="text-body-2 text-medium-emphasis">已选 {{ selectedCount }} 个</span>

        <v-spacer />

        <v-btn
          :disabled="selectedCount === 0 || busy"
          prepend-icon="mdi-download"
          size="small"
          variant="tonal"
          @click="onBatchLocal"
        >
          下载到本地
        </v-btn>

        <v-btn
          color="primary"
          :disabled="selectedCount === 0 || busy"
          prepend-icon="mdi-usb"
          size="small"
          variant="flat"
          @click="onBatchToPass"
        >
          {{ connected ? '传入通行证' : '连接后传入' }}
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
        <span v-if="batchProgress" class="text-medium-emphasis">
          [{{ batchProgress.current }}/{{ batchProgress.total }}]
        </span>
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

    <div v-if="isEmbed" class="material-share-grid">
      <div v-if="loading && allAssets.length === 0" class="d-flex justify-center py-12">
        <v-progress-circular color="primary" indeterminate />
      </div>

      <v-row v-else-if="filteredAssets.length > 0">
        <v-col
          v-for="asset in filteredAssets"
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

      <v-alert
        v-else-if="!loading"
        type="info"
        variant="tonal"
      >
        {{ hasActiveFilter ? '没有匹配的素材' : '素材清单为空' }}
      </v-alert>
    </div>

    <div v-else class="material-share-body">
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
                :selectable="selectionMode"
                :selected="selectedUuids.has(asset.uuid)"
                @download="onDownloadClick"
                @toggle="toggleAsset"
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
        {{ hasActiveFilter ? '没有匹配的素材' : '素材清单为空' }}
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
            {{ pendingBatch
              ? `将下载并上传选中的 ${pendingBatch.length} 个素材到设备。`
              : '将下载素材 zip 并解压上传到设备。' }}
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
  import { computed, onMounted, ref } from 'vue'
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
    badgeChipColor,
    collectSharedMaterialBadges,
    downloadSharedMaterialZipFile,
    fetchSharedMaterialManifest,
    filterSharedMaterials,
    navigateSharedMaterialDownload,
    type SharedManifestVersion,
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
  const { connected } = useUsb()

  const {
    transferring,
    transferProgress,
    storageOptions,
    uploadZip,
    reloadAssets,
  } = useMaterials()

  const allAssets = ref<SharedMaterialAsset[]>([])
  const searchQuery = ref('')
  const manifestVersion = ref<SharedManifestVersion>('new')
  const selectedBadges = ref<string[]>([])
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

  const selectionMode = ref(false)
  const selectedUuids = ref<Set<string>>(new Set())
  // pendingBatch 非空表示存储对话框确认后要批量处理，null 表示单个（pendingAsset）
  const pendingBatch = ref<SharedMaterialAsset[] | null>(null)
  const batchProgress = ref<{ current: number, total: number, name: string } | null>(null)

  const filteredAssets = computed(() =>
    filterSharedMaterials(allAssets.value, searchQuery.value, selectedBadges.value),
  )

  const availableBadges = computed(() => collectSharedMaterialBadges(allAssets.value))

  const hasActiveFilter = computed(
    () => searchQuery.value.trim().length > 0 || selectedBadges.value.length > 0,
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

  const selectedCount = computed(() => selectedUuids.value.size)

  const allVisibleSelected = computed(() =>
    filteredAssets.value.length > 0
    && filteredAssets.value.every(a => selectedUuids.value.has(a.uuid)),
  )

  function toggleSelectionMode () {
    selectionMode.value = !selectionMode.value
    if (!selectionMode.value) {
      selectedUuids.value = new Set()
    }
  }

  function toggleAsset (asset: SharedMaterialAsset) {
    const next = new Set(selectedUuids.value)
    if (next.has(asset.uuid)) {
      next.delete(asset.uuid)
    } else {
      next.add(asset.uuid)
    }
    selectedUuids.value = next
  }

  function toggleSelectAll () {
    if (allVisibleSelected.value) {
      selectedUuids.value = new Set()
    } else {
      selectedUuids.value = new Set(filteredAssets.value.map(a => a.uuid))
    }
  }

  function selectedAssets (): SharedMaterialAsset[] {
    return filteredAssets.value.filter(a => selectedUuids.value.has(a.uuid))
  }

  function onBatchLocal () {
    const assets = selectedAssets()
    if (assets.length === 0) {
      return
    }
    void runBatchLocalDownload(assets)
  }

  function onBatchToPass () {
    if (!connected.value) {
      notify('请先连接通行证设备', 'warning')
      void router.push('/')
      return
    }
    const assets = selectedAssets()
    if (assets.length === 0) {
      return
    }
    pendingBatch.value = assets
    pendingAsset.value = null
    uploadStorage.value = 'nand'
    showStorageDialog.value = true
  }

  async function runBatchLocalDownload (assets: SharedMaterialAsset[]) {
    let ok = 0
    for (const [i, asset] of assets.entries()) {
      batchProgress.value = { current: i + 1, total: assets.length, name: asset.name }
      downloading.value = true
      downloadingAssetUuid.value = asset.uuid
      downloadProgress.value = { name: asset.name, loaded: 0, total: null }
      transferLock.begin('批量下载素材', asset.name)
      try {
        await triggerSharedMaterialLocalDownload(asset, (loaded, total) => {
          downloadProgress.value = { name: asset.name, loaded, total }
          transferLock.update(asset.name, loaded, total ?? 0)
        })
        ok++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        notify(`下载失败「${asset.name}」: ${msg}`, 'error')
      } finally {
        downloading.value = false
        downloadingAssetUuid.value = null
        downloadProgress.value = null
        transferLock.end()
      }
    }
    batchProgress.value = null
    notify(`批量下载完成：成功 ${ok} / ${assets.length}`, ok === assets.length ? 'success' : 'warning')
  }

  function switchVersion (version: SharedManifestVersion) {
    if (manifestVersion.value === version || busy.value) {
      return
    }
    manifestVersion.value = version
    selectedBadges.value = []
    selectedUuids.value = new Set()
    void loadManifest()
  }

  async function loadManifest () {
    loading.value = true
    loadError.value = null
    try {
      allAssets.value = await fetchSharedMaterialManifest(manifestVersion.value)
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
    if (!connected.value) {
      return
    }
    const batch = pendingBatch.value
    const assets = batch ?? (pendingAsset.value ? [pendingAsset.value] : [])
    if (assets.length === 0) {
      return
    }
    showStorageDialog.value = false

    let ok = 0
    for (const [i, asset] of assets.entries()) {
      if (batch) {
        batchProgress.value = { current: i + 1, total: assets.length, name: asset.name }
      }
      try {
        downloading.value = true
        downloadingAssetUuid.value = asset.uuid
        downloadProgress.value = { name: asset.name, loaded: 0, total: null }
        transferLock.begin('下载素材', asset.name)

        const file = await downloadSharedMaterialZipFile(asset, (loaded, total) => {
          downloadProgress.value = { name: asset.name, loaded, total }
          transferLock.update(asset.name, loaded, total ?? 0)
        })

        downloading.value = false
        downloadingAssetUuid.value = null
        downloadProgress.value = null
        transferLock.end()

        // 批量时跳过每次的素材重载，整批结束后统一重载一次
        await uploadZip(file, uploadStorage.value, { skipReload: !!batch })
        ok++
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        notify(`传入通行证失败「${asset.name}」: ${msg}`, 'error')
      } finally {
        downloading.value = false
        downloadingAssetUuid.value = null
        downloadProgress.value = null
        transferLock.end()
      }
    }

    if (batch) {
      batchProgress.value = null
      pendingBatch.value = null
      if (ok > 0) {
        try {
          await reloadAssets()
        } catch {
          // reloadAssets 内部已提示
        }
      }
      notify(`批量传入完成：成功 ${ok} / ${assets.length}`, ok === assets.length ? 'success' : 'warning')
    }
  }

  onMounted(() => {
    void loadManifest()
  })
</script>

<style scoped>
.material-share:not(.material-share--embed) {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 48px);
}

.material-share--embed {
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
