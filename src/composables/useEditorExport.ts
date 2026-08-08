import type { ExportProgress, ExportResult } from '@/editor-core/exporter'
import type { FfmpegHandle } from '@/editor-core/ffmpegClient'
import type { SegmentId, SegmentView } from '@/editor-core/model'
import type { MaterialStorage } from '@/types/material'
import { computed, ref, shallowRef, watch } from 'vue'
import { CLASS_ICON_URLS, LOGO_URLS } from '@/components/editor/overlayPreview'
import { INTRO_FILE, LOOP_FILE } from '@/editor-core/epconfig'
import { exportSegmentMp4 } from '@/editor-core/exporter'
import { loadFfmpeg } from '@/editor-core/ffmpegClient'
import { buildIconPng } from '@/editor-core/icon'
import { introScheduleOk, segmentView, totalFrames } from '@/editor-core/model'
import { buildMaterialFiles } from '@/editor-core/package'
import { OfflineRenderer } from '@/editor-core/renderer'
import { serializeProject } from '@/editor-core/serialize'
import { buildMaterialZip, sanitizeZipFilename, triggerBlobDownload } from '@/utils/zipMaterial'
import { useEditorPlayback } from './useEditorPlayback'
import { useEditorProject } from './useEditorProject'
import { useMaterials } from './useMaterials'
import { useTransferLock } from './useTransferLock'
import { useVideoFrameSource } from './useVideoFrameSource'

export interface MaterialExportResult {
  loop: ExportResult
  /** intro 未启用时为 null */
  intro: ExportResult | null
}

interface SegmentJob {
  id: SegmentId
  outName: string
  view: SegmentView
}

const exporting = ref(false)
const progress = ref<ExportProgress | null>(null)
const result = shallowRef<MaterialExportResult | null>(null)
const exportError = ref('')
/** ffmpeg stderr 滚动缓冲（最近 300 行），导出中/失败时给 UI 展示 */
const ffmpegLog = ref<string[]>([])
const FFMPEG_LOG_MAX = 300
const packaging = ref(false)
// 一次导出对应一个 uuid：下载与上传共用，避免重复上传产生多个素材
const exportUuid = ref('')

// wasm 加载一次复用；出错后重置（exec 失败可能留下脏状态）
let handle: FfmpegHandle | null = null

