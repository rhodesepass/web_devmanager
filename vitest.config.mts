import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
  },
  test: {
    // node 环境跑：editor-core 泄漏 DOM 依赖会直接炸测试
    environment: 'node',
    include: ['src/editor-core/**/*.test.ts', 'src/config/**/*.test.ts'],
    passWithNoTests: true,
  },
})
