<template>
  <div>
    <PageHeader
      subtitle="通过 WebUSB 在浏览器中烧录设备固件（实验性功能）"
      title="固件烧录"
    />

    <BrowserWarning v-if="!isSupported" class="mb-4" />

    <v-row>
      <v-col cols="12" lg="7">
        <v-card>
          <v-stepper
            v-model="step"
            class="elevation-0"
            flat
            hide-actions
          >
            <v-stepper-header>
              <v-stepper-item
                :complete="step > 1"
                subtitle="设备参数与镜像文件"
                title="选择版本"
                :value="1"
              />

              <v-divider />

              <v-stepper-item
                :complete="step > 2"
                subtitle="开始烧录前检查"
                title="复核并授权 FEL"
                :value="2"
              />

              <v-divider />

              <v-stepper-item
                :complete="step > 3"
                subtitle="重新授权进入 DFU 阶段"
                title="授权 DFU"
                :value="3"
              />

              <v-divider />

              <v-stepper-item
                :complete="done"
                title="完成"
                :value="4"
              />
            </v-stepper-header>

            <v-stepper-window>
              <v-stepper-window-item :value="1">
                <v-card-text>
                  <p class="text-body-2 text-medium-emphasis mb-4">
                    选择硬件版本与屏幕类型，从在线清单下载固件，或手动指定本地镜像文件。
                  </p>

                  <v-row dense>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="selectedRev"
                        density="compact"
                        :items="revisions"
                        label="硬件版本"
                        variant="outlined"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="selectedScreen"
                        density="compact"
                        :items="screens"
                        label="屏幕类型"
                        variant="outlined"
                      />
                    </v-col>
                  </v-row>

                  <v-btn-toggle
                    v-model="fileSource"
                    class="mt-3 mb-3"
                    color="primary"
                    density="compact"
                    mandatory
                    variant="outlined"
                  >
                    <v-btn value="manifest">
                      在线清单
                    </v-btn>
                    <v-btn value="manual">
                      本地文件
                    </v-btn>
                  </v-btn-toggle>

                  <template v-if="fileSource === 'manifest'">
                    <div class="d-flex align-center ga-2 mb-3">
                      <v-btn
                        :loading="manifestLoading"
                        prepend-icon="mdi-refresh"
                        size="small"
                        variant="tonal"
                        @click="loadManifest"
                      >
                        刷新清单
                      </v-btn>
                      <span class="text-caption text-medium-emphasis">
                        {{ flashBaseHost }}
                      </span>
                    </div>

                    <v-alert
                      v-if="manifestError"
                      class="mb-3"
                      density="compact"
                      type="error"
                      variant="tonal"
                    >
                      {{ manifestError }}
                    </v-alert>

                    <v-select
                      v-model="selectedVersion"
                      class="mb-2"
                      density="compact"
                      :disabled="manifestLoading || !versionItems.length"
                      item-title="title"
                      item-value="value"
                      :items="versionItems"
                      label="固件版本"
                      variant="outlined"
                    />

                    <v-select
                      v-model="selectedMirrorIndex"
                      class="mb-3"
                      density="compact"
                      :disabled="manifestLoading || !mirrorItems.length"
                      item-title="title"
                      item-value="value"
                      :items="mirrorItems"
                      label="下载镜像"
                      variant="outlined"
                    />

                    <v-alert
                      v-if="selectedEntry"
                      density="compact"
                      type="info"
                      variant="tonal"
                    >
                      <p class="text-body-2 font-weight-medium mb-1">
                        {{ selectedEntry.title }}
                      </p>
                      <p class="text-caption mb-0" style="white-space: pre-wrap">
                        {{ selectedEntry.description }}
                      </p>
                    </v-alert>
                  </template>

                  <template v-else>
                    <p class="text-caption text-medium-emphasis mb-2">
                      手动选择 U-Boot、boot、rootfs 三个镜像文件
                    </p>

                    <v-file-input
                      accept="*"
                      class="mb-2"
                      density="compact"
                      label="U-Boot (uboot)"
                      :model-value="ubootFile ? [ubootFile] : []"
                      prepend-icon="mdi-memory"
                      variant="outlined"
                      @update:model-value="onFile('uboot', $event)"
                    />

                    <v-file-input
                      accept="*"
                      class="mb-2"
                      density="compact"
                      label="Boot 分区 (boot)"
                      :model-value="bootFile ? [bootFile] : []"
                      prepend-icon="mdi-package-variant"
                      variant="outlined"
                      @update:model-value="onFile('boot', $event)"
                    />

                    <v-file-input
                      accept="*"
                      density="compact"
                      label="Rootfs 分区 (rootfs)"
                      :model-value="rootfsFile ? [rootfsFile] : []"
                      prepend-icon="mdi-harddisk"
                      variant="outlined"
                      @update:model-value="onFile('rootfs', $event)"
                    />
                  </template>
                </v-card-text>

                <v-card-actions>
                  <v-btn
                    :disabled="!isSupported"
                    size="small"
                    variant="text"
                    @click="probeFelDevice"
                  >
                    探测 FEL
                  </v-btn>

                  <v-btn
                    :disabled="!isSupported"
                    size="small"
                    variant="text"
                    @click="probeDfuDevice"
                  >
                    探测 DFU
                  </v-btn>

                  <v-spacer />

                  <v-btn
                    color="primary"
                    :disabled="!filesReady || preparing"
                    :loading="preparing"
                    @click="onGoToReview"
                  >
                    下一步
                  </v-btn>
                </v-card-actions>
              </v-stepper-window-item>

              <v-stepper-window-item :value="2">
                <v-card-text>
                  <p class="text-body-1 mb-3">
                    请确认以下信息无误，然后点击「授权 FEL 并开始烧录」。
                  </p>

                  <v-list class="mb-3 bg-transparent" density="compact">
                    <v-list-item
                      prepend-icon="mdi-chip"
                      :subtitle="selectedRev"
                      title="硬件版本"
                    />

                    <v-list-item
                      prepend-icon="mdi-monitor"
                      :subtitle="selectedScreen"
                      title="屏幕类型"
                    />

                    <v-list-item
                      prepend-icon="mdi-source-branch"
                      :subtitle="fileSource === 'manifest' ? '在线清单' : '本地文件'"
                      title="固件来源"
                    />

                    <v-list-item
                      v-if="fileSource === 'manifest' && selectedEntry"
                      prepend-icon="mdi-tag"
                      :subtitle="selectedEntry.version"
                      :title="selectedEntry.title"
                    />

                    <v-list-item
                      prepend-icon="mdi-memory"
                      :subtitle="describeImage('uboot')"
                      title="U-Boot"
                    />

                    <v-list-item
                      prepend-icon="mdi-package-variant"
                      :subtitle="describeImage('boot')"
                      title="Boot 分区"
                    />

                    <v-list-item
                      prepend-icon="mdi-harddisk"
                      :subtitle="describeImage('rootfs')"
                      title="Rootfs 分区"
                    />
                  </v-list>

                  <v-alert
                    v-if="fileSource === 'manifest' && !imagesLoaded"
                    class="mb-3"
                    density="compact"
                    type="warning"
                    variant="tonal"
                  >
                    固件尚未下载完成，请点击下方按钮时将自动下载。
                  </v-alert>

                  <v-alert
                    density="compact"
                    type="info"
                    variant="tonal"
                  >
                    点击下方按钮后，浏览器会弹出 WebUSB 授权窗口。请在弹窗中选择
                    <strong>1f3a:efe8</strong>（FEL 模式）的设备。
                  </v-alert>
                </v-card-text>

                <v-card-actions>
                  <v-btn
                    :disabled="running"
                    variant="text"
                    @click="step = 1"
                  >
                    上一步
                  </v-btn>

                  <v-spacer />

                  <v-btn
                    color="error"
                    :disabled="!isSupported || !canStartFlash || preparing"
                    :loading="preparing || stage === 'fel-running'"
                    @click="onStartFlash"
                  >
                    授权 FEL 并开始烧录
                  </v-btn>
                </v-card-actions>
              </v-stepper-window-item>

              <v-stepper-window-item :value="3">
                <v-card-text>
                  <v-alert
                    class="mb-4"
                    density="compact"
                    type="warning"
                    variant="tonal"
                  >
                    FEL 阶段已完成，设备应已自动重启进入 DFU 模式。
                    <br>
                    <strong>由于 WebUSB 权限限制，需要再次授权 DFU 设备。</strong>
                  </v-alert>

                  <p class="text-body-2 mb-2">
                    点击下方按钮后，浏览器会弹出 WebUSB 授权窗口。请在弹窗中选择
                    <strong>1f3a:1010</strong>（DFU 模式）的设备。
                  </p>

                  <p class="text-caption text-medium-emphasis">
                    授权完成后，将依次写入 boot 与 rootfs 分区。两个分区共享同一次授权，无需再次确认。
                  </p>
                </v-card-text>

                <v-card-actions>
                  <v-spacer />

                  <v-btn
                    color="error"
                    :loading="stage === 'dfu-running'"
                    @click="continueDfuStage"
                  >
                    授权 DFU 并继续
                  </v-btn>
                </v-card-actions>
              </v-stepper-window-item>

              <v-stepper-window-item :value="4">
                <v-card-text>
                  <v-alert
                    v-if="done"
                    density="compact"
                    type="success"
                    variant="tonal"
                  >
                    DFU 写入已完成。请手动断电后重新上电启动设备。
                  </v-alert>

                  <v-alert
                    v-else-if="stage === 'failed'"
                    density="compact"
                    type="error"
                    variant="tonal"
                  >
                    {{ error || '烧录失败' }}
                  </v-alert>
                </v-card-text>

                <v-card-actions>
                  <v-spacer />

                  <v-btn
                    color="primary"
                    variant="text"
                    @click="onReset"
                  >
                    重新开始
                  </v-btn>
                </v-card-actions>
              </v-stepper-window-item>
            </v-stepper-window>
          </v-stepper>
        </v-card>
      </v-col>

      <v-col cols="12" lg="5">
        <v-card>
          <v-card-title>状态</v-card-title>

          <v-card-text>
            <p class="text-body-2 mb-2">
              {{ status || '等待操作' }}
            </p>

            <v-alert
              v-if="error"
              class="mb-3"
              density="compact"
              type="error"
              variant="tonal"
            >
              {{ error }}
            </v-alert>

            <v-progress-linear
              v-if="progress != null"
              class="mb-4"
              color="primary"
              height="8"
              :model-value="progress * 100"
              rounded
            />

            <div class="flash-log pa-3 rounded bg-surface-variant">
              <div
                v-for="(line, index) in logs"
                :key="index"
                class="text-caption font-mono"
              >
                {{ line }}
              </div>

              <p
                v-if="logs.length === 0"
                class="text-caption text-medium-emphasis mb-0"
              >
                暂无日志
              </p>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </div>
