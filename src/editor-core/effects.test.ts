import { describe, expect, it } from 'vitest'
import { createEffectInstance, EFFECT_TYPES, EFFECTS, effectsToFilter } from './effects'

describe('effectsToFilter', () => {
  it('各类型生成正确的 filter 函数', () => {
    expect(effectsToFilter([{ id: '1', type: 'brightness', params: { amount: 1.5 } }])).toBe('brightness(1.5)')
    expect(effectsToFilter([{ id: '2', type: 'grayscale', params: { amount: 0.8 } }])).toBe('grayscale(0.8)')
    expect(effectsToFilter([{ id: '3', type: 'hueRotate', params: { deg: -90 } }])).toBe('hue-rotate(-90deg)')
    expect(effectsToFilter([{ id: '4', type: 'blur', params: { px: 4 } }])).toBe('blur(4px)')
  })

  it('恒等参数剔除；全恒等返回空串', () => {
    expect(effectsToFilter([
      { id: '1', type: 'brightness', params: { amount: 1 } },
      { id: '2', type: 'blur', params: { px: 0 } },
    ])).toBe('')
  })

  it('多特效按数组顺序拼接', () => {
    const s = effectsToFilter([
      { id: '1', type: 'contrast', params: { amount: 1.2 } },
      { id: '2', type: 'saturate', params: { amount: 0.5 } },
    ])
    expect(s).toBe('contrast(1.2) saturate(0.5)')
  })

  it('blurScale 只作用于 blur', () => {
    const s = effectsToFilter([
      { id: '1', type: 'blur', params: { px: 4 } },
      { id: '2', type: 'brightness', params: { amount: 1.5 } },
    ], 2)
    expect(s).toBe('blur(8px) brightness(1.5)')
  })

  it('缺省参数按 registry default 补齐（brightness 默认恒等被剔除）', () => {
    expect(effectsToFilter([{ id: '1', type: 'brightness', params: {} }])).toBe('')
    expect(effectsToFilter([{ id: '2', type: 'grayscale', params: { amount: Number.NaN } }])).toBe('')
  })
})

describe('createEffectInstance', () => {
  it('每种类型的实例参数取 default 且为恒等', () => {
    for (const type of EFFECT_TYPES) {
      const fx = createEffectInstance(type)
      expect(fx.type).toBe(type)
      expect(EFFECTS[type].isIdentity(fx.params)).toBe(true)
      expect(fx.id).toBeTruthy()
    }
  })
})
