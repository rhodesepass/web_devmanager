<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    persistent
    scrollable
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card title="上传扩列图">
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          选择图片后拖动 / 缩放裁剪框，裁剪框固定 9:16 竖屏比例。确认后按所选分辨率编码为 JPEG 上传到设备。
        </p>

        <input
          ref="fileInput"
          accept="image/*"
          class="d-none"
          type="file"
          @change="onFileSelected"
        >

        <div v-if="!imageSrc" class="pick-placeholder" @click="pickImage">
          <v-icon size="48">mdi-image-plus</v-icon>
          <div class="text-body-2 mt-2">点击选择图片</div>
        </div>

        <template v-else>
          <div class="cropper-area">
            <img
              ref="imageEl"
              alt="裁剪预览"
              :src="imageSrc"
              @load="initCropper"
            >
          </div>

          <div class="d-flex flex-wrap align-center ga-2 mt-3">
            <v-btn
              prepend-icon="mdi-rotate-left"
              size="small"
              variant="tonal"
              @click="rotate(-90)"
            >
              左转
            </v-btn>
            <v-btn
              prepend-icon="mdi-rotate-right"
              size="small"
              variant="tonal"
              @click="rotate(90)"
            >
              右转
            </v-btn>
            <v-btn
              prepend-icon="mdi-restore"
              size="small"
              variant="tonal"
              @click="resetCropper"
            >
              重置
            </v-btn>
            <v-btn
              prepend-icon="mdi-image-refresh"
              size="small"
              variant="tonal"
              @click="pickImage"
            >
              换图
            </v-btn>
          </div>
        </template>

        <v-select
          v-model="resolutionValue"
          class="mt-4"
          density="comfortable"
          hide-details
          item-title="label"
          item-value="value"
          :items="DISP_IMG_RESOLUTIONS"
          label="成品分辨率"
          variant="outlined"
        />
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">取消</v-btn>
        <v-btn
          color="primary"
          :disabled="!imageSrc"
          :loading="processing"
          @click="confirm"
        >
          裁剪并上传
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import Cropper from 'cropperjs'
  import { nextTick, ref, watch } from 'vue'
  import { DISP_IMG_ASPECT, DISP_IMG_RESOLUTIONS } from '@/types/dispimg'
  import { encodeCroppedCanvas, nextDispImgFileName } from '@/utils/dispImgProcess'
  import { useNotifications } from '@/composables/useNotifications'
  import 'cropperjs/dist/cropper.css'

  const props = defineProps<{ modelValue: boolean }>()
  const emit = defineEmits<{
    'update:modelValue': [value: boolean]
    confirm: [blob: Blob, name: string]
  }>()

  const { notify } = useNotifications()

  const fileInput = ref<HTMLInputElement | null>(null)
  const imageEl = ref<HTMLImageElement | null>(null)
  const imageSrc = ref<string | null>(null)
  const resolutionValue = ref<string>(DISP_IMG_RESOLUTIONS[0].value)
  const processing = ref(false)

  let cropper: Cropper | null = null

  function destroyCropper () {
    cropper?.destroy()
    cropper = null
  }

  function initCropper () {
    if (!imageEl.value) {
      return
    }
    destroyCropper()
    cropper = new Cropper(imageEl.value, {
      aspectRatio: DISP_IMG_ASPECT,
      viewMode: 1,
      autoCropArea: 1,
      dragMode: 'move',
      background: false,
      responsive: true,
    })
  }

  function pickImage () {
    fileInput.value?.click()
  }

  function onFileSelected (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      notify('请选择图片文件', 'warning')
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      destroyCropper()
      imageSrc.value = reader.result as string
      // src 相同也要重新触发 @load，这里 nextTick 后由 img 的 load 事件走 initCropper
      void nextTick()
    })
    reader.readAsDataURL(file)
  }

  function rotate (deg: number) {
    cropper?.rotate(deg)
  }

  function resetCropper () {
    cropper?.reset()
  }

  async function confirm () {
    if (!cropper) {
      return
    }
    const resolution = DISP_IMG_RESOLUTIONS.find(r => r.value === resolutionValue.value)
    if (!resolution) {
      return
    }
    processing.value = true
    try {
      const canvas = cropper.getCroppedCanvas({
        maxWidth: 4096,
        maxHeight: 4096,
        imageSmoothingQuality: 'high',
      })
      if (!canvas) {
        throw new Error('无法获取裁剪结果')
      }
      const blob = await encodeCroppedCanvas(canvas, resolution)
      emit('confirm', blob, nextDispImgFileName())
      close()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`裁剪失败: ${msg}`, 'error')
    } finally {
      processing.value = false
    }
  }

  function close () {
    destroyCropper()
    imageSrc.value = null
    emit('update:modelValue', false)
  }

  watch(() => props.modelValue, open => {
    if (!open) {
      destroyCropper()
      imageSrc.value = null
    }
  })
</script>

<style scoped>
.pick-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 220px;
  border: 2px dashed rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  cursor: pointer;
  color: rgb(var(--v-theme-on-surface-variant));
}

.pick-placeholder:hover {
  border-color: rgb(var(--v-theme-primary));
}

.cropper-area {
  max-height: 56vh;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.cropper-area img {
  display: block;
  max-width: 100%;
}
</style>
