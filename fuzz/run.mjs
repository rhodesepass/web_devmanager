// 用 rolldown 把 fuzz.ts(连同 src/ 下真实协议栈)打包成 node 可跑的单文件再执行。
// 用法: node fuzz/run.mjs [--rounds N] [--seed S] [--only cat,cat]
import { rolldown } from 'rolldown'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

const bundle = await rolldown({
  input: path.join(here, 'fuzz.ts'),
  cwd: path.join(here, '..'),
  platform: 'node',
  resolve: {
    alias: { '@': path.join(here, '..', 'src') },
  },
  plugins: [{
    // node 里没有 vite 的 import.meta.env,静态替换掉
    name: 'strip-vite-env',
    transform (code) {
      if (code.includes('import.meta.env.DEV')) {
        return code.replaceAll('import.meta.env.DEV', 'false')
      }
      return null
    },
  }],
  logLevel: 'silent',
})

const out = path.join(here, 'dist', 'fuzz.mjs')
await bundle.write({ file: out, format: 'esm' })
await bundle.close()

await import(pathToFileURL(out).href)
