import type { AssetMeta, Clip, ClipTrack, Keyframe } from './model'
import { describe, expect, it } from 'vitest'
import {
  appendPositionUs,
  canPlaceClip,
  insertClipSorted,
  resizeClipLeft,
  resizeClipRight,
  splitClip,
  stretchClip,
} from './clipOps'
import { CANVAS_360, createClip } from './model'

const videoAsset: AssetMeta = {
  id: 'v1',
  name: 'clip.mp4',
  kind: 'video',
  width: 720,
  height: 1280,
  durationUs: 10_000_000,
  mimeType: 'video/mp4',
  sizeBytes: 1,
}

function kf (t: number, overrides: Partial<Keyframe> = {}): Keyframe {
  return {
    t,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    easing: 'linear',
    ...overrides,
  }
}

function makeClip (overrides: Partial<Clip> = {}): Clip {
  return { ...createClip(videoAsset, 0, CANVAS_360), ...overrides }
}

function trackOf (clips: Clip[]): ClipTrack {
  return { id: 'tr1', name: '轨道', clips }
}

describe('splitClip', () => {
  it('切点越界返回 null', () => {
    const c = makeClip({ durationUs: 1_000_000 })
    expect(splitClip(c, 0, CANVAS_360)).toBeNull()
    expect(splitClip(c, 1_000_000, CANVAS_360)).toBeNull()
    expect(splitClip(c, -5, CANVAS_360)).toBeNull()
  })

  it('时长/位置/trimIn 分配正确，左半保 id，右半新 id 且 transitionIn=null', () => {
    const c = makeClip({
      startUs: 2_000_000,
      durationUs: 4_000_000,
      trimInUs: 500_000,
      transitionIn: { type: 'dipToBlack', durationUs: 400_000 },
    })
    const [left, right] = splitClip(c, 1_000_000, CANVAS_360)!
    expect(left.id).toBe(c.id)
    expect(left.startUs).toBe(2_000_000)
    expect(left.durationUs).toBe(1_000_000)
    expect(left.trimInUs).toBe(500_000)
    expect(left.transitionIn).toEqual(c.transitionIn)

    expect(right.id).not.toBe(c.id)
    expect(right.startUs).toBe(3_000_000)
    expect(right.durationUs).toBe(3_000_000)
    expect(right.trimInUs).toBe(1_500_000)
    expect(right.transitionIn).toBeNull()
    expect(right.assetId).toBe(c.assetId)
  })

  it('切点两侧各落采样帧，两半动画连续；右半关键帧重基', () => {
    const c = makeClip({
      durationUs: 2_000_000,
      animated: true,
      keyframes: [kf(0, { x: 0 }), kf(2_000_000, { x: 200 })],
    })
    const [left, right] = splitClip(c, 1_000_000, CANVAS_360)!
    // 左半末帧 = 切点采样值（x=100）
    expect(left.keyframes.at(-1)!.t).toBe(1_000_000)
    expect(left.keyframes.at(-1)!.x).toBeCloseTo(100)
    // 右半首帧 t=0 同值，末帧重基到 1s
    expect(right.keyframes[0].t).toBe(0)
    expect(right.keyframes[0].x).toBeCloseTo(100)
    expect(right.keyframes.at(-1)!.t).toBe(1_000_000)
    expect(right.keyframes.at(-1)!.x).toBe(200)
  })

  it('采样帧沿用被跨越区间左端的 easing；effects 深拷贝参数独立', () => {
    const c = makeClip({
      durationUs: 2_000_000,
      animated: true,
      keyframes: [kf(0, { easing: 'easeIn' }), kf(2_000_000)],
      effects: [{ id: 'fx1', type: 'blur', params: { px: 4 } }],
    })
    const [left, right] = splitClip(c, 500_000, CANVAS_360)!
    expect(left.keyframes.at(-1)!.easing).toBe('easeIn')
    expect(right.keyframes[0].easing).toBe('easeIn')
    right.effects[0].params.px = 9
    expect(left.effects[0].params.px).toBe(4)
  })

  it('无关键帧的动画 clip 切割后两半各有一个默认采样帧', () => {
    const c = makeClip({ durationUs: 2_000_000, animated: true, keyframes: [] })
    const [left, right] = splitClip(c, 1_000_000, CANVAS_360)!
    expect(left.keyframes).toHaveLength(1)
    expect(left.keyframes[0].x).toBe(180)
    expect(right.keyframes[0].t).toBe(0)
  })

  it('静态 clip（秒表未开）切割后两半各保留一份静态值帧，不引入采样帧', () => {
    const c = makeClip({
      durationUs: 2_000_000,
      keyframes: [kf(0, { x: 42, rotation: 30 })],
    })
    const [left, right] = splitClip(c, 1_000_000, CANVAS_360)!
    expect(left.animated).toBe(false)
    expect(left.keyframes).toEqual([kf(0, { x: 42, rotation: 30 })])
    expect(right.keyframes).toEqual([kf(0, { x: 42, rotation: 30 })])
  })
})

