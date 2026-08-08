/**
 * 特效 registry：clip 级静态参数特效，渲染统一走 canvas2d ctx.filter（CSS filter 语法），
 * 预览（Konva sceneFunc）与导出（OfflineRenderer）共用 effectsToFilter 这一份真源保证一致。
 *
 * blur 特别处理：canvas filter 坐标不受 CTM 影响（px 是"当前画布像素"），
 * 预览 stage 有缩放 + pixelRatio，必须乘 blurScale 才与导出观感一致；导出侧传 1。
 */

import type { EffectInstance, EffectType } from './model'
import { newId } from './model'

export interface EffectParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit: '' | 'px' | 'deg' | '%'
}

export interface EffectDef {
  type: EffectType
  label: string
  params: EffectParamDef[]
  toFilter: (params: Record<string, number>, blurScale: number) => string
  /** 恒等参数（无视觉效果）时跳过，不进 filter 串省栅格化开销 */
  isIdentity: (params: Record<string, number>) => boolean
}

export const EFFECTS: Record<EffectType, EffectDef> = {
  brightness: {
    type: 'brightness',
    label: '亮度',
    params: [{ key: 'amount', label: '强度', min: 0, max: 2, step: 0.01, default: 1, unit: '' }],
    toFilter: p => `brightness(${p.amount})`,
    isIdentity: p => p.amount === 1,
  },
  contrast: {
    type: 'contrast',
    label: '对比度',
    params: [{ key: 'amount', label: '强度', min: 0, max: 2, step: 0.01, default: 1, unit: '' }],
    toFilter: p => `contrast(${p.amount})`,
    isIdentity: p => p.amount === 1,
  },
  saturate: {
    type: 'saturate',
    label: '饱和度',
    params: [{ key: 'amount', label: '强度', min: 0, max: 3, step: 0.01, default: 1, unit: '' }],
    toFilter: p => `saturate(${p.amount})`,
    isIdentity: p => p.amount === 1,
  },
  grayscale: {
    type: 'grayscale',
    label: '灰度',
    params: [{ key: 'amount', label: '强度', min: 0, max: 1, step: 0.01, default: 0, unit: '' }],
    toFilter: p => `grayscale(${p.amount})`,
    isIdentity: p => p.amount === 0,
  },
  blur: {
    type: 'blur',
    label: '模糊',
    params: [{ key: 'px', label: '半径', min: 0, max: 40, step: 0.5, default: 0, unit: 'px' }],
    toFilter: (p, blurScale) => `blur(${p.px * blurScale}px)`,
    isIdentity: p => p.px === 0,
  },
  hueRotate: {
    type: 'hueRotate',
    label: '色相偏移',
    params: [{ key: 'deg', label: '角度', min: -180, max: 180, step: 1, default: 0, unit: 'deg' }],
    toFilter: p => `hue-rotate(${p.deg}deg)`,
    isIdentity: p => p.deg === 0,
  },
}

export const EFFECT_TYPES = Object.keys(EFFECTS) as EffectType[]

function withDefaults (def: EffectDef, params: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of def.params) {
    const v = params[p.key]
    out[p.key] = typeof v === 'number' && Number.isFinite(v) ? v : p.default
  }
  return out
}

/** 拼接 filter 串；恒等实例剔除；无有效项返回 ''（调用方置 ctx.filter = 'none'） */
export function effectsToFilter (effects: readonly EffectInstance[], blurScale = 1): string {
  const parts: string[] = []
  for (const fx of effects) {
    const def = EFFECTS[fx.type]
    if (!def) {
      continue
    }
    const params = withDefaults(def, fx.params)
    if (def.isIdentity(params)) {
      continue
    }
    parts.push(def.toFilter(params, blurScale))
  }
  return parts.join(' ')
}

export function createEffectInstance (type: EffectType): EffectInstance {
  const def = EFFECTS[type]
  const params: Record<string, number> = {}
  for (const p of def.params) {
    params[p.key] = p.default
  }
  return { id: newId('fx'), type, params }
}
