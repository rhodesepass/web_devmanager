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
              :to="item.path"
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
          <v-icon
            :color="connected ? 'success' : 'medium-emphasis'"
            :icon="connected ? 'mdi-circle' : 'mdi-circle-outline'"
            size="10"
          />
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
import { useEmbedMode } from '@/composables/useEmbedMode'
import { useNotifications } from '@/composables/useNotifications'
import { useUsb } from '@/composables/useUsb'
import logo from '@/assets/logo.svg'

const { notifications } = useNotifications()
const { connected } = useUsb()
const { isEmbed } = useEmbedMode()

const navItems = [
  { path: '/', icon: 'mdi-usb', title: '连接' },
  { path: '/files', icon: 'mdi-folder', title: '文件' },
  { path: '/materials', icon: 'mdi-play-box-multiple', title: '素材' },
  { path: '/materials/share', icon: 'mdi-earth', title: '素材库' },
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
