import { ref, computed, getCurrentScope, onScopeDispose, watch, type Ref } from 'vue'
import JSZip from 'jszip'
import type { UsbResponderClient } from '@/usb'
import { assertStorageCapacity, storageOfPath } from '@/utils/deviceStorage'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

export interface FileEntry {
  name: string
  isDir: boolean
  size?: number
  perm?: string
  type?: string
  owner?: string
}

export interface FilePreview {
  name: string
  kind: 'text' | 'image'
  text?: string
  truncated?: boolean
  imageUrl?: string
}

const TEXT_EXTS = new Set([
  'txt', 'log', 'json', 'md', 'ini', 'conf', 'cfg',
  'xml', 'yml', 'yaml', 'csv', 'sh',
])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

const TEXT_PREVIEW_LIMIT = 512 * 1024
const IMAGE_PREVIEW_LIMIT = 8 * 1024 * 1024
// 超长文本整个塞进 DOM 会卡渲染，截断显示
const TEXT_DISPLAY_LIMIT = 256 * 1024

function extOf (name: string): string {
  const idx = name.lastIndexOf('.')
  return idx < 0 ? '' : name.slice(idx + 1).toLowerCase()
}

function imageMime (name: string): string {
  switch (extOf(name)) {
    case 'png': { return 'image/png' }
    case 'jpg':
    case 'jpeg': { return 'image/jpeg' }
    case 'gif': { return 'image/gif' }
    case 'webp': { return 'image/webp' }
    case 'bmp': { return 'image/bmp' }
    default: { return 'application/octet-stream' }
  }
}

export function isPreviewable (entry: FileEntry): boolean {
  if (entry.isDir) return false
  const ext = extOf(entry.name)
  return TEXT_EXTS.has(ext) || IMAGE_EXTS.has(ext)
}

