<template>
  <div class="pa-2">
    <div class="d-flex ga-2 mb-2">
      <v-btn
        class="flex-grow-1"
        density="comfortable"
        prepend-icon="mdi-movie-plus-outline"
        size="small"
        variant="tonal"
        @click="videoInput?.click()"
      >
        视频
      </v-btn>

      <v-btn
        class="flex-grow-1"
        density="comfortable"
        prepend-icon="mdi-image-plus-outline"
        size="small"
        variant="tonal"
        @click="imageInput?.click()"
      >
        图片
      </v-btn>
    </div>

    <input
      ref="videoInput"
      accept="video/mp4,video/*"
      class="d-none"
      type="file"
      @change="onPick($event)"
    >

    <input
      ref="imageInput"
      accept="image/png,image/jpeg,image/webp"
      class="d-none"
      type="file"
      @change="onPick($event)"
    >

    <v-alert
      v-if="error"
      class="mb-2"
      closable
      density="compact"
      type="error"
      variant="tonal"
      @click:close="error = ''"
    >
      {{ error }}
    </v-alert>

    <div v-if="project.assets.length === 0" class="text-caption text-medium-emphasis text-center py-6">
      素材箱为空。<br>导入后可多次拖到时间轴复用。
    </div>

    <div
      v-for="asset in project.assets"
      :key="asset.id"
      class="asset-card"
      draggable="true"
      @dragend="draggingAssetId = null"
      @dragstart="onDragStart(asset, $event)"
    >
      <div class="asset-thumb">
        <img v-if="thumbByAsset.get(asset.id)" alt="" :src="thumbByAsset.get(asset.id)">
        <v-icon v-else :icon="asset.kind === 'video' ? 'mdi-movie-outline' : 'mdi-image-outline'" />
      </div>

      <div class="asset-info">
        <div class="asset-name text-caption" :title="asset.name">{{ asset.name }}</div>

        <div class="text-caption text-medium-emphasis asset-meta-line">
          <span>{{ asset.kind === 'video' ? formatUs(asset.durationUs) : '图片' }} · {{ asset.width }}×{{ asset.height }}</span>

          <v-chip v-if="countClipsUsing(asset.id) > 0" density="compact" size="x-small" variant="tonal">
            {{ countClipsUsing(asset.id) }} 处使用
          </v-chip>
        </div>
      </div>

      <div class="asset-actions">
        <v-btn
          density="compact"
          icon="mdi-timeline-plus-outline"
          size="x-small"
          title="添加到时间轴（也可直接拖入）"
          variant="text"
          @click="addToTimeline(asset)"
        />

        <v-btn
          density="compact"
          icon="mdi-delete-outline"
          size="x-small"
          title="删除素材"
          variant="text"
          @click="askRemove(asset)"
        />
      </div>
    </div>

    <div v-if="usageText" class="text-caption text-medium-emphasis mt-2 text-center">
      {{ usageText }}
    </div>

    <v-dialog v-model="removeDialog" max-width="360">
      <v-card v-if="removeTarget">
        <v-card-title class="text-body-1">删除素材</v-card-title>

        <v-card-text class="text-body-2">
          「{{ removeTarget.name }}」被 {{ countClipsUsing(removeTarget.id) }} 个片段使用，
          删除将一并移除这些片段。
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn size="small" variant="text" @click="removeDialog = false">取消</v-btn>
          <v-btn color="error" size="small" variant="tonal" @click="confirmRemove">删除</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import type { AssetMeta } from '@/editor-core/model'
  import { onMounted, ref } from 'vue'
  import { useEditorPlayback } from '@/composables/useEditorPlayback'
  import { useEditorProject } from '@/composables/useEditorProject'
  import { canPlaceClip } from '@/editor-core/clipOps'
  import { DEFAULT_IMAGE_CLIP_US, MIN_CLIP_US } from '@/editor-core/model'
  import { estimateUsage } from '@/utils/editorDb'
  import { formatUs } from './timeFormat'

  const {
    project,
    importAsset,
    removeAsset,
    countClipsUsing,
    thumbByAsset,
    activeSegment,
    selectedClip,
    addTrack,
    addClip,
    draggingAssetId,
  } = useEditorProject()
  const { playheadUs } = useEditorPlayback()

  const videoInput = ref<HTMLInputElement>()
  const imageInput = ref<HTMLInputElement>()
  const error = ref('')
  const usageText = ref('')

  async function onPick (event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) {
      return
    }
    error.value = ''
    try {
      await importAsset(file)
      void refreshUsage()
    } catch (error_) {
      error.value = error_ instanceof Error ? error_.message : String(error_)
    }
  }

  /** 目标轨 = 选中 clip 所在轨 → 最后一轨 → 自动建轨；落点 = 播放头处有空位否则轨尾 */
  function addToTimeline (asset: AssetMeta) {
    let track = selectedClip.value?.track
      ?? activeSegment.value.tracks.at(-1)
    track ??= addTrack()
    const durationUs = asset.kind === 'video' ? Math.max(asset.durationUs, MIN_CLIP_US) : DEFAULT_IMAGE_CLIP_US
    const atPlayhead = canPlaceClip(track, playheadUs.value, durationUs)
    addClip(track.id, asset.id, atPlayhead ? playheadUs.value : undefined)
  }

  function onDragStart (asset: AssetMeta, event: DragEvent) {
    draggingAssetId.value = asset.id
    event.dataTransfer?.setData('application/x-epass-asset', asset.id)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy'
    }
  }

  const removeDialog = ref(false)
  const removeTarget = ref<AssetMeta | null>(null)

  function askRemove (asset: AssetMeta) {
    if (countClipsUsing(asset.id) === 0) {
      removeAsset(asset.id)
      void refreshUsage()
      return
    }
    removeTarget.value = asset
    removeDialog.value = true
  }

  function confirmRemove () {
    if (removeTarget.value) {
      removeAsset(removeTarget.value.id)
    }
    removeDialog.value = false
    removeTarget.value = null
    void refreshUsage()
  }

  async function refreshUsage () {
    const usage = await estimateUsage()
    usageText.value = usage
      ? `本地存储 ${(usage.usageBytes / 1024 / 1024).toFixed(1)} MB / ${(usage.quotaBytes / 1024 / 1024 / 1024).toFixed(1)} GB`
      : ''
  }

  onMounted(() => {
    void refreshUsage()
  })
</script>

<style scoped>
.asset-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  margin-bottom: 6px;
  border: 1px solid rgba(127, 127, 127, 0.25);
  border-radius: 6px;
  cursor: grab;
  user-select: none;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.asset-card:hover {
  border-color: rgba(138, 180, 248, 0.6);
}

.asset-thumb {
  flex: 0 0 56px;
  height: 40px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(127, 127, 127, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
}

.asset-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-info {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-meta-line {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  overflow: hidden;
}

.asset-actions {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}

.asset-actions :deep(.v-btn) {
  width: 22px;
  height: 22px;
}
</style>
