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

    <v-spacer />

    
  </div>
</template>

<script lang="ts" setup>
import { siteLinks } from '@/config/site'
</script>
