/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Composables
import { createApp } from 'vue'

// Plugins
import { registerPlugins } from '@/plugins'
// Components
import router from '@/router'
import App from './App.vue'

// Styles
import 'unfonts.css'

const app = createApp(App)

registerPlugins(app)

// 等首次路由解析完再挂载：全屏路由（meta.fullscreen）直进时避免 drawer 闪现一帧
router.isReady().then(() => app.mount('#app'))
