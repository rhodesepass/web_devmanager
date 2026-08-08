import type { AssetMeta } from './model'
import { describe, expect, it } from 'vitest'
import {
  CANVAS_360,
  CANVAS_720,
  createClip,
  createProject,
  frameToUs,
  introScheduleOk,
  segmentDurationUs,
  segmentExportDurationUs,
  segmentView,
  totalFrames,
} from './model'

const videoAsset: AssetMeta = {
  id: 'v1',
  name: 'clip.mp4',
  kind: 'video',
  width: 720,
  height: 1280,
  durationUs: 4_000_000,
  mimeType: 'video/mp4',
  sizeBytes: 1,
}

const imageAsset: AssetMeta = {
  id: 'i1',
  name: 'pic.png',
  kind: 'image',
  width: 100,
  height: 100,
  durationUs: 0,
  mimeType: 'image/png',
  sizeBytes: 1,
}

describe('createProject 默认值', () => {
  it('v3 空素材箱 + 双段空轨', () => {
    const p = createProject()
    expect(p.version).toBe(3)
    expect(p.assets).toEqual([])
    expect(p.segments.loop.tracks).toEqual([])
    expect(p.segments.intro.tracks).toEqual([])
    expect(p.introEnabled).toBe(false)
    // 过渡默认 fade 500ms
    expect(p.transitionLoop).toEqual({ type: 'fade', durationUs: 500_000, backgroundColor: '#000000' })
    expect(p.transitionIn).toEqual({ type: 'fade', durationUs: 500_000, backgroundColor: '#000000' })
    expect(p.fps).toBe(60)
    expect(p.encodePreset).toBe('animation')
  })
})

describe('introScheduleOk', () => {
  it('intro 关闭或无过渡恒 true；有过渡时校验 2×d1+d2', () => {
    const p = createProject()
    p.assets.push(imageAsset)
    const c = createClip(imageAsset, 0, CANVAS_360)
    c.durationUs = 2_000_000
    p.segments.intro.tracks.push({ id: 't1', name: 'A', clips: [c] })

    expect(introScheduleOk(p)).toBe(true)
    p.introEnabled = true
    expect(introScheduleOk(p)).toBe(true)

    // 2×800ms + 500ms = 2.1s > 2s 违规
    p.transitionIn = { type: 'fade', durationUs: 800_000, backgroundColor: '#000000' }
    p.transitionLoop = { type: 'fade', durationUs: 500_000, backgroundColor: '#000000' }
    expect(introScheduleOk(p)).toBe(false)

    // 2×700ms + 500ms = 1.9s < 2s 合规
    p.transitionIn.durationUs = 700_000
    expect(introScheduleOk(p)).toBe(true)
  })
})

describe('createClip 默认值', () => {
  it('视频默认时长 = 源时长，图片 3s；关键帧居中一帧', () => {
    const vc = createClip(videoAsset, 1000, CANVAS_360)
    expect(vc.durationUs).toBe(4_000_000)
    expect(vc.startUs).toBe(1000)
    expect(vc.trimInUs).toBe(0)
    expect(vc.speed).toBe(1)
    expect(vc.keyframes).toHaveLength(1)
    expect(vc.keyframes[0].x).toBe(180)
    expect(vc.transitionIn).toBeNull()

    const ic = createClip(imageAsset, 0, CANVAS_360)
    expect(ic.durationUs).toBe(3_000_000)
  })
})

describe('segmentDurationUs', () => {
  it('空段为 0；多轨取最大结束点；gap 不影响', () => {
    const p = createProject()
    p.assets.push(videoAsset, imageAsset)
    expect(segmentDurationUs(p.segments.loop)).toBe(0)

    const c1 = createClip(videoAsset, 0, CANVAS_360) // 0..4s
    const c2 = createClip(imageAsset, 6_000_000, CANVAS_360) // 6..9s（前面有 gap）
    const c3 = createClip(imageAsset, 0, CANVAS_360) // 0..3s
    p.segments.loop.tracks.push(
      { id: 't1', name: 'A', clips: [c1, c2] },
      { id: 't2', name: 'B', clips: [c3] },
    )
    expect(segmentDurationUs(p.segments.loop)).toBe(9_000_000)
  })
})

describe('segmentView', () => {
  it('携带画布/fps/计算时长/assetById', () => {
    const p = createProject(CANVAS_720)
    p.assets.push(videoAsset)
    p.segments.intro.tracks.push({ id: 't1', name: 'A', clips: [createClip(videoAsset, 0, CANVAS_720)] })
    const view = segmentView(p, 'intro')
    expect(view.canvas).toBe(p.canvas)
    expect(view.fps).toBe(60)
    expect(view.durationUs).toBe(4_000_000)
    expect(view.tracks).toBe(p.segments.intro.tracks)
    expect(view.assetById.get('v1')).toBe(videoAsset)
  })
})

describe('totalFrames / segmentExportDurationUs', () => {
  it('不足整帧舍去；导出时长按帧栅格量化', () => {
    const p = createProject()
    p.assets.push(imageAsset)
    const c = createClip(imageAsset, 0, CANVAS_360)
    c.durationUs = 1_016_666 // 61 帧差 1/3 us
    p.segments.loop.tracks.push({ id: 't1', name: 'A', clips: [c] })
    expect(totalFrames(segmentView(p, 'loop'))).toBe(60)
    expect(segmentExportDurationUs(p, 'loop')).toBe(frameToUs(60))

    c.durationUs = 1_016_667
    expect(totalFrames(segmentView(p, 'loop'))).toBe(61)
  })

  it('整秒时长导出无量化损失', () => {
    const p = createProject()
    p.assets.push(imageAsset)
    const c = createClip(imageAsset, 0, CANVAS_360)
    c.durationUs = 10_000_000
    p.segments.loop.tracks.push({ id: 't1', name: 'A', clips: [c] })
    expect(segmentExportDurationUs(p, 'loop')).toBe(10_000_000)
  })
})
