<template>
  <v-card class="disp-img-card" variant="tonal">
    <div class="thumb-wrap" @click="$emit('preview', info)">
      <v-chip
        v-if="resolutionTag"
        class="res-badge"
        :color="resolutionTag === '720' ? 'primary' : 'grey'"
        label
        size="x-small"
        variant="flat"
      >
        {{ resolutionTag }}
      </v-chip>
      <v-img
        v-if="info.thumbUrl"
        aspect-ratio="0.5625"
        cover
        :src="info.thumbUrl"
      />
      <div v-else class="thumb-placeholder">
        <v-progress-circular indeterminate size="24" width="2" />
      </div>
    </div>

    <div class="pa-2">
      <div class="text-caption text-truncate" :title="info.name">
        {{ info.name }}
      </div>
      <div class="text-caption text-medium-emphasis">
        {{ formatBytes(info.sizeBytes) }}
      </div>
    </div>

    <v-divider />

    <v-card-actions class="py-1">
      <v-btn
        density="comfortable"
        :disabled="disabled"
        icon="mdi-download"
        size="small"
        variant="text"
        @click="$emit('download', info)"
      />
      <v-spacer />
      <v-btn
        color="error"
        density="comfortable"
        :disabled="disabled"
        icon="mdi-delete"
        size="small"
        variant="text"
        @click="$emit('delete', info)"
      />
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { DispImgInfo } from '@/types/dispimg'
  import { computed, onMounted } from 'vue'
  import { nearestDispImgWidth } from '@/types/dispimg'
  import { formatBytes } from '@/utils/format'

  const props = defineProps<{
    info: DispImgInfo
    disabled?: boolean
  }>()

  const resolutionTag = computed(() => {
    const w = nearestDispImgWidth(props.info.width)
    return w == null ? null : String(w)
  })

  const emit = defineEmits<{
    preview: [info: DispImgInfo]
    download: [info: DispImgInfo]
    delete: [info: DispImgInfo]
    visible: [info: DispImgInfo]
  }>()

  onMounted(() => {
    if (!props.info.thumbUrl) {
      emit('visible', props.info)
    }
  })
</script>

<style scoped>
.thumb-wrap {
  position: relative;
  cursor: pointer;
  background: #000;
}

.res-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
}

.thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 0.5625;
}
</style>
