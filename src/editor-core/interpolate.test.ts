import type { AssetMeta, Clip, ClipTrack, Keyframe } from './model'
import { describe, expect, it } from 'vitest'
import {
  adjacentPrevClip,
  applyEasing,
  clipTimeToSourceTime,
  defaultTransform,
  findActiveClip,
  findKeyframeIndex,
  sampleClip,
  upsertKeyframe,
} from './interpolate'
import { CANVAS_360, createClip } from './model'

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

const imageAsset: AssetMeta = {
  id: 'a1',
  name: 'img.png',
  kind: 'image',
  width: 100,
  height: 100,
  durationUs: 0,
  mimeType: 'image/png',
  sizeBytes: 1,
}

function clip (keyframes: Keyframe[], overrides: Partial<Clip> = {}): Clip {
  return {
    ...createClip(imageAsset, 0, CANVAS_360),
    keyframes,
    ...overrides,
  }
}

function trackOf (clips: Clip[]): ClipTrack {
  return { id: 'tr1', name: '轨道', clips }
}

describe('findKeyframeIndex 二分查找', () => {
  const kfs = [kf(0), kf(1000), kf(5000)]

  it('早于首帧返回 -1', () => {
    expect(findKeyframeIndex(kfs, -1)).toBe(-1)
  })

  it('恰在关键帧上返回该帧', () => {
    expect(findKeyframeIndex(kfs, 0)).toBe(0)
    expect(findKeyframeIndex(kfs, 1000)).toBe(1)
    expect(findKeyframeIndex(kfs, 5000)).toBe(2)
  })

  it('段中间返回左端', () => {
    expect(findKeyframeIndex(kfs, 999)).toBe(0)
    expect(findKeyframeIndex(kfs, 4999)).toBe(1)
  })

  it('晚于末帧返回末帧', () => {
    expect(findKeyframeIndex(kfs, 999_999)).toBe(2)
  })

  it('空数组返回 -1', () => {
    expect(findKeyframeIndex([], 0)).toBe(-1)
  })
})

describe('applyEasing', () => {
  it('四种缓动端点都是 0/1', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(applyEasing(e, 0)).toBeCloseTo(0)
      expect(applyEasing(e, 1)).toBeCloseTo(1)
    }
  })

  it('linear 中点 0.5', () => {
    expect(applyEasing('linear', 0.5)).toBeCloseTo(0.5)
  })

  it('easeIn 前段慢、easeOut 前段快', () => {
    expect(applyEasing('easeIn', 0.5)).toBeLessThan(0.5)
    expect(applyEasing('easeOut', 0.5)).toBeGreaterThan(0.5)
  })

  it('easeInOut 中点 0.5 且对称', () => {
    expect(applyEasing('easeInOut', 0.5)).toBeCloseTo(0.5)
    expect(applyEasing('easeInOut', 0.25) + applyEasing('easeInOut', 0.75)).toBeCloseTo(1)
  })
})

describe('sampleClip', () => {
  it('无关键帧返回 null', () => {
    expect(sampleClip(clip([]), 0)).toBeNull()
  })

  it('首帧前钳制到首帧、末帧后钳制到末帧', () => {
    const c = clip([kf(1000, { x: 10 }), kf(2000, { x: 20 })])
    expect(sampleClip(c, 0)!.x).toBe(10)
    expect(sampleClip(c, 99_999)!.x).toBe(20)
  })

  it('线性插值中点', () => {
    const c = clip([kf(0, { x: 0, opacity: 0 }), kf(1000, { x: 100, opacity: 1 })])
    const s = sampleClip(c, 500)!
    expect(s.x).toBeCloseTo(50)
    expect(s.opacity).toBeCloseTo(0.5)
  })

  it('旋转按连续角度 lerp：350°→370° 中点是 360°，不走最短弧', () => {
    const c = clip([kf(0, { rotation: 350 }), kf(1000, { rotation: 370 })])
    expect(sampleClip(c, 500)!.rotation).toBeCloseTo(360)
  })

  it('0°→720° 转两圈：1/4 处 180°', () => {
    const c = clip([kf(0, { rotation: 0 }), kf(1000, { rotation: 720 })])
    expect(sampleClip(c, 250)!.rotation).toBeCloseTo(180)
  })

  it('段内用左端关键帧的 easing', () => {
    const c = clip([
      kf(0, { x: 0, easing: 'easeIn' }),
      kf(1000, { x: 100, easing: 'linear' }),
    ])
    expect(sampleClip(c, 500)!.x).toBeCloseTo(100 * 0.125)
  })

  it('单关键帧任意时刻都取该帧', () => {
    const c = clip([kf(500, { x: 42, rotation: 30 })])
    expect(sampleClip(c, 0)!.x).toBe(42)
    expect(sampleClip(c, 500)!.rotation).toBe(30)
    expect(sampleClip(c, 9999)!.x).toBe(42)
  })

  it('同 t 重复关键帧不除零', () => {
    const c = clip([kf(1000, { x: 1 }), kf(1000, { x: 2 }), kf(2000, { x: 3 })])
    const s = sampleClip(c, 1000)
    expect(Number.isFinite(s!.x)).toBe(true)
  })
})

