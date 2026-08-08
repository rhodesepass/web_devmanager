<template>
  <div>
    <v-row dense>
      <v-col
        v-for="item in quickItems"
        :key="item.path"
        cols="4"
      >
        <v-card
          class="quick-action pa-2 text-center"
          rounded="lg"
          :to="item.path"
          variant="tonal"
        >
          <v-icon class="mb-1" :icon="item.icon" size="22" />
          <div class="text-caption">{{ item.title }}</div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script lang="ts" setup>
  const quickItems = [
    { path: '/files', icon: 'mdi-folder', title: '文件' },
    { path: '/materials', icon: 'mdi-play-box-multiple', title: '素材' },
    { path: '/apps', icon: 'mdi-apps', title: '应用' },
    { path: '/apps/share', icon: 'mdi-storefront-outline', title: '应用库' },
    { path: '/dispimg', icon: 'mdi-image-multiple', title: '扩列图' },
    { path: '/terminal', icon: 'mdi-console', title: '终端' },
    { path: '/flash', icon: 'mdi-chip', title: '烧录' },
    { path: '/repro', icon: 'mdi-clipboard-check-outline', title: '复刻向导' },
  ]
</script>

<style scoped>
.quick-action {
  text-decoration: none;
  transition: transform 0.15s ease;
}

.quick-action:hover {
  transform: translateY(-2px);
}
</style>
