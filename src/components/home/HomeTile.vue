<template>
  <v-card
    variant="flat"
    class="home-tile h-100 d-flex flex-column"
    :class="{ 'home-tile--compact': compact }"
  >
    <v-card-title class="d-flex align-center py-4 px-5">
      <v-icon class="mr-2" :icon="icon" />
      <span class="text-subtitle-1 font-weight-medium">{{ title }}</span>
    </v-card-title>

    <v-card-text class="flex-grow-1 pt-0 px-5 pb-5">
      <slot />
    </v-card-text>
  </v-card>
</template>

<script lang="ts" setup>
defineProps<{
  title: string
  icon: string
  /** 连接后内容较矮，取消固定最小高度 */
  compact?: boolean
}>()
</script>

<style scoped>
.home-tile {
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  min-height: 280px;
}

.home-tile--compact {
  min-height: 0;
}
</style>
