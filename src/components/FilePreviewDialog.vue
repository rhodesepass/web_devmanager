<template>
  <v-dialog
    :model-value="!!preview"
    max-width="760"
    @update:model-value="v => !v && $emit('close')"
  >
    <v-card v-if="preview">
      <v-card-title class="text-truncate">{{ preview.name }}</v-card-title>
      <v-card-text>
        <template v-if="preview.kind === 'text'">
          <pre class="preview-text">{{ preview.text || '(空文件)' }}</pre>
          <div v-if="preview.truncated" class="text-caption text-medium-emphasis mt-2">
            内容过长，仅显示开头部分
          </div>
        </template>
        <div v-else class="text-center">
          <img
            :alt="preview.name"
            class="preview-image"
            :src="preview.imageUrl"
          >
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('close')">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import type { FilePreview } from '@/composables/useFileBrowser'

defineProps<{
  preview: FilePreview | null
}>()

defineEmits<{
  close: []
}>()
</script>

<style scoped>
.preview-text {
  max-height: 60vh;
  overflow: auto;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

.preview-image {
  max-width: 100%;
  max-height: 60vh;
}
</style>
