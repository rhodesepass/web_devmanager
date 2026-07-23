import type { UsbResponderClient } from '@/usb'
import { computed, ref, type Ref, watch } from 'vue'
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

export interface UseAppsOptions {
  /** 连接设备后是否自动拉取设备 App 列表，默认 true */
  autoRefresh?: boolean
}

export function useApps (
  client: Ref<UsbResponderClient | null>,
  sdMounted: Ref<boolean>,
  options: UseAppsOptions = {},
) {
  const autoRefresh = options.autoRefresh !== false
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  const apps = ref<RemoteApp[]>([])
  const loading = ref(false)
  const transferring = ref(false)
  const transferProgress = ref<TransferProgress | null>(null)
  let iconLoadGeneration = 0

  const storageOptions = computed(() => {
    const opts = [APP_STORAGES.nand]
    if (sdMounted.value) {
      opts.push(APP_STORAGES.sd)
    }
    return opts
  })

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

  async function refresh () {
    if (!client.value) {
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
      void loadIconsInBackground(generation)
    } catch (error: unknown) {
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
      if (!options.skipReload) {
        await refresh()
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
      await refresh()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`删除失败: ${msg}`, 'error')
    }
  }

  if (autoRefresh) {
    watch(client, c => {
      if (c) {
        refresh()
      } else {
        revokeIconUrls(apps.value)
        apps.value = []
      }
    }, { immediate: true })

    watch(sdMounted, () => {
      if (client.value) {
        refresh()
      }
    })
  }

  return {
    apps,
    loading,
    transferring,
    transferProgress,
    storageOptions,
    refresh,
    findExistingApp,
    uploadZip,
    reloadApps: reloadAppsOnDevice,
    downloadZip,
    deleteApp,
  }
}

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
