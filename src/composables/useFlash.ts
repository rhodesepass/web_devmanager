import type { FlashEvent } from '@/flash'
import type { FlashManifest, ManifestEntry } from '@/types/flashManifest'
import { computed, ref, watch } from 'vue'
import { runFlashDfuStage, runFlashFelStage } from '@/flash'
import { isWebUsbSupported } from '@/utils/browser'
import {
  downloadManifestFile,
  fetchFlashManifest,
  getEntryFile,
} from '@/utils/flashManifest'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

type Stage = 'idle' | 'fel-running' | 'awaiting-dfu' | 'dfu-running' | 'done' | 'failed'
export type FlashFileSource = 'manifest' | 'manual'

export function useFlash () {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()

  function syncLockProgress (
    detail?: string | null,
    done?: number,
    total?: number,
  ) {
    transferLock.update(detail, done, total)
  }

  function enableLockOverlay () {
    if (stage.value === 'fel-running' || stage.value === 'dfu-running') {
      transferLock.setOverlay(true)
    }
  }

  const stage = ref<Stage>('idle')
  const status = ref('')
  const error = ref<string | null>(null)
  const logs = ref<string[]>([])
  const progressLabel = ref<string | null>(null)
  const progressDone = ref(0)
  const progressTotal = ref(0)

  const selectedRev = ref('0.3')
  const selectedScreen = ref('hsd')

  const fileSource = ref<FlashFileSource>('manifest')
  const flashManifest = ref<FlashManifest | null>(null)
  const manifestLoading = ref(false)
  const manifestError = ref<string | null>(null)
  const selectedVersion = ref<string | null>(null)
  const selectedMirrorIndex = ref(0)
  const downloadingFirmware = ref(false)

  const ubootFile = ref<File | null>(null)
  const bootFile = ref<File | null>(null)
  const rootfsFile = ref<File | null>(null)

  const ubootBytes = ref<Uint8Array | null>(null)
  const bootBytes = ref<Uint8Array | null>(null)
  const rootfsBytes = ref<Uint8Array | null>(null)

  const isSupported = ref(isWebUsbSupported())

  const running = computed(() => stage.value === 'fel-running' || stage.value === 'dfu-running')
  const done = computed(() => stage.value === 'done')
  const awaitingDfu = computed(() => stage.value === 'awaiting-dfu')

  const selectedEntry = computed((): ManifestEntry | null => {
    if (!flashManifest.value || !selectedVersion.value) {
      return null
    }
    return flashManifest.value.manifest.find(e => e.version === selectedVersion.value) ?? null
  })

  const versionItems = computed(() => {
    return (flashManifest.value?.manifest ?? []).map(e => ({
      title: e.title,
      value: e.version,
      subtitle: e.version,
    }))
  })

  const mirrorItems = computed(() => {
    return (flashManifest.value?.availableMirror ?? []).map((m, i) => ({
      title: m.name,
      value: i,
    }))
  })

  const progress = computed(() => {
    if (progressTotal.value <= 0) {
      return null
    }
    return Math.min(1, progressDone.value / progressTotal.value)
  })

  const filesReady = computed(() => {
    if (fileSource.value === 'manual') {
      return !!ubootFile.value && !!bootFile.value && !!rootfsFile.value
    }
    return !!selectedVersion.value && !!flashManifest.value
  })

  const imagesLoaded = computed(() => {
    return !!ubootBytes.value && !!bootBytes.value && !!rootfsBytes.value
  })

  const canStartFlash = computed(() => {
    return stage.value !== 'fel-running'
      && stage.value !== 'dfu-running'
      && stage.value !== 'awaiting-dfu'
      && filesReady.value
  })

  function clearLoadedBytes () {
    ubootBytes.value = null
    bootBytes.value = null
    rootfsBytes.value = null
  }

  function appendLog (line: string, resetProgress = false) {
    logs.value = [...logs.value, line]
    status.value = line
    if (resetProgress) {
      progressLabel.value = line
      progressDone.value = 0
      progressTotal.value = 0
    }
  }

  function handleEvent (event: FlashEvent) {
    switch (event.type) {
      case 'step': {
        appendLog(event.title, true)
        syncLockProgress(event.title, 0, 0)
        enableLockOverlay()
        break
      }
      case 'log': {
        appendLog(event.message)
        break
      }
      case 'waiting': {
        const detail = `等待设备: ${event.mode}`
        appendLog(detail, true)
        syncLockProgress(detail, 0, 0)
        break
      }
      case 'progress': {
        status.value = `${progressLabel.value ?? '进度'} ${event.done}/${event.total}`
        progressDone.value = event.done
        progressTotal.value = event.total
        syncLockProgress(
          progressLabel.value ?? status.value,
          event.done,
          event.total,
        )
        enableLockOverlay()
        break
      }
      case 'done': {
        appendLog('烧录完成')
        stage.value = 'done'
        status.value = '完成，请手动重启设备'
        progressLabel.value = '完成'
        progressDone.value = 1
        progressTotal.value = 1
        transferLock.end()
        notify('烧录完成', 'success')
        break
      }
      case 'failed': {
        appendLog(`失败: ${event.reason}`)
        error.value = event.reason
        stage.value = 'failed'
        status.value = '失败'
        transferLock.end()
        notify(event.reason, 'error')
        break
      }
    }
  }

  function reportFailure (msg: string) {
    error.value = msg
    appendLog(`失败: ${msg}`)
    stage.value = 'failed'
    status.value = '失败'
    transferLock.end()
    notify(msg, 'error')
  }

  async function readFile (file: File): Promise<Uint8Array> {
    const buffer = await file.arrayBuffer()
    return new Uint8Array(buffer)
  }

  async function loadManifest () {
    if (fileSource.value !== 'manifest') {
      return
    }
    manifestLoading.value = true
    manifestError.value = null
    flashManifest.value = null
    selectedVersion.value = null
    clearLoadedBytes()

    try {
      const data = await fetchFlashManifest(selectedRev.value, selectedScreen.value)
      flashManifest.value = data
      if (data.manifest.length > 0) {
        selectedVersion.value = data.manifest[0].version
      }
      selectedMirrorIndex.value = 0
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      manifestError.value = msg
    } finally {
      manifestLoading.value = false
    }
  }

  async function downloadManifestFirmware (): Promise<boolean> {
    const entry = selectedEntry.value
    const manifest = flashManifest.value
    if (!entry || !manifest) {
      return false
    }

    const mirror = manifest.availableMirror[selectedMirrorIndex.value]
    if (!mirror) {
      reportFailure('请选择下载镜像')
      return false
    }

    const ubootMeta = getEntryFile(entry, 'uboot')
    const bootMeta = getEntryFile(entry, 'boot')
    const rootfsMeta = getEntryFile(entry, 'rootfs')
    if (!ubootMeta || !bootMeta || !rootfsMeta) {
      reportFailure('所选版本缺少 uboot / boot / rootfs 文件信息')
      return false
    }

    downloadingFirmware.value = true
    error.value = null
    clearLoadedBytes()
    transferLock.begin('下载固件')

    const tasks: Array<{ label: string, meta: typeof ubootMeta }> = [
      { label: 'U-Boot', meta: ubootMeta },
      { label: 'Boot', meta: bootMeta },
      { label: 'Rootfs', meta: rootfsMeta },
    ]

    try {
      for (const task of tasks) {
        appendLog(`正在下载 ${task.label}: ${task.meta.name}...`, true)
        const bytes = await downloadManifestFile(
          mirror,
          entry.version,
          task.meta,
          (loaded, total) => {
            progressDone.value = loaded
            progressTotal.value = total ?? 0
            const detail = `${task.label}: ${task.meta.name}`
            if (total) {
              status.value = `下载 ${task.label} ${Math.round(loaded / total * 100)}%`
            }
            syncLockProgress(detail, loaded, total ?? 0)
          },
        )
        if (task.meta.type === 'uboot') {
          ubootBytes.value = bytes
        } else if (task.meta.type === 'boot') {
          bootBytes.value = bytes
        } else {
          rootfsBytes.value = bytes
        }
        appendLog(`${task.label} 下载完成 (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB)`)
      }
      return true
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      reportFailure(`下载固件失败：${msg}`)
      return false
    } finally {
      downloadingFirmware.value = false
      if (stage.value === 'idle' || stage.value === 'failed') {
        transferLock.end()
      }
    }
  }

  async function prepareFiles (): Promise<boolean> {
    if (fileSource.value === 'manifest') {
      if (ubootBytes.value && bootBytes.value && rootfsBytes.value) {
        return true
      }
      return downloadManifestFirmware()
    }

    if (!ubootFile.value || !bootFile.value || !rootfsFile.value) {
      return false
    }
    transferLock.begin('读取镜像')
    try {
      syncLockProgress(ubootFile.value.name)
      ubootBytes.value = await readFile(ubootFile.value)
      syncLockProgress(bootFile.value.name)
      bootBytes.value = await readFile(bootFile.value)
      syncLockProgress(rootfsFile.value.name)
      rootfsBytes.value = await readFile(rootfsFile.value)
      return true
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      reportFailure(`读取镜像失败：${msg}`)
      return false
    } finally {
      if (stage.value === 'idle' || stage.value === 'failed') {
        transferLock.end()
      }
    }
  }

  function startFelStage (): Promise<void> {
    if (!canStartFlash.value) {
      return Promise.resolve()
    }
    if (!ubootBytes.value) {
      reportFailure('U-Boot 镜像尚未加载')
      return Promise.resolve()
    }
    error.value = null
    logs.value = ['开始 FEL 阶段...']
    progressLabel.value = '准备'
    progressDone.value = 0
    progressTotal.value = 0
    stage.value = 'fel-running'
    transferLock.begin('烧录中', 'FEL 阶段', { overlay: false })
    const ubootSnapshot = ubootBytes.value

    return runFlashFelStage(
      { rev: selectedRev.value, screen: selectedScreen.value },
      { uboot: ubootSnapshot },
      handleEvent,
    )
      .then(() => {
        stage.value = 'awaiting-dfu'
        appendLog('FEL 阶段完成，等待 DFU 设备授权...', true)
        transferLock.setOverlay(false)
        syncLockProgress('等待 DFU 设备授权…', 0, 0)
      })
      .catch((error_: unknown) => {
        const msg = error_ instanceof Error ? error_.message : String(error_)
        reportFailure(msg)
      })
  }

  function continueDfuStage (): Promise<void> {
    if (stage.value !== 'awaiting-dfu') {
      return Promise.resolve()
    }
    if (!bootBytes.value || !rootfsBytes.value) {
      reportFailure('boot/rootfs 镜像尚未加载')
      return Promise.resolve()
    }
    error.value = null
    appendLog('开始 DFU 阶段...', true)
    stage.value = 'dfu-running'
    syncLockProgress('DFU 阶段', 0, 0)
    const bootSnapshot = bootBytes.value
    const rootfsSnapshot = rootfsBytes.value

    return runFlashDfuStage(
      { boot: bootSnapshot, rootfs: rootfsSnapshot },
      handleEvent,
    )
      .catch((error_: unknown) => {
        const msg = error_ instanceof Error ? error_.message : String(error_)
        reportFailure(msg)
      })
  }

  function resetState () {
    stage.value = 'idle'
    error.value = null
    status.value = ''
    logs.value = []
    progressLabel.value = null
    progressDone.value = 0
    progressTotal.value = 0
    transferLock.end()
  }

  function setFile (type: 'uboot' | 'boot' | 'rootfs', file: File | null) {
    clearLoadedBytes()
    if (type === 'uboot') {
      ubootFile.value = file
    }
    if (type === 'boot') {
      bootFile.value = file
    }
    if (type === 'rootfs') {
      rootfsFile.value = file
    }
  }

  watch(fileSource, (source) => {
    clearLoadedBytes()
    manifestError.value = null
    if (source === 'manifest') {
      ubootFile.value = null
      bootFile.value = null
      rootfsFile.value = null
      loadManifest()
    } else {
      flashManifest.value = null
      selectedVersion.value = null
    }
  })

  watch([selectedRev, selectedScreen], () => {
    if (fileSource.value === 'manifest') {
      loadManifest()
    }
  })

  watch(selectedVersion, () => {
    clearLoadedBytes()
  })

  watch(selectedMirrorIndex, () => {
    clearLoadedBytes()
  })

  // 默认从 manifest 加载
  loadManifest()

  return {
    isSupported,
    stage,
    running,
    done,
    awaitingDfu,
    status,
    error,
    logs,
    progress,
    progressLabel,
    progressDone,
    progressTotal,
    selectedRev,
    selectedScreen,
    fileSource,
    flashManifest,
    manifestLoading,
    manifestError,
    selectedVersion,
    selectedMirrorIndex,
    selectedEntry,
    versionItems,
    mirrorItems,
    downloadingFirmware,
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
  }
}