describe('defaultTransform', () => {
  it('画布居中恒等', () => {
    const s = defaultTransform(CANVAS_360)
    expect(s.x).toBe(180)
    expect(s.y).toBe(320)
    expect(s.scaleX).toBe(1)
    expect(s.opacity).toBe(1)
  })
})

describe('upsertKeyframe', () => {
  it('新 t 按升序插入', () => {
    const out = upsertKeyframe([kf(0), kf(2000)], kf(1000, { x: 5 }))
    expect(out.map(k => k.t)).toEqual([0, 1000, 2000])
    expect(out[1].x).toBe(5)
  })

  it('同 t 覆盖而不新增', () => {
    const out = upsertKeyframe([kf(0), kf(1000, { x: 1 })], kf(1000, { x: 9 }))
    expect(out).toHaveLength(2)
    expect(out[1].x).toBe(9)
  })

  it('插到最前', () => {
    const out = upsertKeyframe([kf(1000)], kf(0, { x: 7 }))
    expect(out.map(k => k.t)).toEqual([0, 1000])
  })

  it('不修改原数组', () => {
    const orig = [kf(0)]
    upsertKeyframe(orig, kf(500))
    expect(orig).toHaveLength(1)
  })
})

describe('clipTimeToSourceTime', () => {
  const c = clip([], { trimInUs: 1_000_000 })

  it('trim 映射', () => {
    expect(clipTimeToSourceTime(c, 0, 3_000_000)).toBe(1_000_000)
    expect(clipTimeToSourceTime(c, 500_000, 3_000_000)).toBe(1_500_000)
  })

  it('超出源末尾冻结钳制', () => {
    expect(clipTimeToSourceTime(c, 99_000_000, 3_000_000)).toBe(3_000_000)
  })

  it('负 localUs 钳到 trimIn', () => {
    expect(clipTimeToSourceTime(c, -5, 3_000_000)).toBe(1_000_000)
  })

  it('trimIn 超过源长时钳到 trimIn（不产生倒退）', () => {
    expect(clipTimeToSourceTime(clip([], { trimInUs: 5_000_000 }), 0, 3_000_000)).toBe(5_000_000)
  })

  it('speed=2 时源时刻按倍率推进', () => {
    const fast = clip([], { trimInUs: 1_000_000, speed: 2 })
    expect(clipTimeToSourceTime(fast, 500_000, 9_000_000)).toBe(2_000_000)
    expect(clipTimeToSourceTime(fast, 99_000_000, 3_000_000)).toBe(3_000_000)
  })
})

describe('findActiveClip', () => {
  const c1 = clip([], { id: 'c1', startUs: 0, durationUs: 1000 })
  const c2 = clip([], { id: 'c2', startUs: 1000, durationUs: 1000 })
  const c3 = clip([], { id: 'c3', startUs: 5000, durationUs: 1000 })
  const track = trackOf([c1, c2, c3])

  it('区间内命中', () => {
    expect(findActiveClip(track, 0)!.id).toBe('c1')
    expect(findActiveClip(track, 999)!.id).toBe('c1')
    expect(findActiveClip(track, 5500)!.id).toBe('c3')
  })

  it('共享边界右侧 clip 胜出（左闭右开）', () => {
    expect(findActiveClip(track, 1000)!.id).toBe('c2')
  })

  it('gap 内返回 null', () => {
    expect(findActiveClip(track, 3000)).toBeNull()
  })

  it('末尾之后返回 null；空轨返回 null', () => {
    expect(findActiveClip(track, 6000)).toBeNull()
    expect(findActiveClip(trackOf([]), 0)).toBeNull()
  })
})

describe('adjacentPrevClip', () => {
  const c1 = clip([], { id: 'c1', startUs: 0, durationUs: 1000 })
  const c2 = clip([], { id: 'c2', startUs: 1000, durationUs: 1000 })
  const c3 = clip([], { id: 'c3', startUs: 5000, durationUs: 1000 })
  const track = trackOf([c1, c2, c3])

  it('首尾相接返回前邻', () => {
    expect(adjacentPrevClip(track, c2)!.id).toBe('c1')
  })

  it('有 gap 返回 null；首个 clip 返回 null', () => {
    expect(adjacentPrevClip(track, c3)).toBeNull()
    expect(adjacentPrevClip(track, c1)).toBeNull()
  })
})