</template>

<script lang="ts" setup>
  import { ref, watch } from 'vue'
  import BrowserWarning from '@/components/BrowserWarning.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useFlash } from '@/composables/useFlash'
  import { siteLinks } from '@/config/site'

  const flashBaseHost = new URL(siteLinks.flashBase).host

  const revisions = ['0.2', '0.3', '0.5', '0.6']
  const screens = ['boe', 'hsd', 'laowu']

  const {
    isSupported,
    stage,
    running,
    done,
    status,
    error,
    logs,
    progress,
    selectedRev,
    selectedScreen,
    fileSource,
    manifestLoading,
    manifestError,
    selectedVersion,
    selectedMirrorIndex,
    selectedEntry,
    versionItems,
    mirrorItems,
    ubootFile,
    bootFile,
    rootfsFile,
    filesReady,
    imagesLoaded,
    canStartFlash,
    probeFelDevice,
    probeDfuDevice,
    prepareFiles,
    startFelStage,
    continueDfuStage,
    resetState,
    setFile,
    loadManifest,
  } = useFlash()

  const step = ref(1)
  const preparing = ref(false)

  watch(stage, value => {
    switch (value) {
      case 'awaiting-dfu': {
        step.value = 3

        break
      }
      case 'done':
      case 'failed': {
        step.value = 4

        break
      }
      case 'fel-running': {
        step.value = 2

        break
      }
      case 'dfu-running': {
        step.value = 3

        break
      }
    // No default
    }
  })

  function formatBytes (bytes: number): string {
    const sizeKb = bytes / 1024
    return sizeKb >= 1024
      ? `${(sizeKb / 1024).toFixed(2)} MiB`
      : `${sizeKb.toFixed(0)} KiB`
  }

  function describeFile (file: File | null): string {
    if (!file) return '未选择'
    return `${file.name} (${formatBytes(file.size)})`
  }

  function describeImage (type: 'uboot' | 'boot' | 'rootfs'): string {
    if (fileSource.value === 'manual') {
      const file = type === 'uboot'
        ? ubootFile.value
        : type === 'boot'
          ? bootFile.value
          : rootfsFile.value
      return describeFile(file)
    }
    const meta = selectedEntry.value?.files.find(f => f.type === type)
    if (!meta) return '未选择'
    return meta.name
  }

  async function onGoToReview () {
    if (preparing.value || !filesReady.value) return
    if (fileSource.value === 'manifest' && !imagesLoaded.value) {
      preparing.value = true
      try {
        const ok = await prepareFiles()
        if (!ok) return
      } finally {
        preparing.value = false
      }
    }
    step.value = 2
  }

  function onFile (type: 'uboot' | 'boot' | 'rootfs', value: File | File[] | null) {
    const file = Array.isArray(value) ? (value[0] ?? null) : value
    setFile(type, file)
  }

  async function onStartFlash () {
    if (preparing.value) return
    preparing.value = true
    try {
      const ok = await prepareFiles()
      if (!ok) return
      // After the file reads, the original click activation is likely expired,
      // so requestDevice may fail. We still attempt; if it fails users will
      // simply click again.
      await startFelStage()
    } finally {
      preparing.value = false
    }
  }

  function onReset () {
    resetState()
    step.value = 1
  }
</script>

<style scoped>
.flash-log {
  max-height: 420px;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.font-mono {
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
