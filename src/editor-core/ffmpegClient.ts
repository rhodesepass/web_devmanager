import type { FFmpeg } from '@ffmpeg/ffmpeg'

export type FfmpegCoreKind = 'mt' | 'st'

export interface FfmpegHandle {
  ffmpeg: FFmpeg
  kind: FfmpegCoreKind
}

/**
 * 加载自托管的 ffmpeg core（public/ffmpeg/）。
 * 有 SharedArrayBuffer（跨源隔离）时用多线程 core，否则退单线程。
 * 三个文件都转 blob URL：public/ 下的文件不能被 Vite 当模块 import，
 * blob URL 绕过模块管线，dev/prod 行为一致。
 *
 * @ffmpeg 的 js 库走动态 import：进编辑器不拉编码器，点开始导出才加载。
 */
export async function loadFfmpeg (baseUrl = '/ffmpeg', onLog?: (message: string) => void): Promise<FfmpegHandle> {
  const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'),
    import('@ffmpeg/util'),
  ])
  const kind: FfmpegCoreKind = globalThis.crossOriginIsolated ? 'mt' : 'st'
  const dir = `${baseUrl}/${kind === 'mt' ? 'core-mt' : 'core-st'}`
  const ffmpeg = new FFmpeg()
  // stderr 转 console 与调用方：编码失败时唯一的诊断线索
  ffmpeg.on('log', event => {
    console.log('[ffmpeg]', event.message)
    onLog?.(event.message)
  })
  await ffmpeg.load({
    coreURL: await toBlobURL(`${dir}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${dir}/ffmpeg-core.wasm`, 'application/wasm'),
    ...(kind === 'mt'
      ? { workerURL: await toBlobURL(`${dir}/ffmpeg-core.worker.js`, 'text/javascript') }
      : {}),
  })
  return { ffmpeg, kind }
}
