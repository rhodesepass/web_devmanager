<template>
  <v-card class="shared-app-card h-100 d-flex flex-column" variant="outlined">
    <div v-if="previewUrl" ref="previewRef" class="card-banner bg-surface-variant">
      <video
        v-if="previewVisible && previewIsVideo"
        autoplay
        class="banner-media"
        loop
        muted
        playsinline
        :src="previewUrl"
      />
      <v-img
        v-else-if="previewVisible"
        class="banner-media"
        cover
        height="140"
        :src="previewUrl"
      />
    </div>

    <v-card-item>
      <template #prepend>
        <v-avatar
          v-if="iconUrl"
          :image="iconUrl"
          rounded="lg"
          size="48"
        />
        <v-avatar v-else color="surface-variant" rounded="lg" size="48">
          <v-icon>mdi-application</v-icon>
        </v-avatar>
      </template>

      <v-card-title class="text-body-1 text-truncate">
        {{ entry.name }}
      </v-card-title>

      <v-card-subtitle class="text-truncate">
        {{ versionText }}
        <template v-if="entry.app_type"> · {{ APP_TYPE_LABELS[entry.app_type] }}</template>
      </v-card-subtitle>

      <template #append>
        <v-chip
          v-if="stateChip"
          :color="stateChip.color"
          size="x-small"
          :variant="stateChip.variant"
        >
          {{ stateChip.text }}
        </v-chip>
      </template>
    </v-card-item>

    <v-card-text class="flex-grow-1 pt-0">
      <p class="text-body-2 shared-desc mb-2">
        {{ entry.desc }}
      </p>

      <div v-if="entry.badges.length > 0" class="d-flex flex-wrap ga-1">
        <v-chip
          v-for="badge in entry.badges"
          :key="badge"
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
        :color="actionButton.color"
        :disabled="!entry.download_url || disabled || actionButton.disabled"
        :loading="downloading"
        :prepend-icon="actionButton.icon"
        size="small"
        :variant="actionButton.variant"
        @click="$emit('action', entry)"
      >
        {{ actionButton.text }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script lang="ts" setup>
  import type { SharedAppEntry, SharedAppInstallState } from '@/types/app'
  import { computed, onMounted, onUnmounted, ref } from 'vue'
  import { APP_TYPE_LABELS } from '@/types/app'
  import { resolveSharedAppUrl } from '@/utils/sharedApps'

  const props = defineProps<{
    entry: SharedAppEntry
    /** 未连接设备时为 null:不显示安装状态,按钮只做下载 */
    installState: SharedAppInstallState | null
    installedVer?: number | null
    disabled?: boolean
    downloading?: boolean
  }>()

  defineEmits<{
    action: [entry: SharedAppEntry]
  }>()

  const previewRef = ref<HTMLElement | null>(null)
  const previewVisible = ref(false)

  const previewUrl = resolveSharedAppUrl(props.entry.preview)
  const iconUrl = resolveSharedAppUrl(props.entry.icon)
  const previewIsVideo = /\.(mp4|webm)$/i.test(props.entry.preview ?? '')

  const versionText = computed(() =>
    props.entry.ver_name ?? `v${props.entry.app_ver}`,
  )

  const stateChip = computed(() => {
    switch (props.installState) {
      case 'installed': {
        return { text: '已安装', color: 'success', variant: 'flat' as const }
      }
      case 'updatable': {
        return { text: '可更新', color: 'warning', variant: 'flat' as const }
      }
      case 'maybe_updatable': {
        return { text: '可更新?', color: 'warning', variant: 'tonal' as const }
      }
      default: {
        return null
      }
    }
  })

  const actionButton = computed(() => {
    switch (props.installState) {
      case 'not_installed': {
        return { text: '安装到通行证', icon: 'mdi-usb', color: 'primary', variant: 'flat' as const, disabled: false }
      }
      case 'updatable': {
        const from = props.installedVer && props.installedVer > 0 ? `v${props.installedVer}→` : ''
        return { text: `更新 ${from}v${props.entry.app_ver}`, icon: 'mdi-update', color: 'warning', variant: 'flat' as const, disabled: false }
      }
      case 'maybe_updatable': {
        return { text: '重新安装(版本未知)', icon: 'mdi-update', color: 'warning', variant: 'tonal' as const, disabled: false }
      }
      case 'installed': {
        return { text: '已是最新', icon: 'mdi-check', color: undefined, variant: 'tonal' as const, disabled: true }
      }
      default: {
        return { text: '下载 zip', icon: 'mdi-download', color: undefined, variant: 'tonal' as const, disabled: false }
      }
    }
  })

  let observer: IntersectionObserver | null = null

  onMounted(() => {
    if (!previewUrl) {
      return
    }
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            previewVisible.value = true
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
.shared-app-card {
  overflow: hidden;
}

.card-banner {
  height: 140px;
  overflow: hidden;
}

.banner-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.shared-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-line;
}
</style>
