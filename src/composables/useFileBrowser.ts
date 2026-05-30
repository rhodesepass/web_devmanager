import { ref, computed, watch, type Ref } from 'vue'
import type { UsbResponderClient } from '@/usb'
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

export function useFileBrowser (client: Ref<UsbResponderClient | null>) {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()
  const currentPath = ref('.')
  const entries = ref<FileEntry[]>([])
  const loading = ref(false)
  const selected = ref<string[]>([])
  const uploadProgress = ref(0)
  const uploading = ref(false)

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
    try {
      await client.value.filePut(file, path, (sent, total) => {
        uploadProgress.value = Math.round((sent / total) * 100)
        transferLock.update(file.name, sent, total)
      })
      notify(`已上传: ${file.name}`, 'success')
      await refresh()
    } catch (e: any) {
      notify(`上传失败: ${e.message}`, 'error')
    } finally {
      uploading.value = false
      uploadProgress.value = 0
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

  return {
    currentPath,
    entries,
    loading,
    selected,
    breadcrumbs,
    uploadProgress,
    uploading,
    navigate,
    goUp,
    refresh,
    upload,
    download,
    deleteEntry,
    renameEntry,
    createDirectory,
  }
}
