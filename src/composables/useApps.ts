import type { UsbResponderClient } from '@/usb'
import { computed, effectScope, ref, watch } from 'vue'
import {
  APP_STORAGES,
  type AppStorage,
  type RemoteApp,
  type TransferProgress,
} from '@/types/app'
import { parseAppConfig, toAppInfo } from '@/utils/appconfig'
import {
  getCachedAppIcon,
  removeCachedAppIcon,
  setCachedAppIcon,
} from '@/utils/appIconCache'
import { assertStorageCapacity } from '@/utils/deviceStorage'
import {
  buildMaterialZip,
  sanitizeZipFilename,
  triggerBlobDownload,
} from '@/utils/zipMaterial'
import { extractAppFromZip } from '@/utils/zipApp'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'
import { useUsb } from './useUsb'

function appDirPath (storage: AppStorage, dirName: string): string {
  return `${APP_STORAGES[storage].appsBasePath}/${dirName}`
}

function bytesToFile (data: Uint8Array, name: string): File {
  const copy = new Uint8Array(data)
  return new File([copy], name, { type: 'application/octet-stream' })
}

function revokeIconUrls (apps: RemoteApp[]) {
  for (const a of apps) {
    if (a.info.iconUrl) {
      URL.revokeObjectURL(a.info.iconUrl)
    }
  }
}

// 设备 App 列表挂在模块上而非组件闭包里：缓存边界是"一次 USB 连接"，
// 同一次连接内来回切页面直接复用，不再重扫。
const { client, devInfo } = useUsb()
const { notify } = useNotifications()
const transferLock = useTransferLock()

const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')
const apps = ref<RemoteApp[]>([])
const loading = ref(false)
const transferring = ref(false)
const transferProgress = ref<TransferProgress | null>(null)
let iconLoadGeneration = 0

/** 当前缓存对应哪个 client 实例；与 client.value 不一致即视为缓存失效 */
let cachedClient: UsbResponderClient | null = null

const storageOptions = computed(() => {
  const opts = [APP_STORAGES.nand]
  if (sdMounted.value) {
    opts.push(APP_STORAGES.sd)
  }
  return opts
})

function invalidate () {
  cachedClient = null
}