describe('canPlaceClip', () => {
  const track = trackOf([
    makeClip({ id: 'c1', startUs: 0, durationUs: 1000 }),
    makeClip({ id: 'c2', startUs: 2000, durationUs: 1000 }),
  ])

  it('空隙内可放，重叠不可放', () => {
    expect(canPlaceClip(track, 1000, 1000)).toBe(true)
    expect(canPlaceClip(track, 500, 1000)).toBe(false)
    expect(canPlaceClip(track, 2500, 100)).toBe(false)
  })

  it('共享边界合法（左闭右开）', () => {
    expect(canPlaceClip(track, 3000, 1000)).toBe(true)
  })

  it('ignoreClipId 忽略自身', () => {
    expect(canPlaceClip(track, 100, 1000, 'c1')).toBe(true)
  })

  it('负起点/非正时长非法', () => {
    expect(canPlaceClip(track, -1, 1000)).toBe(false)
    expect(canPlaceClip(track, 5000, 0)).toBe(false)
  })
})

describe('appendPositionUs / insertClipSorted', () => {
  it('追加落点 = 轨尾；空轨 0', () => {
    const track = trackOf([makeClip({ startUs: 0, durationUs: 1000 }), makeClip({ startUs: 5000, durationUs: 500 })])
    expect(appendPositionUs(track)).toBe(5500)
    expect(appendPositionUs(trackOf([]))).toBe(0)
  })

  it('按 startUs 升序插入且不改原数组', () => {
    const clips = [makeClip({ startUs: 0, durationUs: 100 }), makeClip({ startUs: 2000, durationUs: 100 })]
    const out = insertClipSorted(clips, makeClip({ id: 'new', startUs: 1000, durationUs: 100 }))
    expect(out.map(c => c.startUs)).toEqual([0, 1000, 2000])
    expect(clips).toHaveLength(2)
  })
})

describe('resizeClipLeft', () => {
  it('视频左移余量受 trimIn 钳制；三联动', () => {
    const c = makeClip({ startUs: 2_000_000, durationUs: 3_000_000, trimInUs: 500_000 })
    const out = resizeClipLeft(c, 0, true)
    // 最多左移 500ms（trimIn 耗尽）
    expect(out.startUs).toBe(1_500_000)
    expect(out.trimInUs).toBe(0)
    expect(out.durationUs).toBe(3_500_000)
  })

  it('右缩：trimIn 增加、关键帧重基钳 0', () => {
    const c = makeClip({
      startUs: 1_000_000,
      durationUs: 3_000_000,
      trimInUs: 0,
      keyframes: [kf(0, { x: 1 }), kf(500_000, { x: 2 }), kf(2_000_000, { x: 3 })],
    })
    const out = resizeClipLeft(c, 2_000_000, true)
    expect(out.startUs).toBe(2_000_000)
    expect(out.trimInUs).toBe(1_000_000)
    expect(out.durationUs).toBe(2_000_000)
    // 前两帧重基后堆到 t=0，保留时间上靠后的那帧
    expect(out.keyframes.map(k => k.t)).toEqual([0, 1_000_000])
    expect(out.keyframes[0].x).toBe(2)
  })

  it('图片自由左移且 trimIn 恒 0', () => {
    const c = makeClip({ startUs: 2_000_000, durationUs: 1_000_000, trimInUs: 0 })
    const out = resizeClipLeft(c, 500_000, false)
    expect(out.startUs).toBe(500_000)
    expect(out.trimInUs).toBe(0)
    expect(out.durationUs).toBe(2_500_000)
  })

  it('不能缩过最小时长', () => {
    const c = makeClip({ startUs: 0, durationUs: 1_000_000 })
    const out = resizeClipLeft(c, 999_999_999, false)
    expect(out.durationUs).toBe(100_000)
  })
})

