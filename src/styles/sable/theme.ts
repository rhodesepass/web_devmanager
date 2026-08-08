/**
 * Sable Ops 暗色主题（Vuetify 主题定义）。
 *
 * 色值来源于 tokens/colors.css。Vuetify 需要在运行时把颜色解析成 RGB
 * 三元组来派生透明度变体，所以这里必须是字面量 hex，不能写 var(--amber-500)。
 * 若修改 token，请同步修改此文件。
 */
import type { ThemeDefinition } from 'vuetify'

export const sableDarkTheme: ThemeDefinition = {
  dark: true,
  colors: {
    'background': '#0a0d13', // --ink-900
    'surface': '#0f131b', // --ink-850
    'surface-bright': '#141924', // --ink-800
    'surface-light': '#1b2130', // --ink-700
    'surface-variant': '#242c3d', // --ink-600
    'on-background': '#eef1f5',
    'on-surface': '#eef1f5',
    'on-surface-variant': '#aeb9c7',

    'primary': '#ffa11f', // --amber-500，一屏只允许一个琥珀重点
    'on-primary': '#05070a',
    'secondary': '#3f9dff', // --holo-500，数据/扫描/选中，绝不做主要动作
    'on-secondary': '#05070a',
    'accent': '#8b6ff5', // --violet-500
    'error': '#d93a45', // --alert-500
    'on-error': '#ffffff',
    'success': '#2fbf8f', // --viridian-500
    'on-success': '#05070a',
    'warning': '#ffa11f',
    'on-warning': '#05070a',
    'info': '#3f9dff',
    'on-info': '#05070a',

    // 具名色阶，可用作 color="ink-950" / text-steel-300 等
    'ink-950': '#05070a',
    'ink-900': '#0a0d13',
    'ink-850': '#0f131b',
    'ink-800': '#141924',
    'ink-700': '#1b2130',
    'ink-600': '#242c3d',
    'ink-500': '#2f3a4e',
    'ink-400': '#3d4a61',
    'steel-500': '#4e5b6e',
    'steel-400': '#68768a',
    'steel-300': '#8b98aa',
    'steel-200': '#aeb9c7',
    'steel-100': '#ced6e0',
    'paper-200': '#d8d5cd',
    'paper-100': '#e9e7e1',
    'paper-050': '#f5f4f0',
    'amber-600': '#c67806',
    'amber-500': '#ffa11f',
    'amber-400': '#ffb951',
    'amber-300': '#ffd08a',
    'holo-700': '#12497f',
    'holo-600': '#1d6fc4',
    'holo-500': '#3f9dff',
    'holo-400': '#7cbeff',
    'holo-300': '#b3daff',
  },
  variables: {
    // Vuetify 内部状态层透明度，针对近黑底重新调校
    'hover-opacity': 0.045,
    'focus-opacity': 0.09,
    'pressed-opacity': 0.13,
    'activated-opacity': 0.1,
    'selected-opacity': 0.12,
    'disabled-opacity': 0.34,
    'border-color': '#ffffff',
    'border-opacity': 0.08,
    'high-emphasis-opacity': 1,
    'medium-emphasis-opacity': 0.74,
    // 纵深来自明度对比与发丝线，而非环境阴影
    'shadow-key-umbra-opacity': 0.5,
    'shadow-key-penumbra-opacity': 0.34,
    'shadow-key-ambient-opacity': 0.24,
  },
}
