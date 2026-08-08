/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Composables
import { createVuetify } from 'vuetify'
import { loneTrailLightTheme } from '@/styles/lonetrail/theme'
import { sableDarkTheme } from '@/styles/sable/theme'

// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
// 设计系统（必须在 vuetify/styles 之后加载）：
// 暗色 Sable Ops（html.sable-dark 作用域）+ 亮色 Lone Trail（html.lt-light 作用域）
import '@/styles/sable/index.css'
import '@/styles/lonetrail/index.css'

export const THEME_STORAGE_KEY = 'devman.theme'

function resolveDefaultTheme (): string {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: resolveDefaultTheme(),
    themes: {
      // 亮色使用 Lone Trail；暗色使用 Sable Ops
      light: loneTrailLightTheme,
      dark: sableDarkTheme,
    },
  },
})
