<template>
  <v-card variant="text" class="connection-card">
    <div v-if="!isSupported">
      <BrowserWarning />
    </div>

    <template v-else>
      <div v-if="!connected" class="connection-empty pa-6">
      <div class="connection-empty__icon mb-4">
        <v-icon size="64" color="primary">mdi-usb</v-icon>
      </div>
      <div class="text-h6 mb-1">连接 ePass 设备</div>
      <p class="text-body-2 text-medium-emphasis mb-6">
        请插入设备并点击下方按钮，通过 WebUSB 建立连接
      </p>
      <v-btn
        color="primary"
        size="large"
        prepend-icon="mdi-usb-port"
        :loading="connecting"
        @click="onConnect"
      >
        连接设备
      </v-btn>
    </div>

    <div v-else-if="!devInfo" class="connection-loading pa-8 text-center">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else class="connection-connected pa-4">
      <div class="connection-connected__grid">
        <div class="connection-connected__left">
          <div class="connection-status">
            <div class="connection-empty__icon connection-empty__icon--connected mb-3">
              <v-icon size="48" color="success">mdi-usb-port</v-icon>
            </div>
            <div class="text-subtitle-1 font-weight-medium mb-1">设备已连接</div>
            <p
              v-if="deviceInfo?.serialNumber"
              class="text-caption text-medium-emphasis mb-4"
            >
              {{ deviceInfo.serialNumber }}
            </p>
            <v-btn
              color="error"
              variant="outlined"
              size="large"
              prepend-icon="mdi-close"
              @click="onDisconnect"
            >
              断开连接
            </v-btn>
          </div>
        </div>

        <div class="connection-connected__right">
          <div
            v-for="field in versionFields"
            :key="field.key"
            class="connection-field"
          >
            <v-icon :icon="field.icon" size="18" class="connection-field__icon" />
            <div class="connection-field__body">
              <div class="text-caption text-medium-emphasis">{{ field.label }}</div>
              <div class="text-body-2 connection-field__value">{{ field.value }}</div>
            </div>
          </div>
        </div>
      </div>

      <div
        class="connection-storage-row"
        :class="{ 'connection-storage-row--dual': sdMounted }"
      >
        <div class="connection-storage-item">
          <div class="text-caption text-medium-emphasis mb-1">NAND</div>
          <v-progress-linear
            :model-value="nandPercent"
            color="primary"
            height="18"
            rounded
          >
            <template #default>
              <span class="text-caption">
                {{ formatBytes(nandUsed) }} / {{ formatBytes(nandTotal) }}
              </span>
            </template>
          </v-progress-linear>
        </div>

        <div v-if="sdMounted" class="connection-storage-item">
          <div class="text-caption text-medium-emphasis mb-1">SD 卡</div>
          <v-progress-linear
            :model-value="sdPercent"
            color="success"
            height="18"
            rounded
          >
            <template #default>
              <span class="text-caption">
                {{ formatBytes(sdUsed) }} / {{ formatBytes(sdTotal) }}
              </span>
            </template>
          </v-progress-linear>
        </div>
      </div>
    </div>
    </template>
  </v-card>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useUsb } from '@/composables/useUsb'
import { extractAppVersion, extractPrettyName } from '@/utils/devinfo'
import { formatBytes } from '@/utils/format'
import BrowserWarning from './BrowserWarning.vue'

const { connected, deviceInfo, devInfo, isSupported, connect, disconnect } = useUsb()
const connecting = ref(false)

const versionFields = computed(() => {
  const info = devInfo.value
  if (!info) return []
  const fields: { key: string; label: string; value: string; icon: string }[] = []
  if (info.model) {
    fields.push({ key: 'model', label: '型号', value: info.model.trim(), icon: 'mdi-chip' })
  }
  if (info.kernel) {
    fields.push({ key: 'kernel', label: '内核', value: info.kernel.trim(), icon: 'mdi-linux' })
  }
  if (info.rootfs) {
    const os = extractPrettyName(info.rootfs)
    if (os) fields.push({ key: 'os', label: '系统版本', value: os, icon: 'mdi-cellphone-cog' })
  }
  if (info.app) {
    const app = extractAppVersion(info.app)
    if (app) fields.push({ key: 'app', label: '应用版本', value: app, icon: 'mdi-application' })
  }
  return fields
})

const nandTotal = computed(() => parseInt(devInfo.value?.nand_total_bytes ?? '0', 10))
const nandFree = computed(() => parseInt(devInfo.value?.nand_free_bytes ?? '0', 10))
const nandUsed = computed(() => Math.max(0, nandTotal.value - nandFree.value))
const nandPercent = computed(() => {
  if (nandTotal.value === 0) return 0
  return Math.round((nandUsed.value / nandTotal.value) * 100)
})

const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')
const sdTotal = computed(() => parseInt(devInfo.value?.sd_total_bytes ?? '0', 10))
const sdFree = computed(() => parseInt(devInfo.value?.sd_free_bytes ?? '0', 10))
const sdUsed = computed(() => Math.max(0, sdTotal.value - sdFree.value))
const sdPercent = computed(() => {
  if (sdTotal.value === 0) return 0
  return Math.round((sdUsed.value / sdTotal.value) * 100)
})

async function onConnect () {
  connecting.value = true
  try {
    await connect()
  } finally {
    connecting.value = false
  }
}

async function onDisconnect () {
  await disconnect()
}
</script>

<style scoped>
.connection-empty {
  text-align: center;
}

.connection-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 112px;
  height: 112px;
  border-radius: 50%;
  background: rgba(var(--v-theme-primary), 0.12);
}

.connection-empty__icon--connected {
  width: 88px;
  height: 88px;
  background: rgba(var(--v-theme-success), 0.12);
}

.connection-status {
  text-align: center;
}

.connection-connected__grid {
  display: grid;
  grid-template-columns: minmax(0, 11rem) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.connection-connected__left {
  min-width: 0;
}

.connection-connected__right {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.connection-field {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.connection-field__icon {
  margin-top: 2px;
  opacity: 0.7;
}

.connection-field__body {
  min-width: 0;
  flex: 1;
}

.connection-field__value {
  word-break: break-word;
  line-height: 1.35;
}

.connection-storage-row {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.connection-storage-row--dual {
  grid-template-columns: 1fr 1fr;
}

.connection-storage-item {
  min-width: 0;
}

@media (max-width: 599px) {
  .connection-connected__grid {
    grid-template-columns: 1fr;
  }

  .connection-connected__right {
    border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    padding-top: 16px;
  }

  .connection-storage-row--dual {
    grid-template-columns: 1fr;
  }
}
</style>
