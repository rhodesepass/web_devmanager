<template>
  <v-card class="shared-material-card h-100 d-flex flex-column" variant="outlined">
    <div
      ref="previewRef"
      class="card-preview bg-surface-variant"
    >
      <video
        v-if="previewUrl && previewVisible"
        autoplay
        class="preview-media"
        loop
        muted
        playsinline
        :src="previewUrl"
      />
      <div
        v-else
        class="preview-placeholder d-flex align-center justify-center text-disabled"
      >
        <v-icon size="48">mdi-play-box-outline</v-icon>
      </div>
    </div>

    <v-card-text class="flex-grow-1 pt-3 pb-2">
      <div class="d-flex align-center ga-2 mb-1 card-title-row">
        <v-avatar
          v-if="iconUrl && iconVisible"
          :image="iconUrl"
          class="flex-shrink-0"
          rounded="sm"
          size="28"
        />
        <span class="card-name text-body-2" :title="asset.name">{{ asset.name }}</span>
      </div>

      <div
        v-if="asset.zip"
        class="card-zip text-caption text-medium-emphasis text-truncate"
      >
        {{ asset.zip }}
      </div>

      <p class="text-caption text-medium-emphasis shared-desc mb-2 mt-0">
        {{ asset.desc }}
      </p>

      <div v-if="asset.badges.length > 0" class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="badge in asset.badges"
          :key="badge"
          :color="badgeChipColor(badge)"
          size="x-small"
          variant="tonal"
        >
          {{ badge }}
        </v-chip>
      </div>
    </v-card-text>

    <v-card-actions class="pt-0">
      <v-btn
        block
        :disabled="!asset.download_url || disabled"
        :loading="downloading"
        prepend-icon="mdi-download"
        size="small"
        variant="tonal"
        @click="$emit('download', asset)"
      >
        下载
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { SharedMaterialAsset } from '@/types/material'
  import { onMounted, onUnmounted, ref } from 'vue'
  import {
    badgeChipColor,
    resolveSharedMaterialUrl,
  } from '@/utils/sharedMaterials'

  const props = defineProps<{
    asset: SharedMaterialAsset
    disabled?: boolean
    downloading?: boolean
  }>()

  defineEmits<{
    download: [asset: SharedMaterialAsset]
  }>()

  const previewRef = ref<HTMLElement | null>(null)
  const previewVisible = ref(false)
  const iconVisible = ref(false)

  const previewUrl = resolveSharedMaterialUrl(props.asset.preview)
  const iconUrl = resolveSharedMaterialUrl(props.asset.icon)

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            previewVisible.value = true
            iconVisible.value = true
            observer?.disconnect()
            observer = null
            break
          }
        }
      },
      { rootMargin: '200px 0px' },
    )
    if (previewRef.value) {
      observer.observe(previewRef.value)
    }
  })

  onUnmounted(() => {
    observer?.disconnect()
  })
</script>

<style scoped>
.shared-material-card {
  overflow: hidden;
}

.card-preview {
  aspect-ratio: 9 / 16;
  max-height: 280px;
  overflow: hidden;
}

.preview-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.preview-placeholder {
  width: 100%;
  height: 100%;
  min-height: 120px;
}

.card-title-row {
  min-width: 0;
}

.card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-zip {
  margin: 0;
  padding: 0;
  line-height: 1.25;
}

.shared-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
  margin-top: 0;
}
</style>
