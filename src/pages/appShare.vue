<template>
  <div class="app-share" :class="{ 'app-share--embed': isEmbed }">
    <PageHeader
      v-if="!isEmbed"
      subtitle="无需连接设备即可浏览与下载；连接后可一键安装 / 更新"
      title="应用商店"
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
        placeholder="搜索应用名称或描述…"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
      />

      <span class="text-caption text-medium-emphasis">
        {{ filteredEntries.length }} / {{ allEntries.length }}
      </span>

      <v-spacer v-if="!isEmbed" />

      <v-btn
        v-if="!isEmbed"
        :disabled="busy"
        prepend-icon="mdi-arrow-left"
        :to="busy ? undefined : '/apps'"
        variant="text"
      >
        设备应用
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
      v-if="!isEmbed && !connected"
      class="mb-4"
      type="info"
      variant="tonal"
    >
      连接通行证后可一键安装应用，并显示已安装 / 可更新状态。
    </v-alert>

    <v-card
      v-if="downloading && downloadProgress"
      class="mb-4 pa-4"
      variant="tonal"
    >
      <div class="text-body-2 mb-2">正在下载：{{ downloadProgress.name }}</div>
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
      <div class="text-body-2 mb-2">上传：{{ transferProgress.fileName }}</div>
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

    <div v-if="loading && allEntries.length === 0" class="d-flex justify-center py-12">
      <v-progress-circular color="primary" indeterminate />
    </div>

    <v-row v-else-if="filteredEntries.length > 0">
      <v-col
        v-for="entry in filteredEntries"
        :key="entry.uuid"
        cols="12"
        lg="4"
        sm="6"
      >
        <SharedAppCard
          :disabled="busy"
          :downloading="downloadingUuid === entry.uuid"
          :entry="entry"
          :install-state="connected ? entryStates.get(entry.uuid)?.state ?? null : null"
          :installed-ver="entryStates.get(entry.uuid)?.installedVer"
          @action="onCardAction"
        />
      </v-col>
    </v-row>

    <v-alert
      v-else-if="!loading"
      type="info"
      variant="tonal"
    >
      {{ searchQuery.trim() ? '没有匹配的应用' : '应用清单为空' }}
    </v-alert>

    <v-dialog v-if="!isEmbed" v-model="showStorageDialog" max-width="420">
      <v-card title="安装到通行证">
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-4">
            将下载「{{ pendingEntry?.name }}」并解压安装到设备。
          </p>
          <v-select
            v-model="installStorage"
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
            @click="confirmInstall(false)"
          >
            开始安装
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-if="!isEmbed" v-model="showUpdateDialog" max-width="440">
      <v-card :title="`更新 ${pendingEntry?.name ?? ''} ${pendingEntry?.ver_name ?? `v${pendingEntry?.app_ver ?? ''}`}`">
        <v-card-text>
          <p v-if="pendingEntry?.changelog" class="text-body-2 mb-3 update-changelog">{{ pendingEntry.changelog }}</p>
          <p class="text-body-2 text-medium-emphasis mb-0">
            更新会先删除设备上的旧版本目录，再写入新版本。
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showUpdateDialog = false">取消</v-btn>
          <v-btn
            color="warning"
            :loading="downloading || transferring"
            @click="confirmInstall(true)"
          >
            开始更新
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { AppStorage, SharedAppEntry, SharedAppInstallState } from '@/types/app'
  import { computed, onMounted, ref } from 'vue'
  import PageHeader from '@/components/PageHeader.vue'
  import SharedAppCard from '@/components/SharedAppCard.vue'
  import { useApps } from '@/composables/useApps'
  import { useEmbedMode } from '@/composables/useEmbedMode'
  import { useNotifications } from '@/composables/useNotifications'
  import { useTransferLock } from '@/composables/useTransferLock'
  import { useUsb } from '@/composables/useUsb'
  import { formatBytes } from '@/utils/format'
  import {
    downloadSharedAppZipFile,
    fetchSharedAppManifest,
    filterSharedApps,
    resolveSharedAppUrl,
    sharedAppInstallState,
    triggerSharedAppLocalDownload,
  } from '@/utils/sharedApps'

  const { isEmbed } = useEmbedMode()
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  const { connected } = useUsb()

  const {
    apps,
    transferring,
    transferProgress,
    storageOptions,
    bindAutoLoad,
    uploadZip,
  } = useApps()

  bindAutoLoad()

  const allEntries = ref<SharedAppEntry[]>([])
  const searchQuery = ref('')
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const downloading = ref(false)
  const downloadingUuid = ref<string | null>(null)
  const downloadProgress = ref<{ name: string, loaded: number, total: number | null } | null>(null)

  const showStorageDialog = ref(false)
  const showUpdateDialog = ref(false)
  const pendingEntry = ref<SharedAppEntry | null>(null)
  const installStorage = ref<AppStorage>('nand')

  const filteredEntries = computed(() =>
    filterSharedApps(allEntries.value, searchQuery.value),
  )

  const entryStates = computed(() => {
    const map = new Map<string, { state: SharedAppInstallState, installedVer: number | null }>()
    if (!connected.value) {
      return map
    }
    for (const entry of allEntries.value) {
      map.set(entry.uuid, sharedAppInstallState(entry, apps.value))
    }
    return map
  })

  const busy = computed(() => loading.value || downloading.value || transferring.value)

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
      allEntries.value = await fetchSharedAppManifest()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      loadError.value = msg
    } finally {
      loading.value = false
    }
  }

  function onCardAction (entry: SharedAppEntry) {
    if (isEmbed.value) {
      const url = resolveSharedAppUrl(entry.download_url)
      if (url) {
        window.location.assign(url)
      }
      return
    }
    pendingEntry.value = entry
    if (!connected.value) {
      void runLocalDownload(entry)
      return
    }
    const state = entryStates.value.get(entry.uuid)?.state ?? 'not_installed'
    if (state === 'not_installed') {
      installStorage.value = 'nand'
      showStorageDialog.value = true
    } else if (state === 'updatable' || state === 'maybe_updatable') {
      showUpdateDialog.value = true
    }
  }

  async function runLocalDownload (entry: SharedAppEntry) {
    downloading.value = true
    downloadingUuid.value = entry.uuid
    downloadProgress.value = { name: entry.name, loaded: 0, total: null }
    transferLock.begin('下载应用', entry.name)
    try {
      await triggerSharedAppLocalDownload(entry, (loaded, total) => {
        downloadProgress.value = { name: entry.name, loaded, total }
        transferLock.update(entry.name, loaded, total ?? 0)
      })
      notify(`已下载: ${entry.zip ?? entry.name}`, 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`下载失败: ${msg}`, 'error')
    } finally {
      downloading.value = false
      downloadingUuid.value = null
      downloadProgress.value = null
      transferLock.end()
    }
  }

  async function confirmInstall (isUpdate: boolean) {
    const entry = pendingEntry.value
    if (!entry || !connected.value) {
      return
    }
    showStorageDialog.value = false
    showUpdateDialog.value = false

    try {
      downloading.value = true
      downloadingUuid.value = entry.uuid
      downloadProgress.value = { name: entry.name, loaded: 0, total: null }
      transferLock.begin('下载应用', entry.name)

      const file = await downloadSharedAppZipFile(entry, (loaded, total) => {
        downloadProgress.value = { name: entry.name, loaded, total }
        transferLock.update(entry.name, loaded, total ?? 0)
      })

      downloading.value = false
      downloadingUuid.value = null
      downloadProgress.value = null
      transferLock.end()

      await uploadZip(file, installStorage.value, { overwrite: isUpdate })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`${isUpdate ? '更新' : '安装'}失败「${entry.name}」: ${msg}`, 'error')
    } finally {
      downloading.value = false
      downloadingUuid.value = null
      downloadProgress.value = null
      transferLock.end()
    }
  }

  onMounted(() => {
    void loadManifest()
  })
</script>

<style scoped>
.search-field {
  flex: 1;
  min-width: 200px;
  max-width: 400px;
}

.app-share--embed .search-field {
  max-width: none;
}

.sticky-search {
  position: sticky;
  top: 0;
  z-index: 2;
  padding-top: 8px;
  padding-bottom: 8px;
  background: rgb(var(--v-theme-surface));
}

.update-changelog {
  white-space: pre-line;
}
</style>
