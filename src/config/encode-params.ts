export const ENCODE_FINGERPRINT = 'epass-enc-profiles@1.0.0' as const
export const ENCODE_SCHEMA_VERSION = 1 as const

export type FilterChainId = 'anime' | 'film' | 'fast'
export type ProfileId
  = | 'hq_360'
    | 'hq_720'
    | 'hq_video_360'
    | 'hq_video_720'
    | 'fast_360'
    | 'fast_720'
export type ContentKind = 'anime' | 'film' | 'any'

export interface EncodeCommon {
  fps: number
  pix_fmt: string
  extra_args: readonly string[]
  post_validation: {
    max_sample_bytes: number
    avcC_max_bytes: number
    require_sample_entry: readonly string[]
    require_stss: boolean
    require_cfr: boolean
  }
}

export interface FilterChainDef {
  comment: string
  /** 占位符：{W} {H} */
  vf: string
  sws_dither: string
}

export interface EncodeProfile {
  label: string
  resolution: readonly [number, number]
  content: ContentKind
  filter_chain: FilterChainId
  crf: number
  x264_params: string
  notes: string
}

export interface LoopAssetOption {
  comment: string
  x264_params_delta: string
  applies_when: string
}

export const encodeCommon = {
  fps: 60,
  pix_fmt: 'yuv420p',
  extra_args: ['-an', '-movflags', '+faststart'],
  post_validation: {
    max_sample_bytes: 524_288,
    avcC_max_bytes: 65_536,
    require_sample_entry: ['avc1'],
    require_stss: true,
    require_cfr: true,
  },
} as const satisfies EncodeCommon

// 抖动落地方式修正：顶层 `-sws_dither` 输出选项在 filtergraph 路径下报 Invalid argument
// （ffmpeg 5.1 wasm 与 8.0 CLI 实测一致），误差扩散必须内嵌进 16bit→8bit 的 scale 级；
// scale 滤镜的 sws_dither 选项值会过表达式求值器，字符串 error_diffusion 解析失败，
// 只能写枚举数值 3（SWS_DITHER_ED）。sws_dither 字段保留为记录，buildEncodeArgs 不再输出。
export const filterChains = {
  anime: {
    comment:
      '2D/立绘/壁纸档：16bit 中间态 deband + 补噪掩蔽 + 误差扩散抖动。deband 强度对应 f3kdb 保守档',
    vf: 'scale={W}:{H}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv444p16,deband=1thr=0.012:2thr=0.012:3thr=0.012:range=20:blur=1,noise=c0s=5:c0f=t+u,scale={W}:{H}:sws_dither=3,format=yuv420p',
    sws_dither: 'error_diffusion',
  },
  film: {
    comment: '实拍/照片档：跳过 deband（会抹纹理），仅高精度缩放 + 抖动',
    vf: 'scale={W}:{H}:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv444p16,scale={W}:{H}:sws_dither=3,format=yuv420p',
    sws_dither: 'error_diffusion',
  },
  fast: {
    comment: '迭代预览档：最短链，bicubic 即可；输入已是 8bit 420，无深度转换点，抖动级省略',
    vf: 'scale={W}:{H}:flags=bicubic,format=yuv420p',
    sws_dither: 'error_diffusion',
  },
} as const satisfies Record<FilterChainId, FilterChainDef>

