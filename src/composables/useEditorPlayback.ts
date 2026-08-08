import { ref } from 'vue'
import { clipTimeToSourceTime, findActiveClip } from '@/editor-core/interpolate'
import { useEditorProject } from './useEditorProject'

const playheadUs = ref(0)
const playing = ref(false)

let rafId = 0
let lastTs = 0

/** 视频与播放头偏差超过该值才纠偏 seek，避免每帧 seek 卡死 */
const DRIFT_TOLERANCE_US = 80_000
/** 将激活的 clip 提前这么久预 seek 到入点，消除切点黑闪 */
const PRESEEK_AHEAD_US = 300_000

export function useEditorPlayback () {
  const { activeSegment, activeSegmentDurationUs, getAsset, getClipVideo, peekClipVideo } = useEditorProject()

  /** 活跃视频 clip 对齐播放头；非活跃 clip 的元素暂停；临近入点的预 seek */
  function syncVideos (force = false) {
    const tUs = playheadUs.value
    for (const track of activeSegment.value.tracks) {
      const active = findActiveClip(track, tUs)
      for (const clip of track.clips) {
        const asset = getAsset(clip.assetId)
        if (asset?.kind !== 'video') {
          continue
        }
        if (clip === active) {
          const video = getClipVideo(clip.id)
          if (!video) {
            continue
          }
          if (video.playbackRate !== clip.speed) {
            video.playbackRate = clip.speed
          }
          const targetUs = clipTimeToSourceTime(clip, tUs - clip.startUs, asset.durationUs)
          const currentUs = video.currentTime * 1_000_000
          if (force || Math.abs(currentUs - targetUs) > DRIFT_TOLERANCE_US) {
            video.currentTime = targetUs / 1_000_000
          }
          if (playing.value && video.paused) {
            video.play().catch(() => {})
          }
          continue
        }
        const ahead = clip.startUs - tUs
        if (playing.value && ahead > 0 && ahead <= PRESEEK_AHEAD_US) {
          const video = getClipVideo(clip.id)
          if (video && Math.abs(video.currentTime * 1_000_000 - clip.trimInUs) > DRIFT_TOLERANCE_US) {
            video.currentTime = clip.trimInUs / 1_000_000
          }
          continue
        }
        const existing = peekClipVideo(clip.id)
        if (existing && !existing.paused) {
          existing.pause()
        }
      }
    }
  }

  function tick (ts: number) {
    if (!playing.value) {
      return
    }
    const dt = lastTs ? (ts - lastTs) * 1000 : 0
    lastTs = ts
    let t = playheadUs.value + dt
    const durationUs = activeSegmentDurationUs.value
    if (t >= durationUs) {
      t = 0
    }
    playheadUs.value = t
    syncVideos()
    rafId = requestAnimationFrame(tick)
  }

  function play () {
    if (playing.value || activeSegmentDurationUs.value <= 0) {
      return
    }
    playing.value = true
    lastTs = 0
    syncVideos(true)
    rafId = requestAnimationFrame(tick)
  }

  function pause () {
    playing.value = false
    cancelAnimationFrame(rafId)
    for (const track of activeSegment.value.tracks) {
      for (const clip of track.clips) {
        peekClipVideo(clip.id)?.pause()
      }
    }
    syncVideos(true)
  }

  function toggle () {
    if (playing.value) {
      pause()
    } else {
      play()
    }
  }

  /** 拖播放头/点时间轴：暂停态精确 seek */
  function seek (tUs: number) {
    const clamped = Math.min(Math.max(tUs, 0), activeSegmentDurationUs.value)
    playheadUs.value = clamped
    syncVideos(true)
  }

  return { playheadUs, playing, play, pause, toggle, seek }
}
