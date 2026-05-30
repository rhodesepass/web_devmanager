<template>
  <v-dialog :model-value="modelValue" max-width="480" @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>上传文件</v-card-title>
      <v-card-text>
        <v-file-input
          v-model="files"
          label="选择文件"
          multiple
          show-size
          prepend-icon="mdi-file-upload"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="$emit('update:modelValue', false)">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="files.length === 0"
          :loading="uploading"
          @click="onUpload"
        >
          上传
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { ref } from 'vue'

defineProps<{
  modelValue: boolean
  uploading: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  upload: [files: File[]]
}>()

const files = ref<File[]>([])

function onUpload () {
  emit('upload', files.value)
  files.value = []
}
</script>
