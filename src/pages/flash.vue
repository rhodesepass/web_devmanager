<template>
  <div>
    <PageHeader
      subtitle="通过 WebUSB 在浏览器中烧录设备固件（实验性功能）"
      title="固件烧录"
    />

    <BrowserWarning v-if="!isSupported" class="mb-4" />

    <v-alert
      class="mb-4"
      density="comfortable"
      icon="mdi-power"
      type="info"
      variant="tonal"
    >
      <div class="text-body-2">
        <strong>进入 FEL 模式：</strong>拔出 SD 卡，关闭板子电源，按住 FEL 按钮（从上往下第五个按钮），再按住电源键（最下面的按钮）上电。
      </div>
      <div class="text-body-2 mt-1">
        如果点击授权后没有反应，请先
        <a class="text-decoration-underline" href="#" @click.prevent="openPlatformNotice()">重新安装驱动</a>，
        仍然不行则检查 USB 链路是否虚焊，可用
        <a :href="siteLinks.usbTreeView" rel="noopener noreferrer" target="_blank">UsbTreeView</a>
        观察设备是否被系统枚举。
      </div>
      <div class="text-body-2 mt-1">
        如果刷机仍有问题，可再尝试用
        <a :href="siteLinks.offlineFlashTool" rel="noopener noreferrer" target="_blank">通用刷机程序</a>
        （Windows 用包内 exe，其他平台可用 <code>uv run main.py</code>）。
      </div>
    </v-alert>

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

                  <v-select
                    v-model="series"
                    class="mb-1"
                    density="compact"
                    item-title="title"
                    item-value="value"
                    :items="seriesItems"
                    label="系列"
                    variant="outlined"
                  />

                  <v-row dense>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="selectedRev"
                        density="compact"
                        :disabled="revisionItems.length <= 1"
                        :items="revisionItems"
                        label="硬件版本"
                        variant="outlined"
                      />
                    </v-col>

                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="selectedScreen"
                        density="compact"
                        :disabled="screenItems.length <= 1"
                        :items="screenItems"
                        label="屏幕类型"
                        variant="outlined"
                      />
                    </v-col>
                  </v-row>

                  <v-row v-if="isNewMethod" dense>
                    <v-col cols="12" sm="6">
                      <v-select
                        v-model="flashTarget"
                        density="compact"
                        item-title="title"
                        item-value="value"
                        :items="targetItems"
                        label="启动/存储目标"
                        variant="outlined"
                      />
                    </v-col>
                  </v-row>

                  <template v-if="isNewMethod">
                    <v-checkbox
                      v-model="wipeUserData"
                      color="warning"
                      density="compact"
                      hide-details
                      :label="flashTarget === 'nand'
                        ? '不保留系统盘数据（数据盘数据不受影响）'
                        : '清除 SD 数据分区（不影响共享分区）'"
                    />

                    <v-checkbox
                      v-if="flashTarget === 'nand'"
                      v-model="nandScrub"
                      color="error"
                      density="compact"
                      hide-details
                      label="全片强制擦除并重扫坏块（含 u-boot / bootenv）"
                    />

                    <v-alert
                      v-if="nandScrub && flashTarget === 'nand'"
                      class="mt-2 mb-1"
                      density="compact"
                      type="error"
                      variant="tonal"
                    >
                      <div class="text-body-2">
                        全片擦除会抹掉出厂坏块标记，之后按实际擦除结果重建坏块表，同时<strong>包含清除用户数据</strong>，耗时明显更长。
                      </div>
                      <div class="text-body-2 mt-1">
                        这一步连 u-boot 和 bootenv 一起擦掉——随后的 DFU 会重写它们，但<strong>中途断电只能靠 FEL 救回</strong>。
                        只在<strong>怀疑坏块表有误，而且愿意无视坏块、承担系统不稳定风险</strong>的情况下使用。
                      </div>
                    </v-alert>

                    <v-alert
                      v-else-if="wipeUserData"
                      class="mt-2 mb-1"
                      density="compact"
                      type="warning"
                      variant="tonal"
                    >
                      <div class="text-body-2">
                        {{ flashTarget === 'nand'
                          ? '不保留系统盘数据：系统盘上的素材、App、扩列图等会被清空且无法恢复；数据盘（SD 卡）数据不受影响。'
                          : 'SD 上的数据分区会被清空（下次启动自动重建文件系统），共享分区不受影响。' }}
                      </div>
                    </v-alert>
                  </template>

                  <div v-if="isNewMethod" class="mb-2">
                    <v-btn
                      class="text-none px-1"
                      color="medium-emphasis"
                      prepend-icon="mdi-backup-restore"
                      size="small"
                      variant="text"
                      @click="flashMethod = 'legacy'"
                    >
                      切换到旧版兼容模式
                    </v-btn>
                  </div>

                  <v-alert
                    v-else
                    class="mb-2"
                    density="compact"
                    type="warning"
                    variant="tonal"
                  >
                    <div class="text-body-2">
                      已启用<strong>旧版兼容模式</strong>：用 FEL 直接擦写 SPI NAND，仅支持 NAND(系统盘)启动，不写 felboot。
                    </div>
                    <v-btn
                      class="text-none px-1 mt-1"
                      color="primary"
                      prepend-icon="mdi-arrow-up-bold"
                      size="small"
                      variant="text"
                      @click="flashMethod = 'new'"
                    >
                      切换回新版方法
                    </v-btn>
                  </v-alert>

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
                      {{ isNewMethod
                        ? '手动选择 felboot、uboot、boot、rootfs 四个镜像文件'
                        : '手动选择 U-Boot、boot、rootfs 三个镜像文件' }}
                    </p>

                    <v-file-input
                      v-if="isNewMethod"
                      accept="*"
                      class="mb-2"
                      density="compact"
                      label="FEL U-Boot (felboot / u-boot.bin)"
                      :model-value="felbootFile ? [felbootFile] : []"
                      prepend-icon="mdi-chip"
                      variant="outlined"
                      @update:model-value="onFile('felboot', $event)"
                    />

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
                      prepend-icon="mdi-cog-transfer"
                      :subtitle="isNewMethod ? '新方法（FEL 引导 U-Boot + DFU）' : '老方法（FEL 直写 SPI NAND）'"
                      title="烧录方式"
                    />

                    <v-list-item
                      v-if="isNewMethod"
                      prepend-icon="mdi-harddisk-plus"
                      :subtitle="flashTarget === 'nand' ? 'NAND 启动（系统盘）' : 'SD 卡启动（数据盘）'"
                      title="启动/存储目标"
                    />

                    <v-list-item
                      v-if="isNewMethod"
                      prepend-icon="mdi-database-alert"
                      :subtitle="flashFlags === 0
                        ? '保留用户数据（仅重写系统）'
                        : (nandScrub && flashTarget === 'nand'
                          ? '全片强制擦除 + 重扫坏块（不保留系统盘数据）'
                          : (flashTarget === 'nand'
                            ? '不保留系统盘数据，数据盘数据不受影响'
                            : '清除 SD 数据分区'))"
                      title="数据处理"
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
                      v-if="isNewMethod"
                      prepend-icon="mdi-chip"
                      :subtitle="describeImage('felboot')"
                      title="FEL U-Boot"
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
                    v-if="isNewMethod && flashFlags !== 0"
                    class="mb-3"
                    density="compact"
                    :type="nandScrub && flashTarget === 'nand' ? 'error' : 'warning'"
                    variant="tonal"
                  >
                    <div class="text-body-2">
                      <strong>本次会清除数据：</strong>已勾选
                      {{ nandScrub && flashTarget === 'nand'
                        ? '全片强制擦除并重扫坏块（不保留系统盘数据）'
                        : (flashTarget === 'nand'
                          ? '不保留系统盘数据（数据盘数据不受影响）'
                          : '清除 SD 数据分区') }}，
                      flags=0x{{ flashFlags.toString(16).padStart(2, '0') }}。
                    </div>
                    <div class="text-body-2 mt-1">
                      清掉的数据<strong>无法恢复</strong>，请确认已经备份。
                    </div>
                  </v-alert>

                  <v-alert
                    v-else-if="isNewMethod"
                    class="mb-3"
                    density="compact"
                    type="warning"
                    variant="tonal"
                  >
                    <template v-if="flashTarget === 'nand'">
                      <div class="text-body-2">
                        <strong>关于用户数据：</strong>新版固件把系统与数据分开存放，烧录只重写系统部分（uboot / boot / rootfs），
                        素材、App、扩列图等数据理论上不受影响。
                      </div>
                      <div class="text-body-2 mt-1">
                        但仍<strong>强烈建议先备份</strong>：数据分区若因掉电、坏块等原因无法挂载，设备会在启动时自动重建它（等同清空）。
                      </div>
                    </template>
                    <template v-else>
                      <div class="text-body-2">
                        <strong>关于用户数据：</strong>烧录到 SD 卡会重写 SD 的分区表。若卡上是旧版布局，数据分区与共享分区的位置会发生变化，
                        原有内容将无法读回。
                      </div>
                      <div class="text-body-2 mt-1">
                        请<strong>务必先备份 SD 卡内的数据</strong>再继续。
                      </div>
                    </template>
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
                    <template v-if="isNewMethod">
                      授权完成后，将依次写入 uboot、boot、rootfs 分区。三个分区共享同一次授权，
                      写完后会自动通知设备退出 DFU，无需再次确认。
                    </template>
                    <template v-else>
                      授权完成后，将依次写入 boot 与 rootfs 分区。各分区共享同一次授权，无需再次确认。
                    </template>
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
                    {{ isNewMethod
                      ? 'DFU 写入已完成，设备会自动启动新系统，无需手动断电。若首次启动较慢属正常（数据分区可能正在初始化）。'
                      : 'DFU 写入已完成。请手动断电后重新上电启动设备。' }}
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
  import type { FileRole } from '@/types/flashManifest'
  import { ref, watch } from 'vue'
  import BrowserWarning from '@/components/BrowserWarning.vue'
  import PageHeader from '@/components/PageHeader.vue'
  import { useFlash } from '@/composables/useFlash'
  import { usePlatformNotice } from '@/composables/usePlatformNotice'
  import { siteLinks } from '@/config/site'
  import { getTargetFile } from '@/utils/flashManifest'

  const flashBaseHost = new URL(siteLinks.flashBase).host

  const { open: openPlatformNotice } = usePlatformNotice(true)

  const seriesItems = [
    { title: 'ArkEPass（360p 机种）', value: 'arkepass' },
    { title: 'ArkEPass-P（720p 机种）', value: 'arkepass-p' },
  ]
  const targetItems = [
    { title: '内置 NAND 启动', value: 'nand' },
    { title: '外置 SD 卡启动', value: 'sd' },
  ]

  const {
    isSupported,
    stage,
    running,
    done,
    status,
    error,
    logs,
    progress,
    series,
    selectedRev,
    selectedScreen,
    revisionItems,
    screenItems,
    flashMethod,
    flashTarget,
    wipeUserData,
    nandScrub,
    flashFlags,
    isNewMethod,
    fileSource,
    manifestLoading,
    manifestError,
    selectedVersion,
    selectedMirrorIndex,
    selectedEntry,
    versionItems,
    mirrorItems,
    felbootFile,
    ubootFile,
    bootFile,
    rootfsFile,
    filesReady,
    imagesLoaded,
    canStartFlash,
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

  function manualFile (role: FileRole): File | null {
    switch (role) {
      case 'felboot': return felbootFile.value
      case 'uboot': return ubootFile.value
      case 'boot': return bootFile.value
      case 'rootfs': return rootfsFile.value
    }
  }

  function describeImage (role: FileRole): string {
    if (fileSource.value === 'manual') {
      return describeFile(manualFile(role))
    }
    if (!selectedEntry.value) return '未选择'
    const meta = getTargetFile(selectedEntry.value, flashTarget.value, role)
    return meta ? meta.name : '未选择'
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

  function onFile (role: FileRole, value: File | File[] | null) {
    const file = Array.isArray(value) ? (value[0] ?? null) : value
    setFile(role, file)
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
