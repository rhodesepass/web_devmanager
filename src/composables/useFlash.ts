import type { DfuPartitionAlt, FlashEvent, FlashMethod, FlashTarget } from '@/flash'
import type { FlashManifest, FileRole, ManifestEntry, ManifestFile } from '@/types/flashManifest'
import { computed, ref, watch } from 'vue'
import {
  DfuNotReadyError,
  runFlashDfuPartitionNew,
  runFlashDfuStage,
  runFlashFelStage,
  runFlashFelStageNew,
} from '@/flash'
import { isWebUsbSupported } from '@/utils/browser'
import {
  downloadManifestFile,
  fetchFlashManifest,
  fetchLegacyManifest,
  getTargetFile,
} from '@/utils/flashManifest'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

type Stage = 'idle' | 'fel-running' | 'awaiting-dfu' | 'dfu-running' | 'done' | 'failed'
export type FlashFileSource = 'manifest' | 'manual'

/** arkepass = 360p 原机；arkepass-p = 720p 新机 */
export type FlashSeries = 'arkepass' | 'arkepass-p'

interface SeriesConfig {
  revisions: string[]
  screens: string[]
}

const SERIES_CONFIG: Record<FlashSeries, SeriesConfig> = {
  'arkepass': { revisions: ['0.2', '0.3', '0.5', '0.6'], screens: ['boe', 'hsd', 'laowu'] },
  'arkepass-p': { revisions: ['p0.1'], screens: ['boe_035'] },
}

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

  const series = ref<FlashSeries>('arkepass')
  const selectedRev = ref('0.6')
  const selectedScreen = ref('hsd')

  const revisionItems = computed(() => SERIES_CONFIG[series.value].revisions)
  const screenItems = computed(() => SERIES_CONFIG[series.value].screens)

  const flashMethod = ref<FlashMethod>('new')
  const flashTarget = ref<FlashTarget>('nand')

  // 新方法 gadget 无 iSerial，每次重新枚举授权都会作废，
  // 所以三个分区各自要一次用户点击 + 授权，这里记推进到哪个分区了
  const NEW_DFU_PARTS: DfuPartitionAlt[] = ['uboot', 'boot', 'rootfs']
  const dfuPartIndex = ref(0)
  const nextDfuAlt = computed<DfuPartitionAlt | null>(() =>
    flashMethod.value === 'new' ? (NEW_DFU_PARTS[dfuPartIndex.value] ?? null) : null,
  )

  const fileSource = ref<FlashFileSource>('manifest')
  const flashManifest = ref<FlashManifest | null>(null)
  const manifestLoading = ref(false)
  const manifestError = ref<string | null>(null)
  const selectedVersion = ref<string | null>(null)
  const selectedMirrorIndex = ref(0)
  const downloadingFirmware = ref(false)

  const felbootFile = ref<File | null>(null)
  const ubootFile = ref<File | null>(null)
  const bootFile = ref<File | null>(null)
  const rootfsFile = ref<File | null>(null)

  const felbootBytes = ref<Uint8Array | null>(null)
  const ubootBytes = ref<Uint8Array | null>(null)
  const bootBytes = ref<Uint8Array | null>(null)
  const rootfsBytes = ref<Uint8Array | null>(null)

  const isSupported = ref(isWebUsbSupported())

  const running = computed(() => stage.value === 'fel-running' || stage.value === 'dfu-running')
  const done = computed(() => stage.value === 'done')
  const awaitingDfu = computed(() => stage.value === 'awaiting-dfu')

  const isNewMethod = computed(() => flashMethod.value === 'new')

  /** 当前方法需要的角色列表（老方法不需要 felboot） */
  const requiredRoles = computed<FileRole[]>(() =>
    isNewMethod.value
      ? ['felboot', 'uboot', 'boot', 'rootfs']
      : ['uboot', 'boot', 'rootfs'],
  )

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

  function manualFileFor (role: FileRole): File | null {
    switch (role) {
      case 'felboot': return felbootFile.value
      case 'uboot': return ubootFile.value
      case 'boot': return bootFile.value
      case 'rootfs': return rootfsFile.value
    }
  }

  function loadedBytesFor (role: FileRole): Uint8Array | null {
    switch (role) {
      case 'felboot': return felbootBytes.value
      case 'uboot': return ubootBytes.value
      case 'boot': return bootBytes.value
      case 'rootfs': return rootfsBytes.value
    }
  }

  const filesReady = computed(() => {
    if (fileSource.value === 'manual') {
      return requiredRoles.value.every(role => !!manualFileFor(role))
    }
    return !!selectedVersion.value && !!flashManifest.value
  })

  const imagesLoaded = computed(() => {
    return requiredRoles.value.every(role => !!loadedBytesFor(role))
  })

  const canStartFlash = computed(() => {
    return stage.value !== 'fel-running'
      && stage.value !== 'dfu-running'
      && stage.value !== 'awaiting-dfu'
      && filesReady.value
  })

  function clearLoadedBytes () {
    felbootBytes.value = null
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
        status.value = isNewMethod.value ? '完成，设备将自动重启进入系统' : '完成，请手动重启设备'
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
      const data = isNewMethod.value
        ? await fetchFlashManifest(selectedRev.value, selectedScreen.value)
        : await fetchLegacyManifest(selectedRev.value, selectedScreen.value)
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

  const ROLE_LABEL: Record<FileRole, string> = {
    felboot: 'FEL U-Boot',
    uboot: 'U-Boot',
    boot: 'Boot',
    rootfs: 'Rootfs',
  }

  function storeBytes (role: FileRole, bytes: Uint8Array) {
    switch (role) {
      case 'felboot': { felbootBytes.value = bytes; break }
      case 'uboot': { ubootBytes.value = bytes; break }
      case 'boot': { bootBytes.value = bytes; break }
      case 'rootfs': { rootfsBytes.value = bytes; break }
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

    const tasks: Array<{ role: FileRole, meta: ManifestFile }> = []
    for (const role of requiredRoles.value) {
      const meta = getTargetFile(entry, flashTarget.value, role)
      if (!meta) {
        reportFailure(`所选版本的 ${flashTarget.value} 目标缺少 ${ROLE_LABEL[role]} 文件信息`)
        return false
      }
      tasks.push({ role, meta })
    }

    downloadingFirmware.value = true
    error.value = null
    clearLoadedBytes()
    transferLock.begin('下载固件')

    try {
      for (const task of tasks) {
        const label = ROLE_LABEL[task.role]
        appendLog(`正在下载 ${label}: ${task.meta.name}...`, true)
        const bytes = await downloadManifestFile(
          mirror,
          entry.version,
          task.meta,
          (loaded, total) => {
            progressDone.value = loaded
            progressTotal.value = total ?? 0
            const detail = `${label}: ${task.meta.name}`
            if (total) {
              status.value = `下载 ${label} ${Math.round(loaded / total * 100)}%`
            }
            syncLockProgress(detail, loaded, total ?? 0)
          },
        )
        storeBytes(task.role, bytes)
        appendLog(`${label} 下载完成 (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MiB)`)
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
      if (imagesLoaded.value) {
        return true
      }
      return downloadManifestFirmware()
    }

    if (requiredRoles.value.some(role => !manualFileFor(role))) {
      return false
    }
    transferLock.begin('读取镜像')
    try {
      for (const role of requiredRoles.value) {
        const file = manualFileFor(role)!
        syncLockProgress(file.name)
        storeBytes(role, await readFile(file))
      }
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
    error.value = null
    logs.value = ['开始 FEL 阶段...']
    progressLabel.value = '准备'
    progressDone.value = 0
    progressTotal.value = 0
    dfuPartIndex.value = 0
    stage.value = 'fel-running'
    transferLock.begin('烧录中', 'FEL 阶段', { overlay: false })

    const felStagePromise = isNewMethod.value
      ? (() => {
          if (!felbootBytes.value) {
            reportFailure('FEL U-Boot 镜像尚未加载')
            return null
          }
          return runFlashFelStageNew(
            { rev: selectedRev.value, screen: selectedScreen.value },
            flashTarget.value,
            { felboot: felbootBytes.value },
            handleEvent,
          )
        })()
      : (() => {
          if (!ubootBytes.value) {
            reportFailure('U-Boot 镜像尚未加载')
            return null
          }
          return runFlashFelStage(
            { rev: selectedRev.value, screen: selectedScreen.value },
            { uboot: ubootBytes.value },
            handleEvent,
          )
        })()

    if (!felStagePromise) {
      return Promise.resolve()
    }

    return felStagePromise
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

  function bytesForAlt (alt: DfuPartitionAlt): Uint8Array | null {
    switch (alt) {
      case 'uboot': return ubootBytes.value
      case 'boot': return bootBytes.value
      case 'rootfs': return rootfsBytes.value
    }
  }

  /** 回到等待点击状态（授权失效/设备未就绪时不判死，让用户重点一次） */
  function backToAwaitingDfu (message: string) {
    stage.value = 'awaiting-dfu'
    appendLog(message, true)
    transferLock.setOverlay(false)
    syncLockProgress('等待 DFU 设备授权…', 0, 0)
  }

  async function runNewDfuPartition (): Promise<void> {
    const index = dfuPartIndex.value
    const alt = NEW_DFU_PARTS[index]
    const data = bytesForAlt(alt)
    if (!data) {
      reportFailure(`${alt} 镜像尚未加载`)
      return
    }

    try {
      await runFlashDfuPartitionNew(alt, data, handleEvent)
    } catch (error_: unknown) {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      if (error_ instanceof DfuNotReadyError) {
        backToAwaitingDfu(`${msg}；请等待设备就绪后再次点击烧录按钮`)
        notify('DFU 设备尚未就绪，请稍后重试', 'warning')
      } else {
        reportFailure(msg)
      }
      return
    }

    if (index + 1 < NEW_DFU_PARTS.length) {
      dfuPartIndex.value = index + 1
      backToAwaitingDfu(
        `${alt} 分区烧录完成。设备正在准备 ${NEW_DFU_PARTS[index + 1]} 分区`
        + '（期间会重新枚举、需重新授权），请稍候数秒后点击下一个烧录按钮',
      )
    } else {
      handleEvent({ type: 'done' })
    }
  }

  function continueDfuStage (): Promise<void> {
    if (stage.value !== 'awaiting-dfu') {
      return Promise.resolve()
    }
    error.value = null
    stage.value = 'dfu-running'
    syncLockProgress('DFU 阶段', 0, 0)

    if (isNewMethod.value) {
      appendLog(
        dfuPartIndex.value === 0
          ? '开始 DFU 阶段...'
          : `继续 DFU 阶段（${NEW_DFU_PARTS[dfuPartIndex.value]} 分区）...`,
        true,
      )
      return runNewDfuPartition()
    }

    appendLog('开始 DFU 阶段...', true)
    if (!bootBytes.value || !rootfsBytes.value) {
      reportFailure('boot/rootfs 镜像尚未加载')
      return Promise.resolve()
    }
    return runFlashDfuStage(
      { boot: bootBytes.value, rootfs: rootfsBytes.value },
      handleEvent,
    ).catch((error_: unknown) => {
      const msg = error_ instanceof Error ? error_.message : String(error_)
      reportFailure(msg)
    })
  }

  function resetState () {
    stage.value = 'idle'
    dfuPartIndex.value = 0
    error.value = null
    status.value = ''
    logs.value = []
    progressLabel.value = null
    progressDone.value = 0
    progressTotal.value = 0
    transferLock.end()
  }

  function setFile (role: FileRole, file: File | null) {
    clearLoadedBytes()
    switch (role) {
      case 'felboot': { felbootFile.value = file; break }
      case 'uboot': { ubootFile.value = file; break }
      case 'boot': { bootFile.value = file; break }
      case 'rootfs': { rootfsFile.value = file; break }
    }
  }

  watch(fileSource, (source) => {
    clearLoadedBytes()
    manifestError.value = null
    if (source === 'manifest') {
      felbootFile.value = null
      ubootFile.value = null
      bootFile.value = null
      rootfsFile.value = null
      loadManifest()
    } else {
      flashManifest.value = null
      selectedVersion.value = null
    }
  })

  // 切系列后把硬件版本/屏幕重置到该系列的可选项（会连带触发下面的清单重拉）
  watch(series, (value) => {
    const config = SERIES_CONFIG[value]
    if (!config.revisions.includes(selectedRev.value)) {
      selectedRev.value = config.revisions[0]
    }
    if (!config.screens.includes(selectedScreen.value)) {
      selectedScreen.value = config.screens[0]
    }
  })

  // rev/screen 不影响清单内容，仅用于服务端统计，但保持与设备选择一致
  watch([selectedRev, selectedScreen], () => {
    if (fileSource.value === 'manifest') {
      loadManifest()
    }
  })

  // 新老方法用的清单文件不同（manifest-v3.json / manifest.json），需重新拉取
  watch(flashMethod, () => {
    clearLoadedBytes()
    if (fileSource.value === 'manifest') {
      loadManifest()
    }
  })

  // 切换目标后已下载的镜像可能不再匹配，清空以便重新下载
  watch(flashTarget, () => {
    clearLoadedBytes()
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
    series,
    selectedRev,
    selectedScreen,
    revisionItems,
    screenItems,
    flashMethod,
    flashTarget,
    isNewMethod,
    nextDfuAlt,
    requiredRoles,
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
  }
}
