import type { AssetMeta, Project } from './model'
import { describe, expect, it } from 'vitest'
import { CANVAS_360, createClip, createProject } from './model'
import { deserializeProject, serializeProject } from './serialize'

const videoAsset: AssetMeta = {
  id: 'v1',
  name: 'clip.mp4',
  kind: 'video',
  width: 720,
  height: 1280,
  durationUs: 4_000_000,
  mimeType: 'video/mp4',
  sizeBytes: 100,
}

function sampleProject (): Project {
  const p = createProject()
  p.assets.push(videoAsset)
  const c1 = createClip(videoAsset, 0, CANVAS_360)
  c1.effects.push({ id: 'fx1', type: 'blur', params: { px: 4 } })
  const c2 = createClip(videoAsset, c1.durationUs, CANVAS_360)
  c2.transitionIn = { type: 'crossfade', durationUs: 500_000 }
  p.segments.loop.tracks.push({ id: 't1', name: 'A', clips: [c1, c2] })
  p.introEnabled = true
  p.transitionLoop = { type: 'fade', durationUs: 500_000, backgroundColor: '#112233' }
  return p
}

describe('serialize v3 roundtrip', () => {
  it('含 assets/clips/effects/transitionIn 的工程往返一致', () => {
    const p = sampleProject()
    const out = deserializeProject(serializeProject(p))
    expect(out).toEqual(p)
  })

  it('空工程往返一致', () => {
    const p = createProject()
    expect(deserializeProject(serializeProject(p))).toEqual(p)
  })
})

describe('版本门控', () => {
  it('拒绝 v2 与其他版本', () => {
    const p = sampleProject() as unknown as Record<string, unknown>
    for (const v of [1, 2, 4, undefined, '3']) {
      expect(() => deserializeProject(JSON.stringify({ ...p, version: v }))).toThrow(/版本/)
    }
  })

  it('拒绝非法 JSON 与非对象', () => {
    expect(() => deserializeProject('not json')).toThrow(/JSON/)
    expect(() => deserializeProject('42')).toThrow()
  })
})

describe('assets 校验', () => {
  it('缺 assets / id 重复 / kind 非法都拒绝', () => {
    const base = JSON.parse(serializeProject(sampleProject()))
    expect(() => deserializeProject(JSON.stringify({ ...base, assets: undefined }))).toThrow(/assets/)
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      assets: [videoAsset, { ...videoAsset }],
    }))).toThrow(/重复/)
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      assets: [{ ...videoAsset, kind: 'audio' }],
    }))).toThrow(/kind/)
  })
})

describe('clip 校验', () => {
  function mutated (mutate: (p: ReturnType<typeof JSON.parse>) => void): string {
    const raw = JSON.parse(serializeProject(sampleProject()))
    mutate(raw)
    return JSON.stringify(raw)
  }

  it('assetId 悬空拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].assetId = 'ghost'
    }))).toThrow(/不存在的素材/)
  })

  it('区间重叠拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[1].startUs = 1000
    }))).toThrow(/重叠|升序/)
  })

  it('startUs 乱序拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].startUs = 99_000_000
    }))).toThrow(/升序|重叠/)
  })

  it('durationUs<=0 / trimInUs<0 拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].durationUs = 0
    }))).toThrow(/durationUs/)
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].trimInUs = -1
    }))).toThrow(/trimInUs/)
  })

  it('关键帧乱序拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].keyframes = [{ t: 500 }, { t: 0 }]
    }))).toThrow(/关键帧/)
  })

  it('未知特效类型 / 非数值参数拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].effects = [{ id: 'x', type: 'sepia', params: {} }]
    }))).toThrow(/未知特效/)
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[0].effects = [{ id: 'x', type: 'blur', params: { px: 'big' } }]
    }))).toThrow(/特效参数/)
  })

  it('transitionIn 非法拒绝', () => {
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[1].transitionIn = { type: 'wipe', durationUs: 100 }
    }))).toThrow(/transitionIn/)
    expect(() => deserializeProject(mutated(p => {
      p.segments.loop.tracks[0].clips[1].transitionIn = { type: 'crossfade', durationUs: 0 }
    }))).toThrow(/transitionIn/)
  })
})

describe('工程级字段', () => {
  it('canvas 只支持两档', () => {
    const base = JSON.parse(serializeProject(createProject()))
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      canvas: { width: 1080, height: 1920 },
    }))).toThrow(/canvas/)
  })

  it('introEnabled 非布尔拒绝；transitionLoop/transitionIn 非法拒绝', () => {
    const base = JSON.parse(serializeProject(createProject()))
    expect(() => deserializeProject(JSON.stringify({ ...base, introEnabled: 1 }))).toThrow(/introEnabled/)
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      transitionLoop: { type: 'zoom', durationUs: 100 },
    }))).toThrow(/transitionLoop/)
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      transitionIn: { type: 'fade', durationUs: 0 },
    }))).toThrow(/transitionIn/)
  })

  it('旧存档缺 transitionIn/encodePreset/clip.speed/animated 时补默认而非判损坏', () => {
    const base = JSON.parse(serializeProject(sampleProject()))
    delete base.transitionIn
    delete base.encodePreset
    delete base.segments.loop.tracks[0].clips[0].speed
    // animated 缺省按"已有多帧=有动画"推断
    delete base.segments.loop.tracks[0].clips[0].animated
    base.segments.loop.tracks[0].clips[0].keyframes = [
      { t: 0, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, easing: 'linear' },
      { t: 1000, x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, easing: 'linear' },
    ]
    delete base.segments.loop.tracks[0].clips[1].animated
    const out = deserializeProject(JSON.stringify(base))
    expect(out.transitionIn).toBeNull()
    expect(out.encodePreset).toBe('animation')
    expect(out.segments.loop.tracks[0].clips[0].speed).toBe(1)
    expect(out.segments.loop.tracks[0].clips[0].animated).toBe(true)
    expect(out.segments.loop.tracks[0].clips[1].animated).toBe(false)
  })

  it('speed 非正 / fps 非 30|60 / encodePreset 非法拒绝', () => {
    const base = JSON.parse(serializeProject(sampleProject()))
    expect(() => deserializeProject(JSON.stringify({
      ...base,
      segments: {
        ...base.segments,
        loop: {
          tracks: [{
            ...base.segments.loop.tracks[0],
            clips: [{ ...base.segments.loop.tracks[0].clips[0], speed: 0 }],
          }],
        },
      },
    }))).toThrow(/speed/)
    expect(() => deserializeProject(JSON.stringify({ ...base, fps: 24 }))).toThrow(/fps/)
    expect(() => deserializeProject(JSON.stringify({ ...base, encodePreset: 'turbo' }))).toThrow(/encodePreset/)
    // fast 是合法档位
    expect(deserializeProject(JSON.stringify({ ...base, encodePreset: 'fast' })).encodePreset).toBe('fast')
  })

  it('transitionIn 合法值往返一致', () => {
    const p = createProject()
    p.transitionIn = { type: 'swipe', durationUs: 300_000, backgroundColor: '#123456' }
    expect(deserializeProject(serializeProject(p)).transitionIn).toEqual(p.transitionIn)
  })
})