export function useEditorExport () {
  const { project, projectRevision } = useEditorProject()

  // 工程一旦变动，旧的导出产物/校验结果就不再代表当前内容——立即失效回到待导出态
  watch(projectRevision, () => {
    if (!exporting.value) {
      result.value = null
      exportError.value = ''
      progress.value = null
    }
  })
  const { pause } = useEditorPlayback()
  const provider = useVideoFrameSource()
  const transferLock = useTransferLock()

  /** 所有参与导出的段都通过校验才允许打包 */
  const allOk = computed(() => {
    const r = result.value
    if (!r) {
      return false
    }
    return r.loop.verify.ok && (r.intro === null || r.intro.verify.ok)
  })

  function buildJobs (): SegmentJob[] {
    const proj = project.value
    const jobs: SegmentJob[] = [
      { id: 'loop', outName: LOOP_FILE, view: segmentView(proj, 'loop') },
    ]
    if (proj.introEnabled) {
      jobs.push({ id: 'intro', outName: INTRO_FILE, view: segmentView(proj, 'intro') })
    }
    return jobs
  }

  function validateJobs (jobs: SegmentJob[]) {
    const proj = project.value
    for (const job of jobs) {
      const label = job.id === 'loop' ? '循环段' : '入场段'
      const clipCount = job.view.tracks.reduce((sum, t) => sum + t.clips.length, 0)
      if (clipCount === 0) {
        throw new Error(`${label}没有任何片段，无法导出`)
      }
      if (totalFrames(job.view) <= 0) {
        throw new Error(`${label}时长为 0`)
      }
    }
    // 规约：intro.duration - 2×transition_in - transition_loop 为负会被设备钳到 100ms 并报错
    if (!introScheduleOk(proj)) {
      throw new Error('入场时长必须大于 2×入场过渡 + 循环过渡每步时长（设备端排期约束）')
    }
  }

  async function startExport () {
    if (exporting.value) {
      return
    }
    exporting.value = true
    exportError.value = ''
    result.value = null
    progress.value = null
    exportUuid.value = crypto.randomUUID()
    pause()
    // 锁路由防止导出中途跳页（不盖全屏遮罩，进度在对话框里）
    transferLock.begin('导出素材', '准备编码器…', { overlay: false })
    try {
      const jobs = buildJobs()
      validateJobs(jobs)
      const totalF = jobs.reduce((sum, j) => sum + totalFrames(j.view), 0)
      let doneF = 0
      const done: Partial<Record<SegmentId, ExportResult>> = {}
      ffmpegLog.value = []
      handle ??= await loadFfmpeg('/ffmpeg', message => {
        const log = ffmpegLog.value
        log.push(message)
        if (log.length > FFMPEG_LOG_MAX) {
          log.splice(0, log.length - FFMPEG_LOG_MAX)
        }
      })
      for (const job of jobs) {
        const jobFrames = totalFrames(job.view)
        // 纯 loop 素材 ≤30s：放开 keyint 白捡码率（encode-params loop_asset_option）
        const loopAsset = job.id === 'loop' && job.view.durationUs <= 30_000_000
        done[job.id] = await exportSegmentMp4(job.view, provider, handle, job.outName, p => {
          progress.value = {
            ...p,
            ratio: (doneF + p.ratio * jobFrames) / totalF,
            detail: `[${job.id}] ${p.detail}`,
          }
          transferLock.update(p.detail)
        }, { loopAsset })
        doneF += jobFrames
      }
      result.value = { loop: done.loop!, intro: done.intro ?? null }
    } catch (error_) {
      exportError.value = error_ instanceof Error ? error_.message : String(error_)
      handle?.ffmpeg.terminate()
      handle = null
    } finally {
      transferLock.end()
      exporting.value = false
    }
  }

  function downloadSegmentMp4 (id: SegmentId) {
    const r = id === 'loop' ? result.value?.loop : result.value?.intro
    if (!r) {
      return
    }
    triggerBlobDownload(
      new Blob([r.mp4 as BlobPart], { type: 'video/mp4' }),
      id === 'loop' ? LOOP_FILE : INTRO_FILE,
    )
  }

  async function fetchBytes (url: string): Promise<Uint8Array> {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`预设资源获取失败: ${url}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  /** 720 档预设图按 Android 端行为最近邻放大 2×（用户位图按素材原生基准绘制） */
  async function scalePresetPng (png: Uint8Array, factor: number): Promise<Uint8Array> {
    if (factor === 1) {
      return png
    }
    const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }))
    const out = new OffscreenCanvas(bitmap.width * factor, bitmap.height * factor)
    const ctx = out.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bitmap, 0, 0, out.width, out.height)
    bitmap.close()
    const blob = await out.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await blob.arrayBuffer())
  }

  async function buildZip (): Promise<{ blob: Blob, filename: string }> {
    if (!result.value || !allOk.value) {
      throw new Error('没有通过校验的导出产物')
    }
    const proj = project.value
    const factor = proj.canvas.width >= 720 ? 2 : 1
    const iconPng = await (async () => {
      try {
        // icon 用 loop 首帧：与设备素材列表展示一致
        const renderer = new OfflineRenderer(segmentView(proj, 'loop'), provider)
        return await buildIconPng(await renderer.renderFrameToCanvas(0))
      } catch {
        // icon 生成失败不阻断导出，epconfig 里不写 icon 字段（设备回退默认图标）
        return null
      }
    })()
    const overlay = proj.overlay
    // 自定义图（dataURL）优先于预设；fetch 对 data: URL 同样有效，PNG 全程保 alpha
    const logoSrc = overlay.type === 'arknights'
      ? (overlay.customLogo ?? (overlay.logoPreset ? LOGO_URLS[overlay.logoPreset] : null))
      : null
    const classIconSrc = overlay.type === 'arknights'
      ? (overlay.customClassIcon ?? (overlay.classIcon ? CLASS_ICON_URLS[overlay.classIcon] : null))
      : null
    const logoPng = logoSrc ? await scalePresetPng(await fetchBytes(logoSrc), factor) : null
    const classIconPng = classIconSrc ? await scalePresetPng(await fetchBytes(classIconSrc), factor) : null
    const overlayImagePng = overlay.type === 'image' && overlay.image
      ? await scalePresetPng(await fetchBytes(overlay.image), factor)
      : null
    const files = buildMaterialFiles({
      project: proj,
      uuid: exportUuid.value,
      loopMp4: result.value.loop.mp4,
      introMp4: result.value.intro?.mp4 ?? null,
      iconPng,
      logoPng,
      classIconPng,
      overlayImagePng,
      projectJson: serializeProject(proj),
    })
    const blob = await buildMaterialZip(files)
    return { blob, filename: `${sanitizeZipFilename(proj.name)}.zip` }
  }

  async function downloadZip () {
    packaging.value = true
    try {
      const { blob, filename } = await buildZip()
      triggerBlobDownload(blob, filename)
    } catch (error_) {
      exportError.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      packaging.value = false
    }
  }

  async function uploadToDevice (storage: MaterialStorage) {
    packaging.value = true
    try {
      const { blob, filename } = await buildZip()
      const file = new File([blob], filename, { type: 'application/zip' })
      // uploadZip 自带 epconfig 校验/uuid 去重/传输锁/reload_assets
      await useMaterials().uploadZip(file, storage)
    } catch (error_) {
      exportError.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      packaging.value = false
    }
  }

  return {
    exporting,
    packaging,
    progress,
    result,
    allOk,
    exportError,
    ffmpegLog,
    startExport,
    downloadSegmentMp4,
    downloadZip,
    uploadToDevice,
  }
}
