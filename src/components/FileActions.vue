<template>
  <v-toolbar density="compact" flat color="transparent" class="mb-2">
    <v-btn
      icon="mdi-arrow-up"
      variant="text"
      :disabled="currentPath === '.'"
      @click="$emit('goUp')"
    />
    <v-btn icon="mdi-refresh" variant="text" @click="$emit('refresh')" />

    <v-divider vertical class="mx-2" />

    <v-btn
      prepend-icon="mdi-upload"
      variant="text"
      @click="$emit('upload')"
    >
      上传
    </v-btn>

    <v-btn
      prepend-icon="mdi-download"
      variant="text"
      :disabled="selected.length !== 1 || isDirSelected"
      @click="$emit('download')"
    >
      下载
    </v-btn>

    <v-btn
      prepend-icon="mdi-delete"
      variant="text"
      color="error"
      :disabled="selected.length === 0"
      @click="$emit('delete')"
    >
      删除
    </v-btn>

    <v-btn
      prepend-icon="mdi-rename"
      variant="text"
      :disabled="selected.length !== 1"
      @click="$emit('rename')"
    >
      重命名
    </v-btn>

    <v-btn
      prepend-icon="mdi-folder-plus"
      variant="text"
      @click="$emit('mkdir')"
    >
      新建文件夹
    </v-btn>

    <v-spacer />

    <v-chip v-if="uploading" color="primary" variant="tonal" size="small">
      <v-progress-circular indeterminate size="14" width="2" class="mr-1" />
      上传中 {{ uploadProgress }}%
    </v-chip>
  </v-toolbar>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { FileEntry } from '@/composables/useFileBrowser'

const props = defineProps<{
  currentPath: string
  selected: string[]
  items: FileEntry[]
  uploading: boolean
  uploadProgress: number
}>()

defineEmits<{
  goUp: []
  refresh: []
  upload: []
  download: []
  delete: []
  rename: []
  mkdir: []
}>()

const isDirSelected = computed(() => {
  if (props.selected.length !== 1) return false
  const entry = props.items.find(e => e.name === props.selected[0])
  return entry?.isDir ?? false
})
</script>
