// ffmpeg.wasm core 不入库（数十 MB），同步到 public/ 自托管，
// 运行时以绝对 URL 加载以绕开打包器对 worker 的处理。
// 优先取 vendor/ffmpeg-core-slim/ 下的自编译裁剪版（构建方式见 scripts/README-deploy.md），
// 没有裁剪版时回落 node_modules 的官方全量版。
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const targets = [
  ['core-mt', '@ffmpeg/core-mt'],
  ['core-st', '@ffmpeg/core'],
]

for (const [dir, pkg] of targets) {
  const slim = join(root, 'vendor', 'ffmpeg-core-slim', dir)
  const fallback = join(root, 'node_modules', pkg, 'dist', 'esm')
  const src = existsSync(join(slim, 'ffmpeg-core.wasm')) ? slim : fallback
  const dest = join(root, 'public', 'ffmpeg', dir)
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  console.log(`synced ${src === slim ? 'vendor slim' : pkg} -> public/ffmpeg/${dir}`)
}
