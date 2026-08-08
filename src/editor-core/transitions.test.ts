import type { AssetMeta, Clip, ClipTrack } from './model'
import { describe, expect, it } from 'vitest'
import { CANVAS_360, createClip } from './model'
import { collectDipOverlays, crossfadeProgress, dipAlpha } from './transitions'

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

function makeClip (overrides: Partial<Clip>): Clip {
  return { ...createClip(imageAsset, 0, CANVAS_360), ...overrides }
}

describe('dipAlpha', () => {
  it('切点两侧对称三角形，峰值 1', () => {
    expect(dipAlpha(1_000_000, 1_000_000, 400_000)).toBe(1)
    expect(dipAlpha(900_000, 1_000_000, 400_000)).toBeCloseTo(0.5)
    expect(dipAlpha(1_100_000, 1_000_000, 400_000)).toBeCloseTo(0.5)
  })

  it('窗外为 0（含边界）', () => {
    expect(dipAlpha(800_000, 1_000_000, 400_000)).toBe(0)
    expect(dipAlpha(1_200_000, 1_000_000, 400_000)).toBe(0)
    expect(dipAlpha(0, 1_000_000, 400_000)).toBe(0)
  })

  it('段首 cut=0 左半被裁但 t=0 处 alpha=1', () => {
    expect(dipAlpha(0, 0, 400_000)).toBe(1)
    expect(dipAlpha(100_000, 0, 400_000)).toBeCloseTo(0.5)
  })

  it('durationUs 非正返回 0', () => {
    expect(dipAlpha(0, 0, 0)).toBe(0)
  })
})

describe('crossfadeProgress', () => {
  it('[cut, cut+D) 内返回线性进度', () => {
    expect(crossfadeProgress(1_000_000, 1_000_000, 500_000)).toBe(0)
    expect(crossfadeProgress(1_250_000, 1_000_000, 500_000)).toBeCloseTo(0.5)
  })

  it('区间外返回 null（右端开）', () => {
    expect(crossfadeProgress(999_999, 1_000_000, 500_000)).toBeNull()
    expect(crossfadeProgress(1_500_000, 1_000_000, 500_000)).toBeNull()
    expect(crossfadeProgress(0, 1_000_000, 0)).toBeNull()
  })
})

describe('collectDipOverlays', () => {
  function tracksWith (...clips: Clip[]): ClipTrack[] {
    return [{ id: 't1', name: 'A', clips }]
  }

  it('dip 生效时输出色板；crossfade 不参与', () => {
    const c = makeClip({ startUs: 1_000_000, transitionIn: { type: 'dipToBlack', durationUs: 400_000 } })
    const out = collectDipOverlays(tracksWith(c), 1_000_000)
    expect(out).toEqual([{ color: '#000000', alpha: 1 }])

    const cf = makeClip({ startUs: 1_000_000, transitionIn: { type: 'crossfade', durationUs: 400_000 } })
    expect(collectDipOverlays(tracksWith(cf), 1_000_000)).toEqual([])
  })

  it('同色取 max；黑白并存', () => {
    const tracks: ClipTrack[] = [
      { id: 't1', name: 'A', clips: [
        makeClip({ startUs: 1_000_000, transitionIn: { type: 'dipToBlack', durationUs: 400_000 } }),
      ] },
      { id: 't2', name: 'B', clips: [
        makeClip({ startUs: 900_000, transitionIn: { type: 'dipToBlack', durationUs: 400_000 } }),
        makeClip({ startUs: 1_100_000, durationUs: 500_000, transitionIn: { type: 'dipToWhite', durationUs: 400_000 } }),
      ] },
    ]
    const out = collectDipOverlays(tracks, 1_000_000)
    const black = out.find(o => o.color === '#000000')!
    const white = out.find(o => o.color === '#FFFFFF')!
    expect(black.alpha).toBe(1)
    expect(white.alpha).toBeCloseTo(0.5)
  })

  it('窗外无输出', () => {
    const c = makeClip({ startUs: 1_000_000, transitionIn: { type: 'dipToWhite', durationUs: 400_000 } })
    expect(collectDipOverlays(tracksWith(c), 5_000_000)).toEqual([])
  })
})
