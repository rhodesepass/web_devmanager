import type { FfmpegHandle } from './ffmpegClient'
import type { FrameProvider } from './frameSource'
import type { SegmentView } from './model'
import type { Mp4VerifyResult } from './mp4Verify'
// eslint-disable-next-line no-restricted-imports -- encode-params 是纯数据调校档案（无 vue/DOM），守护例外
import type { ProfileId } from '@/config/encode-params'
import type { FFFSType } from '@ffmpeg/ffmpeg'
// eslint-disable-next-line no-restricted-imports -- 同上
import { buildEncodeArgs, encodeProfiles } from '@/config/encode-params'
import { totalFrames } from './model'
import { normalizeCfrStts, verifyMp4 } from './mp4Verify'
import { OfflineRenderer } from './renderer'
import { buildY4mHeader, FRAME_MARKER, rgbaToI420 } from './y4m'

// 字符串枚举值直接内联，避免为一个常量静态引入整个 @ffmpeg/ffmpeg（懒加载会失效）
const WORKERFS = 'WORKERFS' as FFFSType

/** 压制预设 × 画布档位 → encode-params.ts 的调校档案 */
export function profileFor (view: Pick<SegmentView, 'canvas' | 'encodePreset'>): ProfileId {
  const hi = view.canvas.width >= 720
  switch (view.encodePreset) {
    case 'realistic': {
      return hi ? 'hq_video_720' : 'hq_video_360'
    }
    case 'fast': {
      return hi ? 'fast_720' : 'fast_360'
    }
    default: {
      return hi ? 'hq_720' : 'hq_360'
    }
  }
}

export function profileLabelFor (view: Pick<SegmentView, 'canvas' | 'encodePreset'>): string {
  return encodeProfiles[profileFor(view)].label
}

/**
 * 段长必须 ≤ 各档 keyint(300，loopAsset 600)：每段独立编码首帧必 IDR、
 * closed GOP 段间无引用，concat copy 才合法
 */
function segmentFrames (view: SegmentView): number {
  return view.canvas.width >= 720 ? 125 : 250
}

export interface ExportSegmentOptions {
  /** 纯 loop 素材（时长 ≤30s）放开 keyint 白捡码率（encode-params loop_asset_option） */
  loopAsset?: boolean
}

export interface ExportProgress {
  phase: 'render' | 'encode' | 'concat' | 'verify'
  /** 0..1 总进度 */
  ratio: number
  detail: string
}

export interface ExportResult {
  mp4: Uint8Array
  verify: Mp4VerifyResult
}

const MOUNT_POINT = '/segin'

/**
 * 导出单个段（loop.mp4 / intro.mp4，编码约束同一套）：分段渲染 y4m →
 * WORKERFS 挂载 → libx264 固定命令编码 → concat copy 合并 + faststart →
 * box 级合规校验。渲染帧不落大数组：每段的 I420 chunk 攒进 Blob
 * （浏览器托管，不进 wasm 堆）。
 */
export async function exportSegmentMp4 (
  view: SegmentView,
  provider: FrameProvider,
  handle: FfmpegHandle,
  outName: string,
  onProgress?: (p: ExportProgress) => void,
  options: ExportSegmentOptions = {},
): Promise<ExportResult> {
  const { ffmpeg } = handle
  const encodeArgs = buildEncodeArgs(profileFor(view), {
    loopAsset: options.loopAsset,
    fps: view.fps,
    // wasm 线程池定长，必须钳 x264 线程（见 BuildEncodeArgsOptions.threads 注释）；
    // 单线程 core 传 1（threads>1 在 st 上无效但无害，统一钳制最稳）
    threads: handle.kind === 'mt' ? 4 : 1,
  })
  const frames = totalFrames(view)
  if (frames <= 0) {
    throw new Error('段时长为 0')
  }
  const segLen = segmentFrames(view)
  const segCount = Math.ceil(frames / segLen)
  const renderer = new OfflineRenderer(view, provider)
  const header = buildY4mHeader(view.canvas.width, view.canvas.height, view.fps)
  // 渲染+编码约占总进度 90%，其中渲染 70% 编码 20%
  const report = (phase: ExportProgress['phase'], ratio: number, detail: string) =>
    onProgress?.({ phase, ratio: Math.min(1, ratio), detail })

  const segNames: string[] = []
  try {
    await ffmpeg.createDir(MOUNT_POINT)
    for (let seg = 0; seg < segCount; seg++) {
      const first = seg * segLen
      const count = Math.min(segLen, frames - first)
      const chunks: Uint8Array[] = [header]
      for (let i = 0; i < count; i++) {
        const imageData = await renderer.renderFrame(first + i)
        const i420 = rgbaToI420(imageData.data, imageData.width, imageData.height)
        chunks.push(FRAME_MARKER, i420)
        const done = first + i + 1
        report('render', (done / frames) * 0.7 + (seg / segCount) * 0.2, `渲染帧 ${done}/${frames}`)
        if (i % 8 === 7) {
          // 让出主线程，避免 UI 冻结（高分辨率源逐帧 seek 时每帧耗时长，让出要更频繁）
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      // TS 5.9 下 Uint8Array<ArrayBufferLike> 不满足 BlobPart，这里的 buffer 都是普通 ArrayBuffer
      const blob = new Blob(chunks as BlobPart[])
      const segName = `seg${String(seg).padStart(3, '0')}.mp4`
      report('encode', ((first + count) / frames) * 0.7 + ((seg + 0.5) / segCount) * 0.2, `编码分段 ${seg + 1}/${segCount}`)
      await ffmpeg.mount(WORKERFS, { blobs: [{ name: 'seg.y4m', data: blob }] }, MOUNT_POINT)
      const code = await ffmpeg.exec(['-hide_banner', '-i', `${MOUNT_POINT}/seg.y4m`, ...encodeArgs, segName])
      await ffmpeg.unmount(MOUNT_POINT)
      if (code !== 0) {
        throw new Error(`分段 ${seg + 1}/${segCount} 编码失败（ffmpeg 退出码 ${code}）`)
      }
      segNames.push(segName)
    }

    report('concat', 0.92, '合并分段')
    const listText = segNames.map(n => `file '${n}'`).join('\n')
    await ffmpeg.writeFile('list.txt', listText)
    const code = await ffmpeg.exec([
      '-hide_banner',
      '-f', 'concat',
      '-safe', '0',
      '-i', 'list.txt',
      '-c', 'copy',
      '-movflags', '+faststart',
      outName,
    ])
    if (code !== 0) {
      throw new Error(`分段合并失败（ffmpeg 退出码 ${code}）`)
    }

    const data = await ffmpeg.readFile(outName)
    if (typeof data === 'string') {
      throw new TypeError('readFile 返回了文本')
    }

    report('verify', 0.97, '校验产物')
    const mp4 = new Uint8Array(data)
    normalizeCfrStts(mp4)
    const verify = verifyMp4(mp4)
    report('verify', 1, '完成')
    return { mp4, verify }
  } finally {
    renderer.dispose()
    // 尽力清理 wasm FS，失败不影响结果
    await Promise.allSettled([
      ...segNames.map(n => ffmpeg.deleteFile(n)),
      ffmpeg.deleteFile('list.txt'),
      ffmpeg.deleteFile(outName),
      ffmpeg.deleteDir(MOUNT_POINT),
    ])
  }
}