export function useFileBrowser (client: Ref<UsbResponderClient | null>) {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  // 起始目录 /root:路径体系是相对设备根的,'.' 代表根,故写作 'root'
  const currentPath = ref('root')
  const entries = ref<FileEntry[]>([])
  const loading = ref(false)
  const selected = ref<string[]>([])
  const uploadProgress = ref(0)
  const uploading = ref(false)
  const preview = ref<FilePreview | null>(null)
  let disposed = false

  async function refresh () {
    if (!client.value) return
    loading.value = true
    try {
      const { files, dirs } = await client.value.fileList(currentPath.value)
      const list: FileEntry[] = [
        ...dirs.map(d => ({ name: d, isDir: true } as FileEntry)),
        ...files.map(f => ({ name: f, isDir: false } as FileEntry)),
      ]
      // enrich with stat
      for (const entry of list) {
        if (disposed) return
        try {
          const path = currentPath.value === '.'
            ? entry.name
            : `${currentPath.value}/${entry.name}`
          const stat = await client.value.fileStat(path)
          entry.size = parseInt(stat.size ?? '0', 10)
          entry.perm = stat.perm
          entry.type = stat.type
          entry.owner = stat.owner
        } catch {
          // stat failure is non-fatal
        }
      }
      entries.value = list
    } catch (e: any) {
      notify(`目录列表失败: ${e.message}`, 'error')
    } finally {
      loading.value = false
    }
  }

  function navigate (path: string) {
    if (transferLock.active.value) {
      return
    }
    currentPath.value = path
    selected.value = []
  }

  function goUp () {
    if (transferLock.active.value) {
      return
    }
    if (currentPath.value === '.') return
    const parts = currentPath.value.split('/')
    parts.pop()
    currentPath.value = parts.length === 0 ? '.' : parts.join('/')
  }

  const breadcrumbs = computed(() => {
    if (currentPath.value === '.') return [{ title: '/', path: '.' }]
    const parts = currentPath.value.split('/')
    const crumbs: { title: string; path: string }[] = [{ title: '/', path: '.' }]
    let accum = ''
    for (const part of parts) {
      accum = accum ? `${accum}/${part}` : part
      crumbs.push({ title: part, path: accum })
    }
    return crumbs
  })

  async function upload (file: File, remotePath?: string) {
    if (!client.value) return
    const path = remotePath ?? (
      currentPath.value === '.'
        ? file.name
        : `${currentPath.value}/${file.name}`
    )
    uploading.value = true
    uploadProgress.value = 0
    transferLock.begin('上传文件', file.name)
    let needRefresh = false
    try {
      await assertStorageCapacity(client.value, storageOfPath(path), file.size)
      await client.value.filePut(file, path, (sent, total) => {
        uploadProgress.value = Math.round((sent / total) * 100)
        transferLock.update(file.name, sent, total)
      })
      notify(`已上传: ${file.name}`, 'success')
      needRefresh = true
    } catch (e: any) {
      notify(`上传失败: ${e.message}`, 'error')
    } finally {
      uploading.value = false
      uploadProgress.value = 0
      transferLock.end()
    }

    // 目录重列走 USB，留在锁里会让成功提示弹出后遮罩还停在 100%
    if (needRefresh) {
      await refresh()
    }
  }

  /** 上传整个文件夹：files 来自 <input webkitdirectory>，用各自的 webkitRelativePath 还原目录结构 */
  async function uploadFolder (files: File[]) {
    const c = client.value
    if (!c || files.length === 0) return
    const base = currentPath.value === '.' ? '' : `${currentPath.value}/`
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0)
    let sentTotal = 0

    uploading.value = true
    uploadProgress.value = 0
    transferLock.begin('上传文件夹', `${files.length} 个文件`)
    let needRefresh = false
    try {
      await assertStorageCapacity(c, storageOfPath(currentPath.value), totalBytes)
      for (const [i, file] of files.entries()) {
        const rel = file.webkitRelativePath || file.name
        const label = `[${i + 1}/${files.length}] ${rel}`
        await c.filePut(file, base + rel, (sent, _total) => {
          const bytes = sentTotal + sent
          uploadProgress.value = totalBytes > 0 ? Math.round((bytes / totalBytes) * 100) : 0
          transferLock.update(label, bytes, totalBytes)
        })
        sentTotal += file.size
      }
      notify(`已上传文件夹：${files.length} 个文件`, 'success')
      needRefresh = true
    } catch (e: any) {
      notify(`上传文件夹失败: ${e.message}`, 'error')
    } finally {
      uploading.value = false
      uploadProgress.value = 0
      transferLock.end()
    }

    if (needRefresh) {
      await refresh()
    }
  }

  /** 递归下载设备目录，打包成 zip 下载到本地 */
  async function downloadFolder (name: string) {
    const c = client.value
    if (!c) return
    const rootPath = currentPath.value === '.' ? name : `${currentPath.value}/${name}`

    transferLock.begin('下载文件夹', name)
    try {
      const zip = new JSZip()

      const walk = async (devPath: string, folder: JSZip) => {
        const { files, dirs } = await c.fileList(devPath)
        for (const raw of files) {
          const fileName = raw.trim().replace(/\/$/, '')
          if (!fileName) continue
          transferLock.update(fileName)
          const data = await c.fileGet(`${devPath}/${fileName}`, (got, total) => {
            transferLock.update(fileName, got, total)
          })
          folder.file(fileName, data)
        }
        for (const raw of dirs) {
          const dirName = raw.trim().replace(/\/$/, '')
          if (!dirName || dirName === '.' || dirName === '..') continue
          const sub = folder.folder(dirName)
          if (sub) {
            await walk(`${devPath}/${dirName}`, sub)
          }
        }
      }

      await walk(rootPath, zip)

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.zip`
      a.click()
      URL.revokeObjectURL(url)
      notify(`已下载文件夹: ${name}.zip`, 'success')
    } catch (e: any) {
      notify(`下载文件夹失败: ${e.message}`, 'error')
    } finally {
      transferLock.end()
    }
  }

  async function download (name: string) {
    if (!client.value) return
    const path = currentPath.value === '.'
      ? name
      : `${currentPath.value}/${name}`
    transferLock.begin('下载文件', name)
    try {
      const data = await client.value.fileGet(path)
      transferLock.update(name, data.byteLength, data.byteLength)
      const blob = new Blob([data as BlobPart])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      notify(`已下载: ${name}`, 'success')
    } catch (e: any) {
      notify(`下载失败: ${e.message}`, 'error')
    } finally {
      transferLock.end()
    }
  }

  async function previewFile (entry: FileEntry) {
    const c = client.value
    if (!c || entry.isDir) return
    const isImage = IMAGE_EXTS.has(extOf(entry.name))
    const limit = isImage ? IMAGE_PREVIEW_LIMIT : TEXT_PREVIEW_LIMIT
    // 协议不支持部分读取，超限的文件只能整个拉回来，干脆拒绝
    if ((entry.size ?? 0) > limit) {
      notify(`文件过大（${Math.round((entry.size ?? 0) / 1024)} KB），请下载后查看`, 'warning')
      return
    }
    const path = currentPath.value === '.'
      ? entry.name
      : `${currentPath.value}/${entry.name}`
    transferLock.begin('预览文件', entry.name)
    try {
      const data = await c.fileGet(path, (got, total) => {
        transferLock.update(entry.name, got, total)
      })
      closePreview()
      if (isImage) {
        const copy = new Uint8Array(data)
        const imageUrl = URL.createObjectURL(new Blob([copy], { type: imageMime(entry.name) }))
        preview.value = { name: entry.name, kind: 'image', imageUrl }
      } else {
        const truncated = data.byteLength > TEXT_DISPLAY_LIMIT
        const text = new TextDecoder().decode(data.subarray(0, TEXT_DISPLAY_LIMIT))
        preview.value = { name: entry.name, kind: 'text', text, truncated }
      }
    } catch (e: any) {
      notify(`预览失败: ${e.message}`, 'error')
    } finally {
      transferLock.end()
    }
  }

  function closePreview () {
    if (preview.value?.imageUrl) {
      URL.revokeObjectURL(preview.value.imageUrl)
    }
    preview.value = null
  }

  async function deleteEntry (name: string) {
    if (!client.value) return
    const path = currentPath.value === '.'
      ? name
      : `${currentPath.value}/${name}`
    try {
      await client.value.fileDelete(path)
      notify(`已删除: ${name}`, 'success')
      await refresh()
    } catch (e: any) {
      notify(`删除失败: ${e.message}`, 'error')
    }
  }

  async function renameEntry (from: string, to: string) {
    if (!client.value) return
    const fromPath = currentPath.value === '.'
      ? from
      : `${currentPath.value}/${from}`
    const toPath = currentPath.value === '.'
      ? to
      : `${currentPath.value}/${to}`
    try {
      await client.value.fileRename(fromPath, toPath)
      notify(`已重命名: ${from} -> ${to}`, 'success')
      await refresh()
    } catch (e: any) {
      notify(`重命名失败: ${e.message}`, 'error')
    }
  }

  async function createDirectory (name: string, parents = false) {
    if (!client.value) return
    const path = currentPath.value === '.'
      ? name
      : `${currentPath.value}/${name}`
    try {
      await client.value.dirMkdir(path, parents)
      notify(`已创建目录: ${name}`, 'success')
      await refresh()
    } catch (e: any) {
      notify(`创建目录失败: ${e.message}`, 'error')
    }
  }

  watch(client, (c) => {
    if (c) refresh()
  }, { immediate: true })

  watch(currentPath, () => {
    if (client.value) refresh()
  })

  // 大目录下 stat 循环可能还卡在 await USB 上，卸载后让它自行退出，别继续抢 client mutex
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      closePreview()
    })
  }

  return {
    currentPath,
    entries,
    loading,
    selected,
    breadcrumbs,
    uploadProgress,
    uploading,
    preview,
    navigate,
    goUp,
    refresh,
    upload,
    uploadFolder,
    download,
    downloadFolder,
    previewFile,
    closePreview,
    deleteEntry,
    renameEntry,
    createDirectory,
  }
}
