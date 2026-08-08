<template>
  <v-card class="pa-3" variant="tonal">
    <div class="d-flex align-center ga-3">
      <span class="text-body-2">叠加 UI（overlay）</span>

      <v-select
        density="compact"
        hide-details
        :items="typeOptions"
        :model-value="project.overlay.type"
        style="max-width: 190px"
        variant="outlined"
        @update:model-value="setOverlayType"
      />
    </div>

    <div class="text-caption text-medium-emphasis mt-1">
      设备运行时叠加在 loop 上的图层，不烧进视频；预览为近似复刻
    </div>

    <template v-if="imageOverlay">
      <v-text-field
        class="mt-3"
        density="compact"
        hide-details
        label="显示时机(s，>0)"
        :model-value="imageOverlay.appearTimeUs / 1_000_000"
        :step="0.1"
        type="number"
        variant="outlined"
        @change="setImageAppearTime"
      />

      <v-text-field
        class="mt-2"
        density="compact"
        hide-details
        label="进场滑入时长(ms，>0)"
        :model-value="imageOverlay.durationUs / 1000"
        type="number"
        variant="outlined"
        @change="setImageDuration"
      />

      <div class="d-flex align-center ga-2 mt-2">
        <v-btn
          density="comfortable"
          prepend-icon="mdi-image-edit-outline"
          size="small"
          variant="tonal"
          @click="imageCropDialog = true"
        >
          {{ imageOverlay.image ? '重新裁剪图片' : '选择图片' }}
        </v-btn>

        <img
          v-if="imageOverlay.image"
          alt="叠加图片"
          class="custom-thumb custom-thumb--tall"
          :src="imageOverlay.image"
          title="点击重新裁剪"
          @click="imageCropDialog = true"
        >
      </div>

      <div class="text-caption text-medium-emphasis mt-2">
        整屏 9:16 覆盖绘制，显示时机后从底部滑入；
        独占 254 色配额，三种叠加里色彩还原最好，透明区域保留
      </div>

      <ImageCropDialog
        v-model="imageCropDialog"
        :aspect-ratio="9 / 16"
        :fixed-output="{ width: 360, height: 640 }"
        hint="9:16 裁剪，输出整屏 360×640（360 档基准，720 档打包时 ×2）；透明背景保留"
        title="叠加图片"
        @confirm="onImageCropped"
      />
    </template>

    <template v-if="overlay">
      <v-text-field
        class="mt-3"
        density="compact"
        hide-details
        label="显示时机(s，>0)"
        :model-value="overlay.appearTimeUs / 1_000_000"
        :step="0.1"
        type="number"
        variant="outlined"
        @change="setAppearTime"
      />

      <v-text-field
        v-model="overlay.operatorName"
        class="mt-2"
        density="compact"
        hide-details
        label="干员名 (Bebas)"
        variant="outlined"
      />

      <v-text-field
        v-model="overlay.operatorCode"
        class="mt-2"
        density="compact"
        hide-details
        label="干员代号"
        variant="outlined"
      />

      <v-text-field
        v-model="overlay.barcodeText"
        class="mt-2"
        density="compact"
        hide-details
        label="条码文本 (Code128)"
        variant="outlined"
      />

      <v-textarea
        v-model="overlay.auxText"
        auto-grow
        class="mt-2"
        density="compact"
        hide-details
        label="辅助文本（≤3 行）"
        rows="3"
        variant="outlined"
      />

      <v-text-field
        v-model="overlay.staffText"
        class="mt-2"
        density="compact"
        hide-details
        label="STAFF 文本"
        variant="outlined"
      />

      <div class="d-flex align-center ga-2 mt-2">
        <input
          class="color-input"
          type="color"
          :value="overlay.color"
          @input="overlay.color = ($event.target as HTMLInputElement).value"
        >

        <v-text-field
          v-model="overlay.color"
          density="compact"
          hide-details
          label="主题色 #RRGGBB（右下渐变）"
          variant="outlined"
        />
      </div>

      <div class="d-flex ga-2 mt-2 align-center">
        <v-select
          density="compact"
          hide-details
          :items="logoOptions"
          label="Logo"
          :model-value="logoValue"
          variant="outlined"
          @update:model-value="onLogoChange"
        />

        <img
          v-if="overlay.customLogo"
          alt="自定义 logo"
          class="custom-thumb"
          :src="overlay.customLogo"
          title="点击重新裁剪"
          @click="logoCropDialog = true"
        >
      </div>

      <div class="d-flex ga-2 mt-2 align-center">
        <v-select
          density="compact"
          hide-details
          :items="classOptions"
          label="职业图标"
          :model-value="classValue"
          variant="outlined"
          @update:model-value="onClassChange"
        />

        <img
          v-if="overlay.customClassIcon"
          alt="自定义职业图标"
          class="custom-thumb custom-thumb--square"
          :src="overlay.customClassIcon"
          title="点击重新裁剪"
          @click="classCropDialog = true"
        >
      </div>

      <ImageCropDialog
        v-model="logoCropDialog"
        hint="将等比缩到 120×60 内（360 档基准，贴右下角显示）；设备端量化到 24 色，扁平色块效果最好，透明背景保留"
        :max-output="{ width: 120, height: 60 }"
        title="自定义 Logo"
        @confirm="onLogoCropped"
        @update:model-value="onLogoCropClosed"
      />

      <ImageCropDialog
        v-model="classCropDialog"
        :aspect-ratio="1"
        :fixed-output="{ width: 50, height: 50 }"
        hint="输出 50×50（360 档基准）；设备端量化到 16 色，透明背景保留"
        title="自定义职业图标"
        @confirm="onClassCropped"
        @update:model-value="onClassCropClosed"
      />

      <v-text-field
        v-model="overlay.topLeftRhodes"
        class="mt-2"
        density="compact"
        hide-details
        label="左上竖排文字（空=罗德岛 logo）"
        variant="outlined"
      />

      <v-text-field
        v-model="overlay.topRightBarText"
        class="mt-2"
        density="compact"
        hide-details
        label="右上 bar 文字（空=默认）"
        variant="outlined"
      />

      <div class="text-caption text-medium-emphasis mt-2">
        overlay 层为 256 色调色板：logo 24 色 / 职业图标 16 色，照片类图片会出现色带
      </div>
    </template>
  </v-card>
