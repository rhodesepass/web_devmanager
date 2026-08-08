import type { FrameProvider } from '@/editor-core/frameSource'
import { useEditorProject } from './useEditorProject'

const SEEK_TIMEOUT_MS = 3000

function seekTo (video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // 已在目标位置（1ms 容差）就不触发 seeked 了，直接返回
    if (Math.abs(video.currentTime - timeSec) < 0.001) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', onSeeked)
      reject(new Error(`视频 seek 超时 @${timeSec.toFixed(3)}s`))
    }, SEEK_TIMEOUT_MS)
    const onSeeked = () => {
      clearTimeout(timer)
      resolve()
    }
    video.addEventListener('seeked', onSeeked, { once: true })
    video.currentTime = timeSec
  })
}

/**
 * FrameProvider 的 <video> seek 实现（慢但准）。
 * 导出是串行取帧，per-asset 共享单元素即可（crossfade 的重复取帧
 * 由 renderer 的冻结帧缓存消化，不会交替 seek）。
 * 导出前调用方应先 pause 预览播放，避免和播放器抢 currentTime。
 */
export function useVideoFrameSource (): FrameProvider {
  const { getAssetMedia } = useEditorProject()

  return async (_clip, asset, sourceTimeUs) => {
    const media = getAssetMedia(asset.id)
    if (!media) {
      return null
    }
    if (asset.kind === 'image') {
      return media.image ?? null
    }
    const video = media.video
    if (!video) {
      return null
    }
    await seekTo(video, sourceTimeUs / 1_000_000)
    return video
  }
}
