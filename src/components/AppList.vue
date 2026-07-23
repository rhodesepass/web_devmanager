<template>
  <v-row v-if="items.length > 0">
    <v-col
      v-for="item in items"
      :key="item.listKey"
      cols="12"
      lg="4"
      sm="6"
    >
      <v-card class="app-card h-100 d-flex flex-column" variant="outlined">
        <v-card-item>
          <template #prepend>
            <v-avatar
              v-if="item.info.iconUrl"
              :image="item.info.iconUrl"
              rounded="lg"
              size="48"
            />

            <v-avatar v-else color="surface-variant" rounded="lg" size="48">
              <v-icon>mdi-application</v-icon>
            </v-avatar>
          </template>

          <v-card-title class="text-body-1 text-truncate">
            {{ item.info.name }}
          </v-card-title>

          <v-card-subtitle class="text-truncate">
            {{ item.info.uuid }}
          </v-card-subtitle>

          <template #append>
            <div class="d-flex flex-column align-end ga-1">
              <v-chip color="primary" size="x-small" variant="tonal">
                {{ storageLabel(item.storage) }}
              </v-chip>
              <v-chip
                v-if="updatableUuids?.has(item.info.uuid)"
                color="warning"
                size="x-small"
                variant="flat"
              >
                可更新
              </v-chip>
            </div>
          </template>
        </v-card-item>

        <v-card-text class="flex-grow-1 pt-0">
          <div class="d-flex flex-wrap ga-1 mb-2">
            <v-chip color="secondary" size="x-small" variant="tonal">
              {{ typeLabel(item.info.type) }}
            </v-chip>
            <v-chip
              v-for="s in item.info.screens"
              :key="s"
              size="x-small"
              variant="outlined"
            >
              {{ s }}
            </v-chip>
            <v-chip
              v-for="e in item.info.extensions"
              :key="`ext-${e}`"
              color="info"
              size="x-small"
              variant="tonal"
            >
              .{{ e }}
            </v-chip>
          </div>

          <div class="text-caption text-medium-emphasis mb-2">
            <template v-if="item.info.appVer > 0">v{{ item.info.appVer }} · </template>
            {{ item.info.executable }}
            ·
            {{ item.info.fileCount }} 个文件
            ·
            {{ formatBytes(item.info.totalBytes) }}
          </div>

          <p class="text-body-2 app-desc mb-0">
            {{ item.info.description }}
          </p>
        </v-card-text>

        <v-card-actions class="pt-0">
          <v-btn
            :disabled="disabled"
            prepend-icon="mdi-download"
            size="small"
            variant="tonal"
            @click="$emit('download', item)"
          >
            下载
          </v-btn>

          <v-spacer />

          <v-btn
            color="error"
            :disabled="disabled"
            icon="mdi-delete"
            size="small"
            variant="text"
            @click="$emit('delete', item)"
          />
        </v-card-actions>
      </v-card>
    </v-col>
  </v-row>

  <v-alert
    v-else-if="!loading"
    type="info"
    variant="tonal"
  >
    设备上暂无 App。可上传 zip 应用包到系统盘{{ sdMounted ? ' 或数据盘' : '' }}。
  </v-alert>

  <div v-else class="d-flex justify-center py-12">
    <v-progress-circular color="primary" indeterminate />
  </div>
</template>

<script lang="ts" setup>
  import type { AppStorage, AppType, RemoteApp } from '@/types/app'
  import { APP_STORAGES, APP_TYPE_LABELS } from '@/types/app'
  import { formatBytes } from '@/utils/format'

  defineProps<{
    items: RemoteApp[]
    loading: boolean
    disabled?: boolean
    sdMounted: boolean
    /** 应用商店里有更高版本的 uuid 集合,命中的卡片显示「可更新」角标 */
    updatableUuids?: Set<string>
  }>()

  defineEmits<{
    download: [item: RemoteApp]
    delete: [item: RemoteApp]
  }>()

  function storageLabel (storage: AppStorage): string {
    return APP_STORAGES[storage].displayLabel
  }

  function typeLabel (type: AppType): string {
    return APP_TYPE_LABELS[type]
  }
</script>

<style scoped>
.app-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
</style>