export function useApps () {
  async function reloadAppsOnDevice () {
    if (!client.value) {
      return
    }
    try {
      const result = await client.value.commandExec('epassctl app reload_list')
      if (result.exitCode !== 0) {
        const err = new TextDecoder().decode(result.stderr).trim()
        notify(
          `App 已写入，但 reload_list 失败${err ? `: ${err}` : ''}`,
          'warning',
        )
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`App 已写入，但 reload_list 失败: ${msg}`, 'warning')
    }
  }

  async function listStorage (
    storage: AppStorage,
    skipped: string[],
  ): Promise<RemoteApp[]> {
    if (!client.value) {
      return []
    }
    const cfg = APP_STORAGES[storage]
    let dirs: string[]
    try {
      const listing = await client.value.fileList(cfg.appsBasePath)
      dirs = listing.dirs
    } catch {
      return []
    }

    const result: RemoteApp[] = []
    for (const raw of dirs) {
      const dirName = raw.trim().replace(/\/$/, '')
      if (!dirName || dirName.includes('/')) {
        continue
      }

      const basePath = appDirPath(storage, dirName)

      let configText: string
      try {
        const configBytes = await client.value.fileGet(`${basePath}/appconfig.json`)
        configText = new TextDecoder().decode(configBytes)
      } catch {
        // 没有 appconfig.json，视为非 App 目录，静默跳过
        continue
      }

      try {
        const parsed = parseAppConfig(configText, dirName)

        const { files } = await client.value.fileList(basePath)
        let totalBytes = 0
        for (const fileName of files) {
          try {
            const stat = await client.value.fileStat(`${basePath}/${fileName}`)
            totalBytes += Number.parseInt(stat.size ?? '0', 10)
          } catch {
            // stat failure is non-fatal
          }
        }

        let iconBytes: number | null = null
        if (parsed.iconRelativePath) {
          try {
            const stat = await client.value.fileStat(`${basePath}/${parsed.iconRelativePath}`)
            const size = Number.parseInt(stat.size ?? '0', 10)
            if (size > 0) {
              iconBytes = size
            }
          } catch {
            // icon stat failure is non-fatal
          }
        }

        const info = toAppInfo(parsed, files.length, totalBytes, null, iconBytes)
        result.push({
          info,
          storage,
          dirName,
          listKey: `${storage}:${dirName}`,
        })
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        skipped.push(`${dirName}: ${msg}`)
      }
    }
    return result
  }

  function applyAppIcon (
    listKey: string,
    iconUrl: string,
    generation: number,
  ): boolean {
    const idx = apps.value.findIndex(a => a.listKey === listKey)
    if (idx < 0 || generation !== iconLoadGeneration) {
      URL.revokeObjectURL(iconUrl)
      return false
    }

    const current = apps.value[idx]
    if (current.info.iconUrl) {
      URL.revokeObjectURL(current.info.iconUrl)
    }
    apps.value[idx] = {
      ...current,
      info: { ...current.info, iconUrl },
    }
    return true
  }

  async function loadIconsInBackground (generation: number) {
    const c = client.value
    if (!c) {
      return
    }

    for (const item of apps.value) {
      if (generation !== iconLoadGeneration || !client.value) {
        return
      }
      const iconPath = item.info.iconRelativePath
      if (!iconPath || item.info.iconUrl) {
        continue
      }

      const iconBytes = item.info.iconBytes
      if (iconBytes != null && iconBytes > 0) {
        const cached = getCachedAppIcon(item.info.uuid, iconBytes)
        if (cached) {
          const iconCopy = new Uint8Array(cached.bytes)
          const iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: cached.mime }))
          if (applyAppIcon(item.listKey, iconUrl, generation)) {
            continue
          }
          return
        }
      }

      const basePath = appDirPath(item.storage, item.dirName)
      try {
        const fetchedBytes = await c.fileGet(`${basePath}/${iconPath}`)
        if (generation !== iconLoadGeneration) {
          return
        }

        const mime = guessImageMime(iconPath)
        const iconCopy = new Uint8Array(fetchedBytes)
        const iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: mime }))

        if (!applyAppIcon(item.listKey, iconUrl, generation)) {
          return
        }

        if (iconBytes != null && iconBytes > 0) {
          setCachedAppIcon(item.info.uuid, iconBytes, mime, iconCopy)
        }
      } catch {
        // icon download failure is non-fatal
      }
    }
  }

  /** 缓存命中就什么都不做；只有首次进入或换了设备才真的去扫 */
  function ensureLoaded () {
    if (client.value && cachedClient !== client.value) {
      void refresh()
    }
  }

  async function refresh () {
    if (!client.value) {
      invalidate()
      revokeIconUrls(apps.value)
      apps.value = []
      return
    }
    loading.value = true
    iconLoadGeneration += 1
    const generation = iconLoadGeneration
    try {
      revokeIconUrls(apps.value)
      const skipped: string[] = []
      const nand = await listStorage('nand', skipped)
      const sd = sdMounted.value ? await listStorage('sd', skipped) : []
      apps.value = [...nand, ...sd]
      if (skipped.length > 0) {
        notify(`有 ${skipped.length} 个 App 无法识别：${skipped.join('；')}`, 'warning')
      }
      cachedClient = client.value
      void loadIconsInBackground(generation)
    } catch (error: unknown) {
      invalidate()
      const msg = error instanceof Error ? error.message : String(error)
      notify(`加载 App 列表失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  function findExistingApp (uuid: string): RemoteApp | null {
    return apps.value.find(a => a.info.uuid === uuid) ?? null
  }

  async function uploadZip (
    file: File,
    storage: AppStorage,
    options: { skipReload?: boolean, overwrite?: boolean } = {},
  ) {
    if (!client.value) {
      return
    }
    transferring.value = true
    transferProgress.value = { fileName: '解压 zip…', bytes: 0, total: 1, isUpload: true }
    transferLock.begin('上传 App', '解压 zip…')
    let needRefresh = false

    try {
      const extracted = await extractAppFromZip(file)
      const existing = findExistingApp(extracted.uuid)
      if (existing && !options.overwrite) {
        const label = APP_STORAGES[existing.storage].displayLabel
        notify(`设备上已存在该 App「${extracted.name}」（${label}），已跳过上传`, 'warning')
        return
      }

      // 覆盖更新时沿用旧应用所在存储,避免同 uuid 在两个盘各留一份
      const targetStorage = existing ? existing.storage : storage
      // App 目录名任意，用 uuid 作新目录名保证唯一
      const dirPath = appDirPath(targetStorage, extracted.uuid)
      const totalBytes = extracted.files.reduce((sum, f) => sum + f.data.byteLength, 0)

      // zip 已完整解出、校验通过,此后再删旧目录,失败也不至于两头都没有
      if (existing) {
        const netBytes = Math.max(0, totalBytes - existing.info.totalBytes)
        await assertStorageCapacity(client.value, targetStorage, netBytes)
        transferProgress.value = { fileName: '删除旧版本…', bytes: 0, total: totalBytes, isUpload: true }
        transferLock.update('删除旧版本…', 0, totalBytes)
        await client.value.fileDelete(appDirPath(existing.storage, existing.dirName))
        removeCachedAppIcon(existing.info.uuid)
      } else {
        await assertStorageCapacity(client.value, targetStorage, totalBytes)
      }

      let sent = 0

      await client.value.dirMkdir(dirPath, true)

      for (const item of extracted.files) {
        const remotePath = `${dirPath}/${item.name}`
        const uploadFile = bytesToFile(item.data, item.name)
        await client.value.filePut(uploadFile, remotePath, (current, _total) => {
          const bytes = sent + current
          transferProgress.value = {
            fileName: item.name,
            bytes,
            total: totalBytes,
            isUpload: true,
          }
          transferLock.update(item.name, bytes, totalBytes)
        })
        sent += item.data.byteLength
      }

      if (!options.skipReload) {
        await reloadAppsOnDevice()
      }
      notify(
        existing
          ? `已更新 App: ${extracted.name}${extracted.appVer > 0 ? ` (v${extracted.appVer})` : ''}`
          : `已上传 App: ${extracted.name}`,
        'success',
      )
      needRefresh = !options.skipReload
      if (options.skipReload) {
        // 批量上传由调用方收尾，这里只标记缓存脏了
        invalidate()
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`上传失败: ${msg}`, 'error')
      throw error
    } finally {
      transferring.value = false
      transferProgress.value = null
      transferLock.end()
    }

    // refresh 要逐个重读设备上所有 App 的元数据，放在锁里会让"已上传"提示弹出后
    // 遮罩仍停在 100% 不动，看着像卡死
    if (needRefresh) {
      await refresh()
    }
  }

  async function downloadZip (app: RemoteApp) {
    if (!client.value) {
      return
    }
    const basePath = appDirPath(app.storage, app.dirName)
    transferring.value = true
    transferLock.begin('下载 App')

    try {
      const { files } = await client.value.fileList(basePath)
      const fileNames = files.filter(n => n && !n.includes('/'))
      if (fileNames.length === 0) {
        throw new Error('App 目录为空')
      }

      const sizes: Record<string, number> = {}
      let totalBytes = 0
      for (const name of fileNames) {
        const stat = await client.value.fileStat(`${basePath}/${name}`)
        const size = Number.parseInt(stat.size ?? '0', 10)
        sizes[name] = size
        totalBytes += size
      }

      const zipFiles: { name: string, data: Uint8Array }[] = []
      let received = 0

      for (const name of fileNames) {
        transferProgress.value = {
          fileName: name,
          bytes: received,
          total: totalBytes,
          isUpload: false,
        }
        transferLock.update(name, received, totalBytes)
        const data = await client.value.fileGet(`${basePath}/${name}`, (got, _total) => {
          transferProgress.value = {
            fileName: name,
            bytes: received + got,
            total: totalBytes,
            isUpload: false,
          }
          transferLock.update(name, received + got, totalBytes)
        })
        zipFiles.push({ name, data })
        received += sizes[name] ?? data.byteLength
        transferProgress.value = {
          fileName: name,
          bytes: received,
          total: totalBytes,
          isUpload: false,
        }
        transferLock.update(name, received, totalBytes)
      }

      transferProgress.value = {
        fileName: '打包 zip…',
        bytes: totalBytes,
        total: totalBytes,
        isUpload: false,
      }
      transferLock.update('打包 zip…', totalBytes, totalBytes)

      const zipBlob = await buildMaterialZip(zipFiles)
      const filename = `${sanitizeZipFilename(app.info.name)}.zip`
      triggerBlobDownload(zipBlob, filename)
      notify(`已下载: ${filename}`, 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`下载失败: ${msg}`, 'error')
      throw error
    } finally {
      transferring.value = false
      transferProgress.value = null
      transferLock.end()
    }
  }

  async function deleteApp (app: RemoteApp) {
    if (!client.value) {
      return
    }
    const path = appDirPath(app.storage, app.dirName)
    try {
      await client.value.fileDelete(path)
      removeCachedAppIcon(app.info.uuid)
      await reloadAppsOnDevice()
      notify(`已删除 App: ${app.info.name}`, 'success')
      removeFromList(app)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`删除失败: ${msg}`, 'error')
    }
  }

  function removeFromList (app: RemoteApp) {
    const idx = apps.value.findIndex(a => a.listKey === app.listKey)
    if (idx < 0) {
      return
    }
    const iconUrl = apps.value[idx].info.iconUrl
    if (iconUrl) {
      URL.revokeObjectURL(iconUrl)
    }
    apps.value = apps.value.filter((_, i) => i !== idx)
  }

  /**
   * 页面挂载期间跟随连接状态自动加载。缓存命中时 ensureLoaded 不发任何请求，
   * 所以来回切页面是零成本的；watch 绑在组件作用域上，离开页面即停。
   */
  function bindAutoLoad () {
    ensureLoaded()
    watch([client, sdMounted], () => ensureLoaded())
  }

  return {
    apps,
    loading,
    transferring,
    transferProgress,
    storageOptions,
    bindAutoLoad,
    ensureLoaded,
    refresh,
    invalidate,
    findExistingApp,
    uploadZip,
    reloadApps: reloadAppsOnDevice,
    downloadZip,
    deleteApp,
  }
}

// 连接会话切换即作废缓存。detached scope 保证这两个 watch 不会被首个调用方的组件作用域收走。
effectScope(true).run(() => {
  watch(client, () => {
    iconLoadGeneration += 1
    invalidate()
    revokeIconUrls(apps.value)
    apps.value = []
  })

  // SD 插拔改变可见 App 范围，只作废缓存，等页面自己决定要不要重扫
  watch(sdMounted, invalidate)
})

function guessImageMime (path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'png': { return 'image/png'
    }
    case 'jpg':
    case 'jpeg': { return 'image/jpeg'
    }
    case 'gif': { return 'image/gif'
    }
    case 'webp': { return 'image/webp'
    }
    case 'bmp': { return 'image/bmp'
    }
    default: { return 'application/octet-stream'
    }
  }
}
