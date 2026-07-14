<template>
  <v-app>
    <v-navigation-drawer
      v-if="!isEmbed"
      permanent
      rail
      color="surface"
      border="end"
    >
      <template #prepend>
        <div class="d-flex justify-center py-4">
          <v-img :src="logo" width="36" height="36" />
        </div>
      </template>

      <v-list nav density="compact" class="px-2">
        <v-tooltip
          v-for="item in navItems"
          :key="item.path"
          :text="item.title"
          location="end"
        >
          <template #activator="{ props: tooltipProps }">
            <v-list-item
              v-bind="tooltipProps"
              :disabled="transferLocked"
              :to="transferLocked ? undefined : item.path"
              :prepend-icon="item.icon"
              :value="item.path"
              rounded="lg"
              class="mb-1"
            />
          </template>
        </v-tooltip>
      </v-list>

      <template #append>
        <div class="d-flex justify-center pb-4">
          <v-tooltip
            :text="connectionTooltip"
            location="end"
          >
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :color="connected ? 'success' : 'primary'"
                :disabled="transferLocked || !isSupported"
                :icon="connected ? 'mdi-link-off' : 'mdi-usb-port'"
                :loading="connecting"
                size="small"
                variant="tonal"
                @click="onToggleConnection"
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </v-navigation-drawer>

    <v-main scrollable>
      <v-container
        fluid
        class="page-container pa-6"
        :class="{ 'page-container--embed': isEmbed }"
      >
        <router-view />
      </v-container>
    </v-main>

    <TransferLockOverlay />

    <PlatformNoticeDialog
      v-model="showPlatformNotice"
      :kind="platformNoticeKind"
      @dismiss="dismissPlatformNotice"
    />

    <v-snackbar-queue
      v-model="notifications"
      location="bottom"
      :z-index="2500"
      closable
      variant="elevated"
      :timeout="4000"
    />
  </v-app>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import PlatformNoticeDialog from '@/components/PlatformNoticeDialog.vue'
import TransferLockOverlay from '@/components/TransferLockOverlay.vue'
import { useEmbedMode } from '@/composables/useEmbedMode'
import { useNotifications } from '@/composables/useNotifications'
import { usePlatformNotice } from '@/composables/usePlatformNotice'
import { useTransferLock } from '@/composables/useTransferLock'
import { useUsb } from '@/composables/useUsb'
import logo from '@/assets/logo.svg'

const { notifications } = useNotifications()
const { connected, isSupported, connect, disconnect } = useUsb()
const { isEmbed } = useEmbedMode()
const { active: transferLocked } = useTransferLock()
const {
  show: showPlatformNotice,
  kind: platformNoticeKind,
  dismiss: dismissPlatformNotice,
} = usePlatformNotice(isEmbed.value)

const connecting = ref(false)

const connectionTooltip = computed(() => {
  if (!isSupported.value) {
    return '当前浏览器不支持 WebUSB'
  }
  if (transferLocked.value) {
    return '传输进行中，请稍候'
  }
  return connected.value ? '断开连接' : '连接设备'
})

async function onToggleConnection () {
  if (transferLocked.value || !isSupported.value) {
    return
  }
  if (connected.value) {
    await disconnect()
    return
  }
  connecting.value = true
  try {
    await connect()
  } finally {
    connecting.value = false
  }
}

const navItems = [
  { path: '/', icon: 'mdi-usb', title: '连接' },
  { path: '/files', icon: 'mdi-folder', title: '文件' },
  { path: '/materials', icon: 'mdi-play-box-multiple', title: '素材' },
  { path: '/materials/share', icon: 'mdi-earth', title: '素材库' },
  { path: '/dispimg', icon: 'mdi-image-multiple', title: '扩列图' },
  { path: '/terminal', icon: 'mdi-console', title: '终端' },
  { path: '/flash', icon: 'mdi-chip', title: '烧录' },
]
</script>

<style scoped>
.page-container {
  max-width: 1280px;
}

.page-container--embed {
  max-width: none;
  padding: 12px !important;
}
</style>
