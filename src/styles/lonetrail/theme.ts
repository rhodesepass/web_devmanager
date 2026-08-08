/**
 * Lone Trail 亮色主题（Vuetify 主题定义）。
 *
 * 色值来源于 tokens/colors.css。Vuetify 需要在运行时把颜色解析成 RGB
 * 三元组来派生透明度变体，所以这里必须是字面量 hex。
 * 若修改 token，请同步修改此文件。
 */
import type { ThemeDefinition } from 'vuetify'

export const loneTrailLightTheme: ThemeDefinition = {
  dark: false,
  colors: {
    'background': '#F3EDE2', // --paper-1
    'surface': '#FBF8F2', // --paper-0
    'surface-bright': '#FFFFFF',
    'surface-light': '#F3EDE2',
    'surface-variant': '#E9E1D3',
    'on-surface-variant': '#3D3A32',

    'primary': '#E8722A', // 莱茵橙——唯一的品牌彩色
    'primary-darken-1': '#C9551A',
    'on-primary': '#FFFFFF',
    'secondary': '#2E5F92', // 复古蓝
    'secondary-darken-1': '#1B3C61',
    'on-secondary': '#FBF8F2',
    'accent': '#E3B23C', // 复古黄

    'error': '#C4392C',
    'on-error': '#FFFFFF',
    'info': '#2E5F92',
    'success': '#3A7D44',
    'on-success': '#FFFFFF',
    'warning': '#E3B23C',
    'on-warning': '#14130F',

    'on-background': '#26241E',
    'on-surface': '#26241E',

    'ink': '#14130F',
    'ink-muted': '#6B665A',
    'hairline': '#BDB6A6',
    'void': '#0B0C0E',
  },
  variables: {
    'border-color': '#14130F',
    'border-opacity': 1,
    'high-emphasis-opacity': 1,
    'medium-emphasis-opacity': 0.72,
    'disabled-opacity': 0.34,
    'idle-opacity': 0,
    'hover-opacity': 0.06,
    'focus-opacity': 0.1,
    'selected-opacity': 0.1,
    'activated-opacity': 0.12,
    'pressed-opacity': 0.16,
    'dragged-opacity': 0.08,
    'theme-kbd': '#14130F',
    'theme-on-kbd': '#FBF8F2',
    'theme-overlay-multiplier': 1,
  },
}
