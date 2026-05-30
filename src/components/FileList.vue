<template>
  <v-data-table
    :headers="headers"
    :items="items"
    :loading="loading"
    :items-per-page="-1"
    hide-default-footer
    hover
    density="compact"
    item-value="name"
    show-select
    :model-value="selectedNames"
    @update:model-value="$emit('update:selected', $event)"
    @dblclick:row="onRowDblClick"
  >
    <template #item.name="{ item }">
      <div class="d-flex align-center">
        <v-icon size="18" class="mr-2" :color="item.isDir ? 'amber' : 'grey'">
          {{ item.isDir ? 'mdi-folder' : 'mdi-file' }}
        </v-icon>
        {{ item.name }}
      </div>
    </template>

    <template #item.size="{ item }">
      {{ item.isDir ? '-' : formatBytes(item.size ?? 0) }}
    </template>

    <template #item.perm="{ item }">
      <code v-if="item.perm" class="text-caption">{{ formatPerm(item.perm) }}</code>
      <span v-else>-</span>
    </template>

    <template #item.type="{ item }">
      {{ item.type ?? '-' }}
    </template>

    <template #no-data>
      <div class="text-center py-8 text-medium-emphasis">空目录</div>
    </template>
  </v-data-table>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { FileEntry } from '@/composables/useFileBrowser'
import { formatBytes, formatPerm } from '@/utils/format'

const props = defineProps<{
  items: FileEntry[]
  loading: boolean
  selected: string[]
}>()

const emit = defineEmits<{
  'update:selected': [value: string[]]
  navigate: [path: string]
}>()

const selectedNames = computed(() => props.selected)

const headers = [
  { title: '名称', key: 'name', sortable: true },
  { title: '大小', key: 'size', sortable: true, width: '120px' },
  { title: '权限', key: 'perm', sortable: false, width: '130px' },
  { title: '类型', key: 'type', sortable: false, width: '80px' },
]

function onRowDblClick (_event: MouseEvent, { item }: { item: FileEntry }) {
  if (item.isDir) {
    emit('navigate', item.name)
  }
}
</script>
