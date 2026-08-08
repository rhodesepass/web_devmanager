import type { AssetMeta } from './model'
import { describe, expect, it } from 'vitest'
import { buildEpconfig } from './epconfig'
import { CANVAS_360, createArknightsOverlay, createClip, createProject } from './model'

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

function addIntroClip (p: ReturnType<typeof createProject>, durationUs: number): void {
  p.assets.push(imageAsset)
  const c = createClip(imageAsset, 0, CANVAS_360)
  c.durationUs = durationUs
  p.segments.intro.tracks.push({ id: 't1', name: 'A', clips: [c] })
}

describe('buildEpconfig', () => {
  it('overlay=none 的最小配置（transition_in 默认 fade 500ms）', () => {
    const p = createProject()
    p.name = '测试'
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u-1', hasIcon: true }))
    expect(config).toEqual({
      version: 2,
      uuid: 'u-1',
      name: '测试',
      description: '(无描述)',
      screen: '360x640',
      icon: 'icon.png',
      loop: { file: 'loop.mp4' },
      transition_in: { type: 'fade', options: { duration: 500_000, background_color: '#000000' } },
      overlay: { type: 'none' },
    })
  })

  it('arknights overlay 字段与 Kotlin 导出对齐', () => {
    const p = createProject({ width: 720, height: 1280 })
    p.overlay = {
      ...createArknightsOverlay(),
      appearTimeUs: 250_000,
      operatorName: 'EXUSIAI',
      color: '#ff0000',
      logoPreset: 'arknights',
      classIcon: 'specialist',
      topLeftRhodes: '',
      topRightBarText: 'LT77 GATE',
    }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u-2', hasIcon: false }))
    expect(config.screen).toBe('720x1280')
    expect(config.icon).toBeUndefined()
    expect(config.overlay.type).toBe('arknights')
    expect(config.overlay.options).toEqual({
      appear_time: 250_000,
      operator_name: 'EXUSIAI',
      operator_code: 'ARKNIGHT - UNK0',
      barcode_text: 'OPERATOR - ARKNIGHTS',
      aux_text: 'Operator of Rhodes Island\nUndefined/Rhodes Island\n Hypergryph',
      staff_text: 'STAFF',
      color: '#FF0000',
      logo: 'overlay_logo.png',
      operator_class_icon: 'overlay_op_icon.png',
      top_right_bar_text: 'LT77 GATE',
    })
    // 空的 top_left_rhodes 不写入
    expect(config.overlay.options.top_left_rhodes).toBeUndefined()
  })

  it('非法颜色回退黑色、无预设图不写路径字段', () => {
    const p = createProject()
    p.overlay = {
      ...createArknightsOverlay(),
      color: 'oops',
      logoPreset: null,
      classIcon: null,
      customLogo: null,
      customClassIcon: null,
    }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.overlay.options.color).toBe('#000000')
    expect(config.overlay.options.logo).toBeUndefined()
    expect(config.overlay.options.operator_class_icon).toBeUndefined()
  })

  it('image overlay 写 appear_time/duration，有图才写 image 路径', () => {
    const p = createProject()
    p.overlay = { type: 'image', appearTimeUs: 200_000, durationUs: 800_000, image: 'data:image/png;base64,CCCC' }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.overlay).toEqual({
      type: 'image',
      options: { appear_time: 200_000, duration: 800_000, image: 'overlay.png' },
    })

    p.overlay = { type: 'image', appearTimeUs: 200_000, durationUs: 800_000, image: null }
    const config2 = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config2.overlay.options.image).toBeUndefined()
  })

  it('自定义 logo/职业图标（dataURL）也写图片路径字段', () => {
    const p = createProject()
    p.overlay = {
      ...createArknightsOverlay(),
      logoPreset: null,
      classIcon: null,
      customLogo: 'data:image/png;base64,AAAA',
      customClassIcon: 'data:image/png;base64,BBBB',
    }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.overlay.options.logo).toBe('overlay_logo.png')
    expect(config.overlay.options.operator_class_icon).toBe('overlay_op_icon.png')
  })

  it('严格 JSON 可解析且 version=2', () => {
    const text = buildEpconfig(createProject(), { uuid: 'x', hasIcon: false })
    expect(JSON.parse(text).version).toBe(2)
  })
})

describe('buildEpconfig intro/transition_loop', () => {
  it('introEnabled=true 时写 intro 三字段（duration = 内容推导的量化值）', () => {
    const p = createProject()
    p.introEnabled = true
    p.transitionLoop = null
    addIntroClip(p, 4_000_000)
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.intro).toEqual({ enabled: true, file: 'intro.mp4', duration: 4_000_000 })
    expect(config.transition_loop).toBeUndefined()
  })

  it('intro duration 按帧栅格量化（不足整帧舍去）', () => {
    const p = createProject()
    p.introEnabled = true
    addIntroClip(p, 1_016_666) // 60 整帧 + 差 1/3 us 的一帧
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.intro.duration).toBe(1_000_000)
  })

  it('transitionLoop 非空时写 transition_loop（颜色归一大写）', () => {
    const p = createProject()
    p.introEnabled = true
    p.transitionLoop = { type: 'fade', durationUs: 500_000, backgroundColor: '#a0b1c2' }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.transition_loop).toEqual({
      type: 'fade',
      options: { duration: 500_000, background_color: '#A0B1C2' },
    })
  })

  it('transitionIn 非空时写完整 transition_in（颜色归一大写），与 intro 开关无关', () => {
    const p = createProject()
    p.transitionIn = { type: 'move', durationUs: 400_000, backgroundColor: '#abcdef' }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.transition_in).toEqual({
      type: 'move',
      options: { duration: 400_000, background_color: '#ABCDEF' },
    })
  })

  it('transitionIn 为 null 时 transition_in 写 type none', () => {
    const p = createProject()
    p.transitionIn = null
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.transition_in).toEqual({ type: 'none' })
  })

  it('intro 关闭时 intro/transition_loop 均不写', () => {
    const p = createProject()
    p.introEnabled = false
    p.transitionLoop = { type: 'swipe', durationUs: 300_000, backgroundColor: '#000000' }
    const config = JSON.parse(buildEpconfig(p, { uuid: 'u', hasIcon: false }))
    expect(config.intro).toBeUndefined()
    expect(config.transition_loop).toBeUndefined()
  })
})
