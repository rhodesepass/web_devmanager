import { describe, expect, it } from 'vitest'
import { profileFor } from '@/editor-core/exporter'
import { buildEncodeArgs, encodeProfiles, loopAssetOption, resolveFilterVf } from './encode-params'

describe('resolveFilterVf', () => {
  it('展开 {W}{H} 占位符', () => {
    const vf = resolveFilterVf('anime', 360, 640)
    expect(vf).toContain('scale=360:640')
    expect(vf).not.toContain('{W}')
  })
})

describe('buildEncodeArgs', () => {
  it('包含档位 crf/x264-params 与公共约束', () => {
    const args = buildEncodeArgs('hq_360')
    const argStr = args.join(' ')
    expect(argStr).toContain('-c:v libx264')
    expect(argStr).toContain('-profile:v high')
    expect(argStr).toContain(`-crf ${encodeProfiles.hq_360.crf}`)
    expect(argStr).toContain(encodeProfiles.hq_360.x264_params)
    expect(argStr).toContain('-pix_fmt yuv420p')
    expect(argStr).toContain('-an')
  })

  it('loopAsset 叠加 keyint 放宽', () => {
    const args = buildEncodeArgs('hq_360', { loopAsset: true })
    const x264 = args[args.indexOf('-x264-params') + 1]
    expect(x264.endsWith(loopAssetOption.x264_params_delta)).toBe(true)
  })

  it('fps override 落到 -r；缺省 60', () => {
    expect(buildEncodeArgs('hq_720', { fps: 30 })).toContain('30')
    const args = buildEncodeArgs('hq_720')
    expect(args[args.indexOf('-r') + 1]).toBe('60')
  })
})

describe('profileFor 映射', () => {
  const c360 = { width: 360, height: 640 } as const
  const c720 = { width: 720, height: 1280 } as const

  it('预设 × 画布 → 六档全覆盖', () => {
    expect(profileFor({ canvas: c360, encodePreset: 'animation' })).toBe('hq_360')
    expect(profileFor({ canvas: c720, encodePreset: 'animation' })).toBe('hq_720')
    expect(profileFor({ canvas: c360, encodePreset: 'realistic' })).toBe('hq_video_360')
    expect(profileFor({ canvas: c720, encodePreset: 'realistic' })).toBe('hq_video_720')
    expect(profileFor({ canvas: c360, encodePreset: 'fast' })).toBe('fast_360')
    expect(profileFor({ canvas: c720, encodePreset: 'fast' })).toBe('fast_720')
  })
})
