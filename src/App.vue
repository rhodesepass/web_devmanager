<template>
  <v-app>
    <v-navigation-drawer
      v-if="!isEmbed && !isFullscreen"
      border="end"
      class="app-rail"
      color="surface"
      permanent
      rail
    >
      <template #prepend>
        <div class="d-flex justify-center py-4">
          <v-img height="36" :src="logo" width="36" />
        </div>
      </template>

      <v-list class="px-2" density="compact" nav>
        <v-tooltip
          v-for="item in navItems"
          :key="item.path"
          location="end"
          :text="item.title"
        >
          <template #activator="{ props: tooltipProps }">
            <v-list-item
              v-bind="tooltipProps"
              class="mb-1"
              :disabled="transferLocked"
              :prepend-icon="item.icon"
              rounded="lg"
              :to="transferLocked ? undefined : item.path"
              :value="item.path"
            />
          </template>
        </v-tooltip>
      </v-list>

      <template #append>
        <div class="d-flex flex-column align-center ga-2 pb-4">
          <v-tooltip
            location="end"
            :text="connectionTooltip"
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

          <v-tooltip
            location="end"
            :text="isDark ? '切换到亮色主题' : '切换到暗色主题'"
          >
            <template #activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :icon="isDark ? 'mdi-white-balance-sunny' : 'mdi-weather-night'"
                size="small"
                variant="text"
                @click="onToggleTheme"
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </v-navigation-drawer>

    <v-main scrollable>
      <v-container
        class="page-container pa-6"
        :class="{ 'page-container--embed': isEmbed, 'page-container--fullscreen': isFullscreen }"
        fluid
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
      closable
      location="bottom"
      :timeout="4000"
      variant="elevated"
      :z-index="2500"
    />
  </v-app>
</template>

<script lang="ts" setup>
  import { computed, ref, watchEffect } from 'vue'
  import { useRoute } from 'vue-router'
  import { useTheme } from 'vuetify'
  import logo from '@/assets/logo.png'
  import PlatformNoticeDialog from '@/components/PlatformNoticeDialog.vue'
  import TransferLockOverlay from '@/components/TransferLockOverlay.vue'
  import { useEmbedMode } from '@/composables/useEmbedMode'
  import { useNotifications } from '@/composables/useNotifications'
  import { usePlatformNotice } from '@/composables/usePlatformNotice'
  import { useTransferLock } from '@/composables/useTransferLock'
  import { useUsb } from '@/composables/useUsb'
  import { THEME_STORAGE_KEY } from '@/plugins/vuetify'

  const { notifications } = useNotifications()
  const { connected, isSupported, connect, disconnect } = useUsb()
  const { isEmbed } = useEmbedMode()
  const route = useRoute()
  const isFullscreen = computed(() => route.meta.fullscreen === true)
  const { active: transferLocked } = useTransferLock()
  const {
    show: showPlatformNotice,
    kind: platformNoticeKind,
    dismiss: dismissPlatformNotice,
  } = usePlatformNotice(isEmbed.value)

  const connecting = ref(false)

  const theme = useTheme()
  const isDark = computed(() => theme.global.current.value.dark)

  // 两套设计系统的 tokens 与覆盖层按 html 上的类隔离：
  // 暗色 Sable Ops → html.sable-dark；亮色 Lone Trail → html.lt-light
  watchEffect(() => {
    document.documentElement.classList.toggle('sable-dark', isDark.value)
    document.documentElement.classList.toggle('lt-light', !isDark.value)
  })

  function onToggleTheme () {
    const next = isDark.value ? 'light' : 'dark'
    theme.change(next)
    localStorage.setItem(THEME_STORAGE_KEY, next)
  }

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
    { path: '/editor', icon: 'mdi-movie-edit-outline', title: '素材编辑' },
    { path: '/apps', icon: 'mdi-apps', title: '应用' },
    { path: '/apps/share', icon: 'mdi-storefront-outline', title: '应用库' },
    { path: '/dispimg', icon: 'mdi-image-multiple', title: '扩列图' },
    { path: '/terminal', icon: 'mdi-console', title: '终端' },
    { path: '/flash', icon: 'mdi-chip', title: '烧录' },
    { path: '/repro', icon: 'mdi-clipboard-check-outline', title: '复刻向导' },
  ]
</script>

<style>
/* 导轨很窄，高度不足时隐藏滚动条（仍可滚轮滚动） */
.app-rail .v-navigation-drawer__content {
  scrollbar-width: none;
}

.app-rail .v-navigation-drawer__content::-webkit-scrollbar {
  display: none;
}
</style>

<style scoped>
.page-container {
  max-width: 1280px;
}

.page-container--embed {
  max-width: none;
  padding: 12px !important;
}

.page-container--fullscreen {
  max-width: none;
  padding: 0 !important;
  height: 100%;
}
</style>
