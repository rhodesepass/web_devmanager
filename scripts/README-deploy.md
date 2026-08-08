# 部署注意事项

## COOP/COEP（素材编辑器多线程编码必需）

编辑器的 ffmpeg.wasm 多线程需要 SharedArrayBuffer，即页面必须跨源隔离。
dev/preview 已在 `vite.config.mts` 配好；**生产 nginx（epm.iccmc.cc）需整站加**：

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

全站资源同源（asset2share/app2share/ffmpeg core 都在本站），无外链子资源，整站开启无副作用。
未配置时编辑器自动退单线程编码（能用，慢 4~8 倍），页面会提示。

**坑：`add_header` 不是叠加继承。** location 块里只要出现任意一条 `add_header`，
server 层的 `add_header` 就整套不再继承——不是"缺哪条补哪条"，是全丢。
所以公共头要抽成 snippet，每个 location 各 `include` 一次：

```nginx
# /etc/nginx/snippets/epman-headers.conf
add_header Strict-Transport-Security "max-age=63072000" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

生产机（epm.iccmc.cc）已按此配置，见 `/etc/nginx/sites-enabled/epman`。

## ffmpeg core 自托管

`public/ffmpeg/`（60MB+）不入库，由 `npm install` 的 postinstall 钩子从
node_modules 同步（`scripts/syncFfmpegCore.mjs`）。部署机首次构建前确保跑过 install。

## ffmpeg core 传输压缩（deploy.sh 已产出 .gz/.br）

单套 core wasm 31MB，gzip -9 后 ~10MB（-68%），brotli 更小。
`deploy.sh` 构建后会对 dist 里的 wasm/js/css/html 预压缩并随 rsync 上传，
nginx 侧只需开静态压缩（零 CPU 开销，不要用运行时 gzip 压 31MB 文件）：

```nginx
# http 或 server 块
gzip_static on;                      # 有 .gz 就直接发
# brotli_static on;                  # 需 ngx_brotli 模块；deploy.sh 检测到本机 brotli 才产 .br

# core 文件名无 hash，靠 etag 协商缓存即可（nginx 默认 etag on）；
# 想强缓存可给 /ffmpeg/ 加 max-age，但升级 @ffmpeg/core 后要留意
location /ffmpeg/ {
    expires 1d;
}
```

注意 `Cross-Origin-Embedder-Policy: require-corp` 下资源需同源或带
`Cross-Origin-Resource-Policy`，本站资源全同源不受影响。

## wasm 的 MIME：什么都别配

`instantiateStreaming` 要求 `Content-Type: application/wasm`，但 **nginx 自带的
`mime.types` 从 1.21 起就有这条，不要再手写 `types { ... }` 补**。

`types` 指令是**整层替换**而非追加：在 server/location 里写一条 wasm 映射，会把
http 层 `include mime.types` 的整张表遮掉，于是 html/js/css/png 全部查不到映射、
落到 `default_type application/octet-stream`。表现是整站 Content-Type 变成
octet-stream——HTML 被浏览器当附件下载，`<script type="module">` 因 MIME 校验拒绝执行，
唯独 wasm 是对的。2026-08-04 线上踩过一次。

真要追加自定义类型，写在同一层级即可合并：

```nginx
include /etc/nginx/mime.types;      # 同 block 内先 include
types { application/foo foo; }      # 再补的条目会并进同一张表
```

## 自编译裁剪版 ffmpeg core（已落地，2026-08-04）

`vendor/ffmpeg-core-slim/` 存放白名单裁剪版 core（**wasm 4.5MB/套，gzip 1.4MB**；
官方全量版 31MB/gzip 10MB）。`syncFfmpegCore.mjs` 优先取 vendor，缺失时回落
node_modules 官方版。

重建方法（需 docker，构建配方 `scripts/ffmpeg-core-slim.Dockerfile`）：

```bash
git clone --depth 1 --branch v0.12.10 https://github.com/ffmpegwasm/ffmpeg.wasm.git
cp scripts/ffmpeg-core-slim.Dockerfile ffmpeg.wasm/Dockerfile.slim
cd ffmpeg.wasm
# 多线程套
docker buildx build --build-arg FFMPEG_MT=yes \
  --build-arg EXTRA_CFLAGS="-O3 -msimd128 -sUSE_PTHREADS -pthread" \
  -f Dockerfile.slim -o out-mt .
# 单线程套
docker buildx build --build-arg FFMPEG_ST=yes \
  --build-arg EXTRA_CFLAGS="-O3 -msimd128" \
  -f Dockerfile.slim -o out-st .
# 装回 vendor
cp out-mt/dist/esm/* ../vendor/ffmpeg-core-slim/core-mt/
cp out-st/dist/esm/* ../vendor/ffmpeg-core-slim/core-st/
cd .. && node scripts/syncFfmpegCore.mjs
```

裁剪清单见 Dockerfile 内 configure 白名单。踩过的坑：
- **concat demuxer 对 H.264 流强制要求 `h264_mp4toannexb` bsf**（即使 -c copy
  输出仍是 mp4），`--disable-everything` 后必须 `--enable-bsf=h264_mp4toannexb,extract_extradata`，
  否则合并阶段报 "Bitstream filter not found"
- 组件白名单里 `buffer,buffersink` 滤镜必须显式 enable（fftools 建图用）

回归验证：mp4Verify 合规校验 + 一次完整导出（含 concat）。版本升级时对齐
@ffmpeg/ffmpeg 的 JS 端版本（bind 层接口在仓库 tag 里）。