describe('speed 语义', () => {
  it('splitClip 在 speed=2 下右半 trimIn 按源消耗量偏移', () => {
    const c = makeClip({ startUs: 0, durationUs: 2_000_000, trimInUs: 100_000, speed: 2 })
    const [left, right] = splitClip(c, 1_000_000, CANVAS_360)!
    expect(left.speed).toBe(2)
    expect(right.speed).toBe(2)
    // 消耗源 1s×2 = 2s
    expect(right.trimInUs).toBe(2_100_000)
  })

  it('resizeClipLeft 在 speed=2 下左扩余量减半、trimIn 按 ×speed 变化', () => {
    const c = makeClip({ startUs: 1_000_000, durationUs: 2_000_000, trimInUs: 400_000, speed: 2 })
    // 左移余量 = trimIn/speed = 200ms
    const out = resizeClipLeft(c, 0, true)
    expect(out.startUs).toBe(800_000)
    expect(out.trimInUs).toBe(0)
  })
})

describe('stretchClip', () => {
  it('右缘拉长 → 速率变慢，源消耗量不变', () => {
    const c = makeClip({ startUs: 1_000_000, durationUs: 2_000_000, trimInUs: 300, speed: 1 })
    const out = stretchClip(c, 'right', 5_000_000)
    expect(out.durationUs).toBe(4_000_000)
    expect(out.speed).toBeCloseTo(0.5)
    expect(out.trimInUs).toBe(300)
    expect(out.durationUs * out.speed).toBeCloseTo(2_000_000)
  })

  it('右缘缩短 → 快放', () => {
    const c = makeClip({ startUs: 0, durationUs: 4_000_000, speed: 1 })
    const out = stretchClip(c, 'right', 2_000_000)
    expect(out.speed).toBeCloseTo(2)
  })

  it('左缘拉伸锚定右缘', () => {
    const c = makeClip({ startUs: 2_000_000, durationUs: 2_000_000, speed: 1 })
    const out = stretchClip(c, 'left', 1_000_000)
    expect(out.startUs).toBe(1_000_000)
    expect(out.durationUs).toBe(3_000_000)
    expect(out.speed).toBeCloseTo(2 / 3)
  })

  it('不低于最小时长', () => {
    const c = makeClip({ startUs: 0, durationUs: 1_000_000, speed: 1 })
    const out = stretchClip(c, 'right', 1)
    expect(out.durationUs).toBe(100_000)
    expect(out.speed).toBeCloseTo(10)
  })
})

describe('resizeClipRight', () => {
  it('只改 durationUs，下限 MIN_CLIP_US', () => {
    const c = makeClip({ startUs: 1_000_000, durationUs: 2_000_000, trimInUs: 300 })
    const out = resizeClipRight(c, 5_000_000)
    expect(out.durationUs).toBe(4_000_000)
    expect(out.startUs).toBe(1_000_000)
    expect(out.trimInUs).toBe(300)
    expect(resizeClipRight(c, 1_000_001).durationUs).toBe(100_000)
  })
})
