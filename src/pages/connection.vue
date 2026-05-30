<template>
  <div>
    <PageHeader
      title="设备管理"
      subtitle="连接 ePass 设备，管理文件、素材与固件"
    />

    <v-row class="home-grid" dense>
      <v-col cols="12" md="6">
        <HomeTile title="连接 ePass 设备" icon="mdi-usb" :compact="connected">
          <ConnectionPanel />
        </HomeTile>
      </v-col>

      <v-col cols="12" md="6">
        <div class="home-top-right">
          <HomeTile title="调试文档" icon="mdi-book-open-page-variant" class="home-top-right__item">
            <HomeDocsTile />
          </HomeTile>
          <HomeTile title="素材库" icon="mdi-earth" class="home-top-right__item">
            <HomeMaterialLibraryTile />
          </HomeTile>
        </div>
      </v-col>

      <v-col cols="12" md="6">
        <HomeTile title="设备操作" icon="mdi-lightning-bolt">
          <HomeQuickActionsTile />
        </HomeTile>
      </v-col>

      <v-col cols="12" md="6">
        <HomeTile title="加入社群" icon="mdi-account-group">
          <HomeCommunityTile />
        </HomeTile>
      </v-col>
    </v-row>
  </div>
</template>

<script lang="ts" setup>
import { useUsb } from '@/composables/useUsb'
import ConnectionPanel from '@/components/ConnectionPanel.vue'
import PageHeader from '@/components/PageHeader.vue'
import HomeTile from '@/components/home/HomeTile.vue'
import HomeDocsTile from '@/components/home/HomeDocsTile.vue'
import HomeMaterialLibraryTile from '@/components/home/HomeMaterialLibraryTile.vue'
import HomeQuickActionsTile from '@/components/home/HomeQuickActionsTile.vue'
import HomeCommunityTile from '@/components/home/HomeCommunityTile.vue'

const { connected } = useUsb()
</script>

<style scoped>
.home-grid {
  --v-row-gap: 16px;
}

.home-top-right {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  height: 100%;
}

.home-top-right__item {
  min-width: 0;
}

.home-top-right :deep(.home-tile) {
  min-height: 0;
  height: 100%;
}

@media (max-width: 599px) {
  .home-top-right {
    grid-template-columns: 1fr;
  }
}
</style>
