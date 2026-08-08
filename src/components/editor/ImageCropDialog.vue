<template>
  <v-dialog
    max-width="560"
    :model-value="modelValue"
    persistent
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card class="pa-4">
      <div class="text-h6 mb-2">{{ title }}</div>

      <div v-if="hint" class="text-caption text-medium-emphasis mb-2">{{ hint }}</div>

      <input
        ref="fileInput"
        accept="image/png,image/jpeg,image/webp"
        class="d-none"
        type="file"
        @change="onPick"
      >

      <div v-if="!imageSrc" class="crop-empty" @click="fileInput?.click()">
        <v-icon icon="mdi-image-plus-outline" size="40" />
        <div class="text-body-2 mt-2">选择图片</div>
      </div>

      <template v-else>
        <div class="cropper-area">
          <img ref="imageEl" alt="" class="crop-img" :src="imageSrc">
        </div>

        <div class="d-flex ga-1 mt-2">
          <v-btn
            density="compact"
            icon="mdi-rotate-left"
            size="small"
            variant="text"
            @click="rotateBy(-90)"
          />

          <v-btn
            density="compact"
            icon="mdi-rotate-right"
            size="small"
            variant="text"
            @click="rotateBy(90)"
          />

          <v-btn
            density="compact"
            icon="mdi-restore"
            size="small"
            variant="text"
            @click="resetCrop"
          />

          <v-btn density="compact" size="small" variant="text" @click="fileInput?.click()">换图</v-btn>
        </div>
      </template>

      <div class="d-flex mt-3">
        <v-spacer />
        <v-btn size="small" variant="text" @click="close">取消</v-btn>

        <v-btn
          color="primary"
          :disabled="!imageSrc"
          size="small"
          variant="tonal"
          @click="confirm"
        >确定</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
  import Cropper from 'cropperjs'
  import { nextTick, ref, watch } from 'vue'
  import 'cropperjs/dist/cropper.css'

  const props = defineProps<{
    modelValue: boolean
    title: string
    hint?: string
    /** 裁剪框比例；不传 = 自由比例 */
    aspectRatio?: number
    /** 固定输出尺寸（如职业图标 50×50）；与 maxOutput 二选一 */
    fixedOutput?: { width: number, height: number }
    /** 等比缩进该范围（小图不放大），如 logo ≤120×60 */
    maxOutput?: { width: number, height: number }
  }>()

  const emit = defineEmits<{
    'update:modelValue': [boolean]
    /** PNG dataURL（透明底保 alpha）与最终像素尺寸 */
    'confirm': [dataUrl: string, width: number, height: number]
  }>()

  const fileInput = ref<HTMLInputElement>()
  const imageEl = ref<HTMLImageElement>()
  const imageSrc = ref<string | null>(null)

  let cropper: Cropper | null = null

  function destroyCropper () {
    cropper?.destroy()
    cropper = null
  }

  function rotateBy (deg: number) {
    cropper?.rotate(deg)
  }

  function resetCrop () {
    cropper?.reset()
  }

  function initCropper () {
    if (!imageEl.value) {
      return
    }
    destroyCropper()
    cropper = new Cropper(imageEl.value, {
      // NaN = 自由比例（cropperjs 约定）
      aspectRatio: props.aspectRatio ?? Number.NaN,
      viewMode: 1,
      autoCropArea: 1,
      dragMode: 'move',
      background: true,
      responsive: true,
    })
  }

  function onPick (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.addEventListener('load', async () => {
      imageSrc.value = reader.result as string
      await nextTick()
      initCropper()
    })
    reader.readAsDataURL(file)
  }

  function targetSize (w: number, h: number): { width: number, height: number } {
    if (props.fixedOutput) {
      return props.fixedOutput
    }
    if (props.maxOutput) {
      const scale = Math.min(props.maxOutput.width / w, props.maxOutput.height / h, 1)
      return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
    }
    return { width: w, height: h }
  }

  function confirm () {
    if (!cropper) {
      return
    }
    // 不设 fillColor：裁剪画布透明底，alpha 全程保留（区别于扩列图的填黑 JPEG 管线）
    const cropped = cropper.getCroppedCanvas({
      maxWidth: 2048,
      maxHeight: 2048,
      imageSmoothingQuality: 'high',
    })
    const { width, height } = targetSize(cropped.width, cropped.height)
    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cropped, 0, 0, width, height)
    emit('confirm', out.toDataURL('image/png'), width, height)
    close()
  }

  function close () {
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
.crop-empty {
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed rgba(127, 127, 127, 0.5);
  border-radius: 8px;
  cursor: pointer;
  opacity: 0.8;
}

.crop-empty:hover {
  border-color: rgba(138, 180, 248, 0.7);
  opacity: 1;
}

.cropper-area {
  height: 320px;
  background:
    repeating-conic-gradient(rgba(127, 127, 127, 0.18) 0% 25%, transparent 0% 50%)
    0 0 / 16px 16px;
}

.crop-img {
  display: block;
  max-width: 100%;
}
</style>
