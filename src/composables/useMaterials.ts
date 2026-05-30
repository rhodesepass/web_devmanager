import type { UsbResponderClient } from '@/usb'
import { computed, ref, type Ref, watch } from 'vue'
import {
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
import { formatBytes } from '@/utils/format'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

function materialDirPath (storage: MaterialStorage, uuid: string): string {
  return `${MATERIAL_STORAGES[storage].assetsBasePath}/${uuid}`
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

async function assertStorageCapacity (
  client: UsbResponderClient,
  storage: MaterialStorage,
  requiredBytes: number,
): Promise<void> {
  const devInfo = await client.devinfo()
  const label = MATERIAL_STORAGES[storage].displayLabel

  if (storage === 'sd' && devInfo.sd_mounted !== '1') {
    throw new Error('SD 卡未挂载，无法上传到 SD 存储')
  }

  const freeKey = storage === 'nand' ? 'nand_free_bytes' : 'sd_free_bytes'
  const freeBytes = Number.parseInt(devInfo[freeKey] ?? '0', 10)
  if (requiredBytes > freeBytes) {
    throw new Error(
      `${label} 存储空间不足：需要 ${formatBytes(requiredBytes)}，剩余 ${formatBytes(freeBytes)}`,
    )
  }
}

async function materialExistsOnStorage (
  client: UsbResponderClient,
  storage: MaterialStorage,
  uuid: string,
): Promise<boolean> {
  const cfg = MATERIAL_STORAGES[storage]
  try {
    const listing = await client.fileList(cfg.assetsBasePath)
    return listing.dirs.some(d => d.trim().replace(/\/$/, '') === uuid)
  } catch {
    return false
  }
}

export function useMaterials (
  client: Ref<UsbResponderClient | null>,
  sdMounted: Ref<boolean>,
) {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  const materials = ref<RemoteMaterial[]>([])
  const loading = ref(false)
  const transferring = ref(false)
  const transferProgress = ref<TransferProgress | null>(null)
  let iconLoadGeneration = 0

  const storageOptions = computed(() => {
    const opts = [MATERIAL_STORAGES.nand]
    if (sdMounted.value) {
      opts.push(MATERIAL_STORAGES.sd)
    }
    return opts
  })

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

  async function listStorage (storage: MaterialStorage): Promise<RemoteMaterial[]> {
    if (!client.value) {
      return []
    }
    const cfg = MATERIAL_STORAGES[storage]
    let dirs: string[]
    try {
      const listing = await client.value.fileList(cfg.assetsBasePath)
      dirs = listing.dirs
    } catch {
      return []
    }

    const result: RemoteMaterial[] = []
    for (const raw of dirs) {
      const folderName = raw.trim().replace(/\/$/, '')
      if (!folderName || folderName.includes('/')) {
        continue
      }

      const basePath = materialDirPath(storage, folderName)
      try {
        const configBytes = await client.value.fileGet(`${basePath}/epconfig.json`)
        const configText = new TextDecoder().decode(configBytes)
        const parsed = parseEpConfig(configText, folderName)

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

        const info = toMaterialInfo(parsed, files.length, totalBytes, null)
        result.push({
          info,
          storage,
          listKey: `${storage}:${info.uuid}`,
        })
      } catch {
        // skip invalid material folders
      }
    }
    return result
  }

  async function loadIconsInBackground (generation: number) {
    const c = client.value
    if (!c) {
      return
    }

    for (const item of materials.value) {
      if (generation !== iconLoadGeneration || !client.value) {
        return
      }
      const iconPath = item.info.iconRelativePath
      if (!iconPath || item.info.iconUrl) {
        continue
      }

      const basePath = materialDirPath(item.storage, item.info.uuid)
      try {
        const iconBytes = await c.fileGet(`${basePath}/${iconPath}`)
        if (generation !== iconLoadGeneration) {
          return
        }

        const mime = guessImageMime(iconPath)
        const iconCopy = new Uint8Array(iconBytes)
        const iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: mime }))

        const idx = materials.value.findIndex(m => m.listKey === item.listKey)
        if (idx < 0 || generation !== iconLoadGeneration) {
          URL.revokeObjectURL(iconUrl)
          return
        }

        const current = materials.value[idx]
        if (current.info.iconUrl) {
          URL.revokeObjectURL(current.info.iconUrl)
        }
        materials.value[idx] = {
          ...current,
          info: { ...current.info, iconUrl },
        }
      } catch {
        // icon download failure is non-fatal
      }
    }
  }

  async function refresh () {
    if (!client.value) {
      revokeIconUrls(materials.value)
      materials.value = []
      return
    }
    loading.value = true
    iconLoadGeneration += 1
    const generation = iconLoadGeneration
    try {
      revokeIconUrls(materials.value)
      const nand = await listStorage('nand')
      const sd = sdMounted.value ? await listStorage('sd') : []
      materials.value = [...nand, ...sd]
      void loadIconsInBackground(generation)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`加载素材列表失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  async function findExistingMaterialStorage (uuid: string): Promise<MaterialStorage | null> {
    if (!client.value) {
      return null
    }
    if (await materialExistsOnStorage(client.value, 'nand', uuid)) {
      return 'nand'
    }
    if (sdMounted.value && await materialExistsOnStorage(client.value, 'sd', uuid)) {
      return 'sd'
    }
    return null
  }

  async function uploadZip (file: File, storage: MaterialStorage) {
    if (!client.value) {
      return
    }
    transferring.value = true
    transferProgress.value = { fileName: '解压 zip…', bytes: 0, total: 1, isUpload: true }
    transferLock.begin('上传素材', '解压 zip…')

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

      await reloadAssetsOnDevice()
      notify(`已上传素材: ${extracted.name}`, 'success')
      await refresh()
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

  async function downloadZip (material: RemoteMaterial) {
    if (!client.value) {
      return
    }
    const basePath = materialDirPath(material.storage, material.info.uuid)
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
        const data = await client.value.fileGet(`${basePath}/${name}`)
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
    const path = materialDirPath(material.storage, material.info.uuid)
    try {
      await client.value.fileDelete(path)
      await reloadAssetsOnDevice()
      notify(`已删除素材: ${material.info.name}`, 'success')
      await refresh()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`删除失败: ${msg}`, 'error')
    }
  }

  watch(client, c => {
    if (c) {
      refresh()
    } else {
      revokeIconUrls(materials.value)
      materials.value = []
    }
  }, { immediate: true })

  watch(sdMounted, () => {
    if (client.value) {
      refresh()
    }
  })

  return {
    materials,
    loading,
    transferring,
    transferProgress,
    storageOptions,
    refresh,
    uploadZip,
    downloadZip,
    deleteMaterial,
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