</template>

<script setup lang="ts">
  import type { LogoPreset, OperatorClass } from '@/editor-core/model'
  import { computed, ref } from 'vue'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { createArknightsOverlay, createImageOverlay } from '@/editor-core/model'
  import ImageCropDialog from './ImageCropDialog.vue'

  const { project } = useEditorProject()

  const overlay = computed(() =>
    project.value.overlay.type === 'arknights' ? project.value.overlay : null)
  const imageOverlay = computed(() =>
    project.value.overlay.type === 'image' ? project.value.overlay : null)

  const typeOptions = [
    { title: '无', value: 'none' },
    { title: '明日方舟模板', value: 'arknights' },
    { title: '图片叠加', value: 'image' },
  ]

  function setOverlayType (type: string) {
    if (type === project.value.overlay.type) {
      return
    }
    switch (type) {
      case 'arknights': {
        project.value.overlay = createArknightsOverlay()
        break
      }
      case 'image': {
        project.value.overlay = createImageOverlay()
        break
      }
      default: {
        project.value.overlay = { type: 'none' }
      }
    }
  }

  // ---- image overlay ----

  const imageCropDialog = ref(false)

  function setImageAppearTime (event: Event) {
    const sec = Number((event.target as HTMLInputElement).value)
    if (imageOverlay.value && Number.isFinite(sec) && sec > 0) {
      imageOverlay.value.appearTimeUs = Math.round(sec * 1_000_000)
    }
  }

  function setImageDuration (event: Event) {
    const ms = Number((event.target as HTMLInputElement).value)
    if (imageOverlay.value && Number.isFinite(ms) && ms > 0) {
      imageOverlay.value.durationUs = Math.round(ms * 1000)
    }
  }

  function onImageCropped (dataUrl: string) {
    if (imageOverlay.value) {
      imageOverlay.value.image = dataUrl
    }
  }

  const logoOptions = [
    { title: '无', value: 'none' },
    { title: 'Arknights', value: 'arknights' },
    { title: 'StarRail', value: 'starrail' },
    { title: '自定义图片…', value: 'custom' },
  ]

  const classOptions = [
    { title: '无', value: 'none' },
    { title: '先锋 vanguard', value: 'vanguard' },
    { title: '近卫 guard', value: 'guard' },
    { title: '重装 defender', value: 'defender' },
    { title: '狙击 sniper', value: 'sniper' },
    { title: '术师 caster', value: 'caster' },
    { title: '医疗 medic', value: 'medic' },
    { title: '辅助 supporter', value: 'supporter' },
    { title: '特种 specialist', value: 'specialist' },
    { title: '自定义图片…', value: 'custom' },
  ]

  // ---- 自定义图片（复用裁剪，PNG 保 alpha）----

  const logoCropDialog = ref(false)
  const classCropDialog = ref(false)

  const logoValue = computed(() =>
    overlay.value?.customLogo ? 'custom' : (overlay.value?.logoPreset ?? 'none'))
  const classValue = computed(() =>
    overlay.value?.customClassIcon ? 'custom' : (overlay.value?.classIcon ?? 'none'))

  function onLogoChange (v: string) {
    if (!overlay.value) {
      return
    }
    if (v === 'custom') {
      logoCropDialog.value = true
      return
    }
    overlay.value.customLogo = null
    overlay.value.logoPreset = v === 'none' ? null : v as LogoPreset
  }

  function onLogoCropped (dataUrl: string) {
    if (overlay.value) {
      overlay.value.customLogo = dataUrl
      overlay.value.logoPreset = null
    }
  }

  function onLogoCropClosed (open: boolean) {
    // 取消且没有既有自定义图时，select 回落到原值（computed 自动）
    logoCropDialog.value = open
  }

  function onClassChange (v: string) {
    if (!overlay.value) {
      return
    }
    if (v === 'custom') {
      classCropDialog.value = true
      return
    }
    overlay.value.customClassIcon = null
    overlay.value.classIcon = v === 'none' ? null : v as OperatorClass
  }

  function onClassCropped (dataUrl: string) {
    if (overlay.value) {
      overlay.value.customClassIcon = dataUrl
      overlay.value.classIcon = null
    }
  }

  function onClassCropClosed (open: boolean) {
    classCropDialog.value = open
  }

  function setAppearTime (event: Event) {
    if (!overlay.value) {
      return
    }
    const sec = Number((event.target as HTMLInputElement).value)
    if (Number.isFinite(sec) && sec > 0) {
      overlay.value.appearTimeUs = Math.round(sec * 1_000_000)
    }
  }
</script>

<style scoped>
.color-input {
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
}

.custom-thumb {
  flex: 0 0 auto;
  max-width: 72px;
  max-height: 40px;
  border: 1px solid rgba(127, 127, 127, 0.4);
  border-radius: 4px;
  cursor: pointer;
  background:
    repeating-conic-gradient(rgba(127, 127, 127, 0.25) 0% 25%, transparent 0% 50%)
    0 0 / 8px 8px;
}

.custom-thumb--square {
  width: 40px;
  height: 40px;
}

.custom-thumb--tall {
  max-width: 45px;
  max-height: 80px;
}
</style>
