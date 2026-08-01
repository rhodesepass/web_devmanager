import type { UsbResponderClient } from '@/usb'
import { computed, effectScope, ref, watch } from 'vue'
import {
  type MaterialLoadProgress,
  MATERIAL_STORAGES,
  type MaterialStorage,
  type RemoteMaterial,
  type TransferProgress,
} from '@/types/material'
import { parseEpConfig, toMaterialInfo } from '@/utils/epconfig'
import {
  buildMaterialZip,
  extractMaterialFromZip,
  sanitizeZipFilename,
  triggerBlobDownload,
} from '@/utils/zipMaterial'
import { assertStorageCapacity } from '@/utils/deviceStorage'
import {
  getCachedMaterialIcon,
  removeCachedMaterialIcon,
  setCachedMaterialIcon,
} from '@/utils/materialIconCache'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'
import { useUsb } from './useUsb'

function materialDirPath (storage: MaterialStorage, dirName: string): string {
  return `${MATERIAL_STORAGES[storage].assetsBasePath}/${dirName}`
}

function bytesToFile (data: Uint8Array, name: string): File {
  const copy = new Uint8Array(data)
  return new File([copy], name, { type: 'application/octet-stream' })
}

function revokeIconUrls (materials: RemoteMaterial[]) {
  for (const m of materials) {
    if (m.info.iconUrl) {
      URL.revokeObjectURL(m.info.iconUrl)
    }
  }
}

async function materialDirExists (
  client: UsbResponderClient,
  storage: MaterialStorage,
  dirName: string,
): Promise<boolean> {
  const cfg = MATERIAL_STORAGES[storage]
  try {
    const listing = await client.fileList(cfg.assetsBasePath)
    return listing.dirs.some(d => d.trim().replace(/\/$/, '') === dirName)
  } catch {
    return false
  }
}

// 设备素材列表挂在模块上而非组件闭包里：缓存边界是"一次 USB 连接"，
// 同一次连接内来回切页面直接复用，不再逐个目录重扫。
const { client, devInfo } = useUsb()
const { notify } = useNotifications()
const transferLock = useTransferLock()

const sdMounted = computed(() => devInfo.value?.sd_mounted === '1')
const materials = ref<RemoteMaterial[]>([])
const loading = ref(false)
const transferring = ref(false)
const transferProgress = ref<TransferProgress | null>(null)
const loadProgress = ref<MaterialLoadProgress | null>(null)
let iconLoadGeneration = 0

/** 当前缓存对应哪个 client 实例；与 client.value 不一致即视为缓存失效 */
let cachedClient: UsbResponderClient | null = null

const storageOptions = computed(() => {
  const opts = [MATERIAL_STORAGES.nand]
  if (sdMounted.value) {
    opts.push(MATERIAL_STORAGES.sd)
  }
  return opts
})

function invalidate () {
  cachedClient = null
}

