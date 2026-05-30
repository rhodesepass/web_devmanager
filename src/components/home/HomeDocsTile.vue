<template>
  <div class="d-flex flex-column fill-height">
    <p class="text-body-2 text-medium-emphasis mb-4">
      硬件接线、烧录流程与常见问题，请参阅项目文档。
    </p>

    <v-btn
      color="primary"
      variant="tonal"
      prepend-icon="mdi-book-open-page-variant"
      :href="siteLinks.debugDocs"
      target="_blank"
      rel="noopener noreferrer"
      class="align-self-start"
    >
      打开调试文档
    </v-btn>

    <p class="text-body-2 text-medium-emphasis mb-4">
      项目文件资源（外壳等）
    </p>

    <v-btn
      color="primary"
      variant="tonal"
      prepend-icon="mdi-folder-outline"
      :href="siteLinks.oplst"
      target="_blank"
      rel="noopener noreferrer"
      class="align-self-start"
    >
      打开白银的文件存储
    </v-btn>

    <p class="text-body-2 text-medium-emphasis mb-4">
      电子通行证是开源社区的大家手搓的爱好者产品，不可避免地存在大量bug和不完善的地方。烦请您多一些耐心和谅解~
    </p>

    
  </div>
</template>

<script lang="ts" setup>
import { siteLinks } from '@/config/site'
</script>
