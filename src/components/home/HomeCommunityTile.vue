<template>
  <div class="d-flex flex-column flex-md-row align-center gap-4 fill-height">
    <div class="community-qr flex-shrink-0">
      <v-img
        :src="siteLinks.qqQrImage1"
        width="120"
        height="120"
        cover
        rounded="lg"
      />
      <div class="text-caption text-center mt-2">
        QQ 1群 {{ siteLinks.qqGroup1 }}
      </div>
    </div>

    <div class="community-qr flex-shrink-0">
      <v-img
        :src="siteLinks.qqQrImage2"
        width="120"
        height="120"
        cover
        rounded="lg"
      />
      <div class="text-caption text-center mt-2">
        QQ 2群 {{ siteLinks.qqGroup2 }}
      </div>
    </div>

    <div class="flex-grow-1">
      <p class="text-body-2 text-medium-emphasis mb-4">
        交流复刻经验、反馈问题或获取固件更新，欢迎加入社群并关注开源仓库。
      </p>

      <v-btn
        variant="tonal"
        prepend-icon="mdi-github"
        :href="siteLinks.github"
        target="_blank"
        rel="noopener noreferrer"
        class="mb-2"
        block
      >
        GitHub 组织
      </v-btn>

      <p class="text-caption text-medium-emphasis">
        灌注白银谢谢喵！
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { siteLinks } from '@/config/site'

</script>

<style scoped>
.community-qr__placeholder {
  width: 120px;
  height: 120px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.gap-4 {
  gap: 16px;
}
</style>
