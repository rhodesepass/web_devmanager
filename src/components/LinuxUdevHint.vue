<template>
  <v-alert
    type="info"
    variant="tonal"
    density="compact"
    class="linux-udev-hint mb-4"
  >
    <v-alert-title>Linux 用户须知</v-alert-title>
    <p class="text-body-2 mb-2">
      在 Linux 上使用 Chrome 访问 WebUSB 前，可能需要配置 udev 规则，否则浏览器可能无法打开 USB 设备。
    </p>
    <p class="text-caption text-medium-emphasis mb-2">
      将以下内容保存为
      <code class="linux-udev-hint__path">/etc/udev/rules.d/99-epass.rules</code>，
      然后执行
      <code class="linux-udev-hint__path">sudo udevadm control --reload-rules && sudo udevadm trigger</code>，
      并重新插拔设备。
    </p>
    <pre class="linux-udev-hint__rules">{{ linuxUdevRulesText }}</pre>
  </v-alert>
</template>

<script lang="ts" setup>
import { linuxUdevRulesText } from '@/config/linux-udev'
</script>

<style scoped>
.linux-udev-hint__path {
  font-size: 0.85em;
  word-break: break-all;
}

.linux-udev-hint__rules {
  margin: 0;
  padding: 12px;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
