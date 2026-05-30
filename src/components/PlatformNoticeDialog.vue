<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card rounded="lg">
      <v-card-title class="d-flex align-start ga-3 pa-5 pb-3">
        <v-avatar :color="meta.color" size="44" variant="tonal">
          <v-icon :icon="meta.icon" size="24" />
        </v-avatar>
        <div class="pt-1">
          <div class="text-h6 font-weight-medium">{{ meta.title }}</div>
          <div class="text-body-2 text-medium-emphasis mt-1">
            {{ meta.subtitle }}
          </div>
        </div>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-5">
        <template v-if="kind === 'linux'">
          <v-alert
            class="mb-4"
            density="compact"
            type="info"
            variant="tonal"
          >
            使用 Chrome 访问 WebUSB 前，可能需要配置 udev 规则，否则浏览器无法打开 USB 设备。
          </v-alert>

          <ol class="platform-notice__steps text-body-2">
            <li class="mb-3">
              将下方规则保存为
              <code class="platform-notice__inline">/etc/udev/rules.d/99-epass.rules</code>
            </li>
            <li class="mb-3">
              在终端执行
              <button
                class="platform-notice__inline platform-notice__copyable"
                type="button"
                @click="copyText('sudo udevadm control --reload-rules && sudo udevadm trigger', '命令已复制')"
              >
                sudo udevadm control --reload-rules && sudo udevadm trigger
                <v-icon icon="mdi-content-copy" size="14" />
              </button>
            </li>
            <li>重新插拔设备后刷新页面</li>
          </ol>

          <div class="platform-notice__code mt-4">
            <div class="platform-notice__code-header">
              <span class="text-caption font-weight-medium">99-epass.rules</span>
              <v-btn
                density="compact"
                size="small"
                variant="text"
                @click="copyText(linuxUdevRulesText, '规则已复制')"
              >
                <v-icon icon="mdi-content-copy" size="16" start />
                复制
              </v-btn>
            </div>
            <pre class="platform-notice__code-body">{{ linuxUdevRulesText }}</pre>
          </div>
        </template>

        <template v-else-if="kind === 'windows'">
          <v-alert
            class="mb-4"
            density="compact"
            type="warning"
            variant="tonal"
          >
            Windows 下使用刷机功能需要手动安装 libusb 驱动，素材管理功能不受影响。
          </v-alert>

          <p class="text-body-2 text-medium-emphasis mb-4">
            若您需要刷机，建议使用桌面版刷机工具，体验更稳定。
          </p>

          <v-btn
            block
            color="primary"
            :href="siteLinks.windowsFlasherExe"
            prepend-icon="mdi-download"
            rel="noopener noreferrer"
            target="_blank"
            variant="tonal"
          >
            下载刷机程序 exe 版
          </v-btn>
        </template>

        <template v-else-if="kind === 'android'">
          <v-alert
            class="mb-4"
            density="compact"
            type="info"
            variant="tonal"
          >
            移动浏览器对 WebUSB 支持有限，建议使用 App 连接与管理设备。
          </v-alert>

          <v-btn
            block
            color="primary"
            :href="siteLinks.androidManagerApk"
            prepend-icon="mdi-download"
            rel="noopener noreferrer"
            target="_blank"
            variant="tonal"
          >
            下载 ePass 管理器 App
          </v-btn>
        </template>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-4 pt-3">
        <v-btn
          block
          color="primary"
          size="large"
          variant="flat"
          @click="onDismiss"
        >
          我知道了
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useNotifications } from '@/composables/useNotifications'
import { linuxUdevRulesText } from '@/config/linux-udev'
import { siteLinks } from '@/config/site'
import type { PlatformNoticeKind } from '@/utils/browser'

const props = defineProps<{
  modelValue: boolean
  kind: PlatformNoticeKind | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  dismiss: []
}>()

const { notify } = useNotifications()

const meta = computed(() => {
  switch (props.kind) {
    case 'linux':
      return {
        title: 'Linux 用户须知',
        subtitle: '首次使用前请配置 USB 权限',
        icon: 'mdi-linux',
        color: 'info',
      }
    case 'windows':
      return {
        title: 'Windows 用户须知',
        subtitle: '刷机功能需要额外驱动',
        icon: 'mdi-microsoft-windows',
        color: 'warning',
      }
    case 'android':
      return {
        title: 'Android 用户须知',
        subtitle: '推荐使用官方 App',
        icon: 'mdi-android',
        color: 'info',
      }
    default:
      return {
        title: '用户须知',
        subtitle: '',
        icon: 'mdi-information',
        color: 'info',
      }
  }
})

async function copyText (text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    notify(successMessage, 'success', 2000)
  } catch {
    notify('复制失败，请手动选择文本', 'warning')
  }
}

function onDismiss () {
  emit('dismiss')
  emit('update:modelValue', false)
}
</script>

<style scoped>
.platform-notice__steps {
  margin: 0;
  padding-left: 1.25rem;
}

.platform-notice__steps li {
  padding-left: 0.25rem;
}

.platform-notice__steps li::marker {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}

.platform-notice__inline {
  display: inline;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8125rem;
  word-break: break-all;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.platform-notice__copyable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  border: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
  transition: background 0.15s ease;
}

.platform-notice__copyable:hover {
  background: rgba(var(--v-theme-primary), 0.12);
}

.platform-notice__code {
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.platform-notice__code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 6px 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.platform-notice__code-body {
  margin: 0;
  padding: 12px;
  max-height: 160px;
  overflow: auto;
  font-size: 0.72rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
