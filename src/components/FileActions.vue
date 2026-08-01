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
      prepend-icon="mdi-folder-upload"
      variant="text"
      @click="$emit('uploadFolder')"
    >
      上传文件夹
    </v-btn>

    <v-btn
      prepend-icon="mdi-eye"
      variant="text"
      :disabled="!isPreviewableSelected"
      @click="$emit('preview')"
    >
      预览
    </v-btn>

    <v-btn
      :prepend-icon="isDirSelected ? 'mdi-folder-download' : 'mdi-download'"
      variant="text"
      :disabled="selected.length !== 1"
      @click="$emit('download')"
    >
      {{ isDirSelected ? '下载文件夹' : '下载' }}
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
import { type FileEntry, isPreviewable } from '@/composables/useFileBrowser'

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
  uploadFolder: []
  preview: []
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

const isPreviewableSelected = computed(() => {
  if (props.selected.length !== 1) return false
  const entry = props.items.find(e => e.name === props.selected[0])
  return entry ? isPreviewable(entry) : false
})
</script>
