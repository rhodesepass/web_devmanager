import vuetify from 'eslint-config-vuetify'

// eslint-config-vuetify 内部依赖 Object.groupBy（Node 21+），本机若跑 Node 20 需兜底
Object.groupBy ??= (items, keyFn) => {
  const out = Object.create(null)
  let i = 0
  for (const item of items) {
    (out[keyFn(item, i++)] ??= []).push(item)
  }
  return out
}

export default vuetify({ ts: true }).then(configs => [
  ...configs,
  {
    // editor-core 是零框架纯 TS：预览与导出共用它，禁止混入 UI/DOM 依赖
    files: ['src/editor-core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['vue', 'vue/*', 'vue-router*', 'vuetify*', 'konva*', 'jszip'], message: 'editor-core 零框架，禁止引 UI/打包库' },
          // 例外：@/config/encode-params 是纯数据调校档案（无 vue/DOM），exporter 行内豁免引用
          { group: ['@/*', '!@/editor-core/*'], message: 'editor-core 不得依赖宿主代码' },
        ],
      }],
      'no-restricted-globals': ['error', 'document', 'window', 'navigator', 'localStorage'],
    },
  },
])
