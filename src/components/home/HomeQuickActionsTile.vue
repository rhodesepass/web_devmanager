<template>
  <div>
    <v-row dense>
      <v-col
        v-for="item in quickItems"
        :key="item.path"
        cols="6"
      >
        <v-card
          :to="item.path"
          variant="tonal"
          class="quick-action pa-3 text-center"
          rounded="lg"
        >
          <v-icon :icon="item.icon" size="28" class="mb-2" />
          <div class="text-body-2">{{ item.title }}</div>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script lang="ts" setup>
const quickItems = [
  { path: '/files', icon: 'mdi-folder', title: '文件' },
  { path: '/materials', icon: 'mdi-play-box-multiple', title: '素材' },
  { path: '/terminal', icon: 'mdi-console', title: '终端' },
  { path: '/flash', icon: 'mdi-chip', title: '烧录' },
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