export function useMaterials () {
  async function reloadAssetsOnDevice () {
    if (!client.value) {
      return
    }
    try {
      const result = await client.value.commandExec('epassctl prts reload_assets')
      if (result.exitCode !== 0) {
        const err = new TextDecoder().decode(result.stderr).trim()
        notify(
          `素材已传输，但 reload_assets 失败${err ? `: ${err}` : ''}`,
          'warning',
        )
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`素材已传输，但 reload_assets 失败: ${msg}`, 'warning')
    }
  }

  async function listStorageDirs (storage: MaterialStorage): Promise<string[]> {
    if (!client.value) {
      return []
    }
    const cfg = MATERIAL_STORAGES[storage]
    try {
      const listing = await client.value.fileList(cfg.assetsBasePath)
      return listing.dirs
        .map(d => d.trim().replace(/\/$/, ''))
        .filter(d => d && !d.includes('/'))
    } catch {
      return []
    }
  }

  async function loadMaterial (
    storage: MaterialStorage,
    dirName: string,
  ): Promise<RemoteMaterial | null> {
    if (!client.value) {
      return null
    }
    const basePath = materialDirPath(storage, dirName)
    try {
      const configBytes = await client.value.fileGet(`${basePath}/epconfig.json`)
      const configText = new TextDecoder().decode(configBytes)
      const parsed = parseEpConfig(configText, dirName)

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

      const info = toMaterialInfo(parsed, files.length, totalBytes, null, iconBytes)
      return {
        info,
        storage,
        dirName,
        listKey: `${storage}:${dirName}`,
      }
    } catch {
      // skip invalid material folders
      return null
    }
  }

  function applyMaterialIcon (
    listKey: string,
    iconUrl: string,
    generation: number,
  ): boolean {
    const idx = materials.value.findIndex(m => m.listKey === listKey)
    if (idx < 0 || generation !== iconLoadGeneration) {
      URL.revokeObjectURL(iconUrl)
      return false
    }

    const current = materials.value[idx]
    if (current.info.iconUrl) {
      URL.revokeObjectURL(current.info.iconUrl)
    }
    materials.value[idx] = {
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

    const pending = materials.value.filter(m => m.info.iconRelativePath && !m.info.iconUrl)
    if (pending.length === 0) {
      loadProgress.value = null
      return
    }
    let done = 0
    loadProgress.value = { phase: 'icon', done, total: pending.length, label: '加载图标…' }

    try {
      for (const item of pending) {
        if (generation !== iconLoadGeneration || !client.value) {
          return
        }
        const iconPath = item.info.iconRelativePath
        if (!iconPath || item.info.iconUrl) {
          continue
        }

        done += 1
        loadProgress.value = {
          phase: 'icon',
          done,
          total: pending.length,
          label: item.info.name,
        }

        const iconBytes = item.info.iconBytes
        if (iconBytes != null && iconBytes > 0) {
          const cached = getCachedMaterialIcon(item.info.uuid, iconBytes)
          if (cached) {
            const iconCopy = new Uint8Array(cached.bytes)
            const iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: cached.mime }))
            if (applyMaterialIcon(item.listKey, iconUrl, generation)) {
              continue
            }
            return
          }
        }

        const basePath = materialDirPath(item.storage, item.dirName)
        try {
          const fetchedBytes = await c.fileGet(`${basePath}/${iconPath}`)
          if (generation !== iconLoadGeneration) {
            return
          }

          const mime = guessImageMime(iconPath)
          const iconCopy = new Uint8Array(fetchedBytes)
          const iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: mime }))

          if (!applyMaterialIcon(item.listKey, iconUrl, generation)) {
            return
          }

          if (iconBytes != null && iconBytes > 0) {
            setCachedMaterialIcon(item.info.uuid, iconBytes, mime, iconCopy)
          }
        } catch {
          // icon download failure is non-fatal
        }
      }
    } finally {
      if (generation === iconLoadGeneration) {
        loadProgress.value = null
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
      revokeIconUrls(materials.value)
      materials.value = []
      loadProgress.value = null
      return
    }
    loading.value = true
    iconLoadGeneration += 1
    const generation = iconLoadGeneration
    loadProgress.value = { phase: 'list', done: 0, total: 0, label: '扫描素材目录…' }
    try {
      revokeIconUrls(materials.value)
      materials.value = []

      const entries: { storage: MaterialStorage, dirName: string }[] = []
      for (const dirName of await listStorageDirs('nand')) {
        entries.push({ storage: 'nand', dirName })
      }
      if (sdMounted.value) {
        for (const dirName of await listStorageDirs('sd')) {
          entries.push({ storage: 'sd', dirName })
        }
      }

      // 逐个读元数据并即时上屏，慢链路下不至于长时间空列表
      const loaded: RemoteMaterial[] = []
      for (const [i, entry] of entries.entries()) {
        if (generation !== iconLoadGeneration) {
          return
        }
        loadProgress.value = {
          phase: 'meta',
          done: i,
          total: entries.length,
          label: entry.dirName,
        }
        const material = await loadMaterial(entry.storage, entry.dirName)
        if (material) {
          loaded.push(material)
          materials.value = [...loaded]
        }
      }
      loadProgress.value = {
        phase: 'meta',
        done: entries.length,
        total: entries.length,
        label: '',
      }
      // 元数据齐了就算这次连接的缓存建立完成，图标可以慢慢补
      cachedClient = client.value
      void loadIconsInBackground(generation)
    } catch (error: unknown) {
      invalidate()
      loadProgress.value = null
      const msg = error instanceof Error ? error.message : String(error)
      notify(`加载素材列表失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  /** 新增一条后只补读这一个目录，不为了一条素材重扫整个设备 */
  async function appendMaterial (storage: MaterialStorage, dirName: string) {
    if (cachedClient !== client.value) {
      // 缓存还没建立过，下次进页面本来就要全量拉，这里不必补
      return
    }
    const material = await loadMaterial(storage, dirName)
    if (!material) {
      invalidate()
      return
    }
    materials.value = [...materials.value, material]
    void loadIconsInBackground(iconLoadGeneration)
  }

  function removeFromList (material: RemoteMaterial) {
    const idx = materials.value.findIndex(m => m.listKey === material.listKey)
    if (idx < 0) {
      return
    }
    const iconUrl = materials.value[idx].info.iconUrl
    if (iconUrl) {
      URL.revokeObjectURL(iconUrl)
    }
    materials.value = materials.value.filter((_, i) => i !== idx)
  }

  async function findExistingMaterialStorage (uuid: string): Promise<MaterialStorage | null> {
    // 目录名不保证等于 uuid，优先查已加载列表里解析出来的真实 uuid
    const known = materials.value.find(m => m.info.uuid === uuid)
    if (known) {
      return known.storage
    }
    if (!client.value) {
      return null
    }
    // 本站上传时目录名就是 uuid，批量上传未刷新列表时靠这条兜底
    if (await materialDirExists(client.value, 'nand', uuid)) {
      return 'nand'
    }
    if (sdMounted.value && await materialDirExists(client.value, 'sd', uuid)) {
      return 'sd'
    }
    return null
  }

  async function uploadZip (
    file: File,
    storage: MaterialStorage,
    options: { skipReload?: boolean } = {},
  ) {
    if (!client.value) {
      return
    }
    transferring.value = true
    transferProgress.value = { fileName: '解压 zip…', bytes: 0, total: 1, isUpload: true }
    transferLock.begin('上传素材', '解压 zip…')
    let uploadedDir: string | null = null

    try {
      const extracted = await extractMaterialFromZip(file)
      const existingStorage = await findExistingMaterialStorage(extracted.uuid)
      if (existingStorage) {
        const label = MATERIAL_STORAGES[existingStorage].displayLabel
        notify(`设备上已存在该素材「${extracted.name}」（${label}），已跳过上传`, 'warning')
        return
      }

      const dirPath = materialDirPath(storage, extracted.uuid)
      const totalBytes = extracted.files.reduce((sum, f) => sum + f.data.byteLength, 0)

      await assertStorageCapacity(client.value, storage, totalBytes)

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

      // 批量上传时跳过每次的重载/刷新，由调用方在整批结束后统一执行一次
      if (options.skipReload) {
        invalidate()
      } else {
        await reloadAssetsOnDevice()
        uploadedDir = extracted.uuid
      }
      notify(`已上传素材: ${extracted.name}`, 'success')
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`上传失败: ${msg}`, 'error')
      throw error
    } finally {
      transferring.value = false
      transferProgress.value = null
      transferLock.end()
    }

    // 补读要发 USB 请求，放在锁里会让"已上传"提示弹出后遮罩仍停在 100% 不动，看着像卡死
    if (uploadedDir) {
      await appendMaterial(storage, uploadedDir)
    }
  }

  async function downloadZip (material: RemoteMaterial) {
    if (!client.value) {
      return
    }
    const basePath = materialDirPath(material.storage, material.dirName)
    transferring.value = true
    transferLock.begin('下载素材')

    try {
      const { files } = await client.value.fileList(basePath)
      const fileNames = files.filter(n => n && !n.includes('/'))
      if (fileNames.length === 0) {
        throw new Error('素材目录为空')
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
      const filename = `${sanitizeZipFilename(material.info.name)}.zip`
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

  async function deleteMaterial (material: RemoteMaterial) {
    if (!client.value) {
      return
    }
    const path = materialDirPath(material.storage, material.dirName)
    try {
      await client.value.fileDelete(path)
      removeCachedMaterialIcon(material.info.uuid)
      await reloadAssetsOnDevice()
      notify(`已删除素材: ${material.info.name}`, 'success')
      removeFromList(material)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`删除失败: ${msg}`, 'error')
    }
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
    materials,
    loading,
    transferring,
    transferProgress,
    loadProgress,
    storageOptions,
    bindAutoLoad,
    ensureLoaded,
    refresh,
    invalidate,
    uploadZip,
    reloadAssets: reloadAssetsOnDevice,
    downloadZip,
    deleteMaterial,
  }
}

// 连接会话切换即作废缓存。detached scope 保证这两个 watch 不会被首个调用方的组件作用域收走。
effectScope(true).run(() => {
  watch(client, () => {
    iconLoadGeneration += 1
    invalidate()
    revokeIconUrls(materials.value)
    materials.value = []
    loadProgress.value = null
  })

  // SD 插拔改变可见素材范围，只作废缓存，等页面自己决定要不要重扫
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
