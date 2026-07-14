<template>
  <v-row v-if="items.length > 0">
    <v-col
      v-for="item in items"
      :key="item.listKey"
      cols="12"
      lg="4"
      sm="6"
    >
      <v-card class="material-card h-100 d-flex flex-column" variant="outlined">
        <v-card-item>
          <template #prepend>
            <v-avatar
              v-if="item.info.iconUrl"
              :image="item.info.iconUrl"
              rounded="lg"
              size="48"
            />

            <v-avatar v-else color="surface-variant" rounded="lg" size="48">
              <v-icon>mdi-image-off</v-icon>
            </v-avatar>
          </template>

          <v-card-title class="text-body-1 text-truncate">
            {{ item.info.name }}
          </v-card-title>

          <v-card-subtitle class="text-truncate">
            {{ item.info.uuid }}
          </v-card-subtitle>

          <template #append>
            <v-chip color="primary" size="x-small" variant="tonal">
              {{ storageLabel(item.storage) }}
            </v-chip>
          </template>
        </v-card-item>

        <v-card-text class="flex-grow-1 pt-0">
          <div class="text-caption text-medium-emphasis mb-2">
            {{ item.info.screen }}
            ·
            {{ item.info.fileCount }} 个文件
            ·
            {{ formatBytes(item.info.totalBytes) }}
          </div>

          <p class="text-body-2 material-desc mb-0">
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
    设备上暂无素材。可上传 zip 素材包到系统盘{{ sdMounted ? ' 或数据盘' : '' }}。
  </v-alert>

  <div v-else class="d-flex justify-center py-12">
    <v-progress-circular color="primary" indeterminate />
  </div>
</template>

<script lang="ts" setup>
  import type { MaterialStorage, RemoteMaterial } from '@/types/material'
  import { MATERIAL_STORAGES } from '@/types/material'
  import { formatBytes } from '@/utils/format'

  defineProps<{
    items: RemoteMaterial[]
    loading: boolean
    disabled?: boolean
    sdMounted: boolean
  }>()

  defineEmits<{
    download: [item: RemoteMaterial]
    delete: [item: RemoteMaterial]
  }>()

  function storageLabel (storage: MaterialStorage): string {
    return MATERIAL_STORAGES[storage].displayLabel
  }
</script>

<style scoped>
.material-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
</style>
