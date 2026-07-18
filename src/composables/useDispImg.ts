import type { UsbResponderClient } from '@/usb'
import { ref, type Ref } from 'vue'
import {
  DISP_IMG_DIR,
  type DispImgInfo,
  type DispImgTransferProgress,
} from '@/types/dispimg'
import { assertStorageCapacity, storageOfPath } from '@/utils/deviceStorage'
import { isJpegName } from '@/utils/dispImgProcess'
import { triggerBlobDownload } from '@/utils/zipMaterial'
import { useNotifications } from './useNotifications'
import { useTransferLock } from './useTransferLock'

function imgPath (name: string): string {
  return `${DISP_IMG_DIR}/${name}`
}

function readImageSize (url: string): Promise<{ width: number | null; height: number | null }> {
  return new Promise(resolve => {
    const img = new Image()
    img.addEventListener('load', () => resolve({ width: img.naturalWidth, height: img.naturalHeight }))
    img.addEventListener('error', () => resolve({ width: null, height: null }))
    img.src = url
  })
}

function revokeThumbs (list: DispImgInfo[]) {
  for (const img of list) {
    if (img.thumbUrl) {
      URL.revokeObjectURL(img.thumbUrl)
    }
  }
}

export function useDispImg (client: Ref<UsbResponderClient | null>) {
  const { notify } = useNotifications()
  const transferLock = useTransferLock()

  const images = ref<DispImgInfo[]>([])
  const loading = ref(false)
  const transferring = ref(false)
  const transferProgress = ref<DispImgTransferProgress | null>(null)

  async function refresh () {
    const c = client.value
    if (!c) {
      revokeThumbs(images.value)
      images.value = []
      return
    }
    loading.value = true
    try {
      let names: string[]
      try {
        const { files } = await c.fileList(DISP_IMG_DIR)
        names = files
          .map(f => f.trim().replace(/\/$/, ''))
          .filter(n => n && !n.includes('/') && isJpegName(n))
          .sort()
      } catch {
        // 目录不存在：建好后按空列表处理
        try {
          await c.dirMkdir(DISP_IMG_DIR, true)
        } catch {
          // ignore
        }
        names = []
      }

      // 继承上一轮已加载的预览：卡片 key=name，复用的组件不会再触发 onMounted，
      // 若把 thumbUrl 清空就再也不会重新加载，缩略图会永久转圈。只对消失的图 revoke。
      const prev = new Map(images.value.map(i => [i.name, i]))

      const list: DispImgInfo[] = []
      for (const name of names) {
        let size = 0
        try {
          const stat = await c.fileStat(imgPath(name))
          size = Number.parseInt(stat.size ?? '0', 10)
        } catch {
          // stat 失败不致命
        }
        const old = prev.get(name)
        prev.delete(name)
        list.push({
          name,
          sizeBytes: size,
          thumbUrl: old?.thumbUrl ?? null,
          width: old?.width ?? null,
          height: old?.height ?? null,
        })
      }

      // prev 中剩下的是本轮已不存在的图，释放其预览 URL
      for (const stale of prev.values()) {
        if (stale.thumbUrl) {
          URL.revokeObjectURL(stale.thumbUrl)
        }
      }
      images.value = list
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`加载扩列图列表失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  /** 卡片可见时懒加载预览图；client 层已串行化，多卡片并发触发不会失步 */
  async function loadThumb (info: DispImgInfo) {
    const c = client.value
    if (!c || info.thumbUrl) {
      return
    }
    try {
      const bytes = await c.fileGet(imgPath(info.name))
      const copy = new Uint8Array(bytes)
      const idx = images.value.findIndex(i => i.name === info.name)
      if (idx < 0 || images.value[idx].thumbUrl) {
        return
      }
      const url = URL.createObjectURL(new Blob([copy], { type: 'image/jpeg' }))
      images.value[idx].thumbUrl = url
      const { width, height } = await readImageSize(url)
      images.value[idx].width = width
      images.value[idx].height = height
    } catch {
      // 预览加载失败不致命
    }
  }

  async function upload (blob: Blob, name: string) {
    const c = client.value
    if (!c) {
      notify('请先连接设备后再上传', 'warning')
      return
    }
    const file = new File([blob], name, { type: 'image/jpeg' })

    transferring.value = true
    transferProgress.value = { fileName: name, bytes: 0, total: file.size, isUpload: true }
    transferLock.begin('上传扩列图', name)
    try {
      await assertStorageCapacity(c, storageOfPath(imgPath(name)), file.size)
      await c.filePut(file, imgPath(name), (sent, total) => {
        transferProgress.value = { fileName: name, bytes: sent, total, isUpload: true }
        transferLock.update(name, sent, total)
      })
      notify('已上传扩列图', 'success')
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

  async function download (info: DispImgInfo) {
    const c = client.value
    if (!c) {
      return
    }
    transferring.value = true
    transferProgress.value = { fileName: info.name, bytes: 0, total: info.sizeBytes, isUpload: false }
    transferLock.begin('下载扩列图', info.name)
    try {
      const bytes = await c.fileGet(imgPath(info.name), (got, total) => {
        transferProgress.value = { fileName: info.name, bytes: got, total, isUpload: false }
        transferLock.update(info.name, got, total)
      })
      const copy = new Uint8Array(bytes)
      triggerBlobDownload(new Blob([copy], { type: 'image/jpeg' }), info.name)
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

  async function remove (info: DispImgInfo) {
    const c = client.value
    if (!c) {
      return
    }
    loading.value = true
    try {
      await c.fileDelete(imgPath(info.name))
      notify('已删除扩列图', 'success')
      await refresh()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      notify(`删除失败: ${msg}`, 'error')
    } finally {
      loading.value = false
    }
  }

  return {
    images,
    loading,
    transferring,
    transferProgress,
    refresh,
    loadThumb,
    upload,
    download,
    remove,
  }
}
