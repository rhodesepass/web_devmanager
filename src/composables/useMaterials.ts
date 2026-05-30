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

        let iconUrl: string | null = null
        if (parsed.iconRelativePath) {
          try {
            const iconBytes = await client.value.fileGet(
              `${basePath}/${parsed.iconRelativePath}`,
            )
            const mime = guessImageMime(parsed.iconRelativePath)
            const iconCopy = new Uint8Array(iconBytes)
            iconUrl = URL.createObjectURL(new Blob([iconCopy], { type: mime }))
          } catch {
            // icon download failure is non-fatal
          }
        }

        const info = toMaterialInfo(parsed, files.length, totalBytes, iconUrl)
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

  async function refresh () {
    if (!client.value) {
      revokeIconUrls(materials.value)
      materials.value = []
      return
    }
    loading.value = true
    try {
      revokeIconUrls(materials.value)
      const nand = await listStorage('nand')
      const sd = sdMounted.value ? await listStorage('sd') : []
      materials.value = [...nand, ...sd]
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`加载素材列表失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
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
      const dirPath = materialDirPath(storage, extracted.uuid)
      const totalBytes = extracted.files.reduce((sum, f) => sum + f.data.byteLength, 0)
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