export const encodeProfiles = {
  hq_360: {
    label: '高质量 · 2D/立绘 · 360x640',
    resolution: [360, 640],
    content: 'anime',
    filter_chain: 'anime',
    crf: 20,
    x264_params:
      'partitions=all:rc-lookahead=120:bframes=12:b-adapt=2:me=umh:subme=10:merange=48:no-fast-pskip=1:direct=auto:weightb=1:keyint=300:min-keyint=5:ref=8:chroma-qp-offset=-3:aq-mode=3:aq-strength=0.7:trellis=2:deblock=0,0:psy-rd=0.5,0.12:open-gop=0:vbv-maxrate=8000:vbv-bufsize=8000',
    notes:
      '安卓调校基线 + 补 VBV 8M（管持续码率，不指望管 sample，靠 post_validation 兜底）。ref=8 依据 L3.0 DPB 与播放器 360 挡 cap 预算 16；60fps 时 x264 自动升 L3.1，合法',
  },
  hq_720: {
    label: '高质量 · 2D/立绘 · 720x1280',
    resolution: [720, 1280],
    content: 'anime',
    filter_chain: 'anime',
    crf: 20,
    x264_params:
      'partitions=all:rc-lookahead=120:bframes=8:b-adapt=2:me=umh:subme=10:merange=32:no-fast-pskip=1:direct=auto:weightb=1:keyint=300:min-keyint=5:ref=4:chroma-qp-offset=-3:aq-mode=3:aq-strength=0.7:trellis=2:deblock=0,0:psy-rd=0.5,0.12:open-gop=0:level=3.2:vbv-maxrate=14000:vbv-bufsize=14000',
    notes:
      '安卓调校基线原样。宏块速率 216000 贴 L3.2 上限；ref=4+b-pyramid 实测 mdfb=4 → cap_count=8 贴满 720 挡预算',
  },
  hq_video_360: {
    label: '高质量 · 实拍/照片 · 360x640',
    resolution: [360, 640],
    content: 'film',
    filter_chain: 'film',
    crf: 18,
    x264_params:
      'partitions=all:rc-lookahead=120:bframes=8:b-adapt=2:me=umh:subme=10:merange=48:no-fast-pskip=1:direct=auto:weightb=1:keyint=300:min-keyint=5:ref=6:chroma-qp-offset=0:aq-mode=2:aq-strength=0.9:trellis=2:deblock=-1,-1:psy-rd=1.0,0.15:open-gop=0:vbv-maxrate=8000:vbv-bufsize=8000',
    notes:
      '与 2D 档的分歧：psy-rd 拉回保纹理、aq-mode=2、chroma offset 归零、轻负 deblock。bframes=8/ref=6 为实拍收益平台期；crf 低 2 档补实拍更早显糊',
  },
  hq_video_720: {
    label: '高质量 · 实拍/照片 · 720x1280',
    resolution: [720, 1280],
    content: 'film',
    filter_chain: 'film',
    crf: 18,
    x264_params:
      'partitions=all:rc-lookahead=120:bframes=6:b-adapt=2:me=umh:subme=10:merange=32:no-fast-pskip=1:direct=auto:weightb=1:keyint=300:min-keyint=5:ref=4:chroma-qp-offset=0:aq-mode=2:aq-strength=0.9:trellis=2:deblock=-1,-1:psy-rd=1.0,0.15:open-gop=0:level=3.2:vbv-maxrate=14000:vbv-bufsize=14000',
    notes: 'ref 被 720 挡解码预算钳在 4；bframes=6 已过实拍收益平台期',
  },
  fast_360: {
    label: '快速 · 通用 · 360x640',
    resolution: [360, 640],
    content: 'any',
    filter_chain: 'fast',
    crf: 20,
    x264_params:
      'me=hex:subme=7:rc-lookahead=40:bframes=3:b-adapt=2:ref=3:keyint=300:min-keyint=5:aq-mode=3:aq-strength=0.7:trellis=1:open-gop=0:vbv-maxrate=8000:vbv-bufsize=8000',
    notes:
      '迭代预览用。压缩率约比 HQ 差 15~25%，crf 模式下体现为文件偏大而非画质下降',
  },
  fast_720: {
    label: '快速 · 通用 · 720x1280',
    resolution: [720, 1280],
    content: 'any',
    filter_chain: 'fast',
    crf: 20,
    x264_params:
      'me=hex:subme=7:rc-lookahead=40:bframes=3:b-adapt=2:ref=3:keyint=300:min-keyint=5:aq-mode=3:aq-strength=0.7:trellis=1:open-gop=0:level=3.2:vbv-maxrate=14000:vbv-bufsize=14000',
    notes: '720 快速档同样必须带 level 3.2 + VBV，硬约束不随速度档豁免',
  },
} as const satisfies Record<ProfileId, EncodeProfile>

export const loopAssetOption = {
  comment:
    '可选开关：纯 loop 素材（设备回卷不依赖中途 IDR）可放开 GOP 白捡码率。任何档位叠加使用',
  x264_params_delta: ':keyint=600',
  applies_when: '素材为无限循环 loop 且时长 ≤30s',
} as const satisfies LoopAssetOption

/** 展开 filter chain 占位符 */
export function resolveFilterVf (
  chainId: FilterChainId,
  width: number,
  height: number,
): string {
  return filterChains[chainId].vf
    .replaceAll('{W}', String(width))
    .replaceAll('{H}', String(height))
}

export interface BuildEncodeArgsOptions {
  /** 叠加 loop_asset_option 的 keyint 放宽 */
  loopAsset?: boolean
  /** 覆盖输出帧率（工程 30/60fps 可选；缺省 encodeCommon.fps） */
  fps?: number
  /**
   * 显式限制 x264 线程数并禁多线程 lookahead。
   * wasm core-mt 的 pthread 池是编译期定长，threads=auto + rc-lookahead 的
   * lookahead 线程会把池请求爆掉 → pthread_create 永久阻塞（encoder open 卡死）。
   * 原生环境（安卓端）不需要，不传即不追加。
   */
  threads?: number
}

/**
 * 按 profile 渲染 ffmpeg 编码参数（不含 -i / 输出文件名）。
 * 形如：-vf … -c:v libx264 -profile:v high -crf … -x264-params … -pix_fmt … -r … <extra_args>
 */
export function buildEncodeArgs (
  profileId: ProfileId,
  options: BuildEncodeArgsOptions = {},
): string[] {
  const profile = encodeProfiles[profileId]
  const [w, h] = profile.resolution
  const vf = resolveFilterVf(profile.filter_chain, w, h)
  let x264 = profile.x264_params
  if (options.loopAsset) {
    x264 += loopAssetOption.x264_params_delta
  }
  if (options.threads) {
    x264 += `:threads=${options.threads}:lookahead-threads=1`
  }

  return [
    // filter_threads 与 x264 线程同钳：scale/deband/noise 都是 slice 多线程滤镜，
    // 同样会把 wasm 定长 pthread 池请求爆掉
    ...(options.threads ? ['-filter_threads', String(options.threads)] : []),
    '-vf', vf,
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-crf', String(profile.crf),
    '-x264-params', x264,
    '-pix_fmt', encodeCommon.pix_fmt,
    '-r', String(options.fps ?? encodeCommon.fps),
    ...encodeCommon.extra_args,
  ]
}
