/**
 * 导出产物合规校验：纯 TS 解析 ISO-BMFF box，对照设备 demuxer/解码器硬约束
 * （drm_app_neo mp4_demux.c / h264_parser.c，见 3.0 规约）。
 */

/** 设备 VDEC_OUTPUT_BUF_SIZE：单 sample 硬上限 */
export const MAX_SAMPLE_SIZE = 512 * 1024
/** avcC（extradata）上限 */
export const MAX_AVCC_SIZE = 64 * 1024

export interface Mp4Summary {
  width: number
  height: number
  codec: string
  fps: number
  durationSec: number
  sampleCount: number
  maxSampleSize: number
  avcCSize: number
}

export interface Mp4VerifyResult {
  ok: boolean
  errors: string[]
  warnings: string[]
  summary: Mp4Summary | null
}

interface BoxRange {
  type: string
  /** 载荷起点（跳过 box 头） */
  start: number
  end: number
}

function readU32 (data: Uint8Array, offset: number): number {
  return (
    (data[offset] << 24 | data[offset + 1] << 16 | data[offset + 2] << 8 | data[offset + 3]) >>> 0
  )
}

function boxType (data: Uint8Array, offset: number): string {
  return String.fromCodePoint(data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
}

/** 遍历 [start, end) 内的一层 box */
function* iterBoxes (data: Uint8Array, start: number, end: number): Generator<BoxRange> {
  let offset = start
  while (offset + 8 <= end) {
    let size = readU32(data, offset)
    const type = boxType(data, offset + 4)
    let headerSize = 8
    if (size === 1) {
      // 64 位 largesize：高 32 位超界的文件不可能塞进内存，取低 32 位
      headerSize = 16
      size = readU32(data, offset + 12)
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize || offset + size > end) {
      return
    }
    yield { type, start: offset + headerSize, end: offset + size }
    offset += size
  }
}

function findBox (data: Uint8Array, start: number, end: number, path: string[]): BoxRange | null {
  let range: BoxRange | null = null
  let s = start
  let e = end
  for (const segment of path) {
    range = null
    for (const box of iterBoxes(data, s, e)) {
      if (box.type === segment) {
        range = box
        break
      }
    }
    if (!range) {
      return null
    }
    s = range.start
    e = range.end
  }
  return range
}

function findAllBoxes (data: Uint8Array, start: number, end: number, type: string): BoxRange[] {
  const out: BoxRange[] = []
  for (const box of iterBoxes(data, start, end)) {
    if (box.type === type) {
      out.push(box)
    }
  }
  return out
}

export function verifyMp4 (data: Uint8Array): Mp4VerifyResult {
  const errors: string[] = []
  const warnings: string[] = []

  const moov = findBox(data, 0, data.length, ['moov'])
  if (!moov) {
    return { ok: false, errors: ['找不到 moov box（不是合法 MP4？）'], warnings, summary: null }
  }
  if (findAllBoxes(data, 0, data.length, 'moof').length > 0) {
    errors.push('检测到 moof：设备不支持 fragmented MP4')
  }

  // 找第一条 video trak（与设备 demuxer 行为一致）
  let videoTrak: BoxRange | null = null
  for (const trak of findAllBoxes(data, moov.start, moov.end, 'trak')) {
    const hdlr = findBox(data, trak.start, trak.end, ['mdia', 'hdlr'])
    if (hdlr && boxType(data, hdlr.start + 8) === 'vide') {
      videoTrak = trak
      break
    }
  }
  if (!videoTrak) {
    return { ok: false, errors: ['没有视频轨'], warnings, summary: null }
  }

  // tkhd：rotation 矩阵必须是单位阵（素材一律正向）
  const tkhd = findBox(data, videoTrak.start, videoTrak.end, ['tkhd'])
  let width = 0
  let height = 0
  if (tkhd) {
    const version = data[tkhd.start]
    const matrixOffset = tkhd.start + (version === 1 ? 4 + 8 + 8 + 4 + 4 + 4 + 8 + 8 + 2 + 2 + 2 + 2 : 4 + 4 + 4 + 4 + 4 + 4 + 8 + 2 + 2 + 2 + 2)
    const a = readU32(data, matrixOffset)
    const b = readU32(data, matrixOffset + 4)
    const c = readU32(data, matrixOffset + 12)
    const d = readU32(data, matrixOffset + 16)
    if (!(a === 0x00_01_00_00 && d === 0x00_01_00_00 && b === 0 && c === 0)) {
      errors.push('tkhd 带旋转矩阵：素材必须正向存储，不要预旋转')
    }
    width = readU32(data, matrixOffset + 36) >>> 16
    height = readU32(data, matrixOffset + 40) >>> 16
  }

  const stbl = findBox(data, videoTrak.start, videoTrak.end, ['mdia', 'minf', 'stbl'])
  if (!stbl) {
    return { ok: false, errors: ['找不到 stbl'], warnings, summary: null }
  }

  // stsd：sample entry 必须是 avc1/avc3 且恰好一个（分段参数一致性的旁证）
  const stsd = findBox(data, stbl.start, stbl.end, ['stsd'])
  let codec = '?'
  let avcCSize = 0
  if (stsd) {
    const entryCount = readU32(data, stsd.start + 4)
    if (entryCount !== 1) {
      errors.push(`stsd 有 ${entryCount} 个 sample entry（应为 1，分段编码参数可能不一致）`)
    }
    const entryStart = stsd.start + 8
    codec = boxType(data, entryStart + 4)
    if (codec === 'avc1' || codec === 'avc3') {
      // VisualSampleEntry 固定头 8+70=78 字节后是子 box
      const entrySize = readU32(data, entryStart)
      const avcC = findBox(data, entryStart + 8 + 78, entryStart + entrySize, ['avcC'])
      if (avcC) {
        avcCSize = avcC.end - avcC.start
        if (avcCSize > MAX_AVCC_SIZE) {
          errors.push(`avcC ${avcCSize} 字节，超过设备上限 64KB`)
        }
      } else {
        errors.push('sample entry 里没有 avcC（必须带解码配置）')
      }
    } else {
      errors.push(`视频编码是 ${codec}，设备只支持 H.264 (avc1/avc3)`)
    }
  } else {
    errors.push('找不到 stsd')
  }

  // stsz：单 sample ≤ 512KB
  const stsz = findBox(data, stbl.start, stbl.end, ['stsz'])
  let maxSampleSize = 0
  let sampleCount = 0
  if (stsz) {
    const uniformSize = readU32(data, stsz.start + 4)
    sampleCount = readU32(data, stsz.start + 8)
    if (uniformSize > 0) {
      maxSampleSize = uniformSize
    } else {
      for (let i = 0; i < sampleCount; i++) {
        const s = readU32(data, stsz.start + 12 + i * 4)
        if (s > maxSampleSize) {
          maxSampleSize = s
        }
      }
    }
    if (maxSampleSize > MAX_SAMPLE_SIZE) {
      errors.push(
        `最大 sample ${(maxSampleSize / 1024).toFixed(0)}KB 超过设备解码 buffer 上限 512KB，`
        + '建议提高 crf（降码率）或降低画面复杂度后重新导出',
      )
    }
  } else {
    errors.push('找不到 stsz')
  }

  // stss：closed GOP 正常封装必有关键帧表
  if (!findBox(data, stbl.start, stbl.end, ['stss'])) {
    errors.push('找不到 stss 关键帧表（循环回绕依赖它识别 GOP 边界）')
  }

  // mdhd + stts：CFR 帧率
  const { fps, durationSec } = checkTiming(data, videoTrak, stbl, sampleCount, warnings)

  const summary: Mp4Summary = {
    width,
    height,
    codec,
    fps,
    durationSec,
    sampleCount,
    maxSampleSize,
    avcCSize,
  }
  return { ok: errors.length === 0, errors, warnings, summary }
}

/**
 * 把 concat 在段边界产生的近似等长 sample delta 归一为主流值（原地写回）。
 * ffmpeg concat demuxer 按毫秒取整段时长，会给每段最后一帧多出几个 timescale
 * 单位（如 256→261@15360）；差异在容差内时统一改写为主流 delta 并同步 mdhd
 * duration，使产物成为严格 CFR。差异超容差（真 VFR）不动，交给校验告警。
 */
export function normalizeCfrStts (data: Uint8Array): boolean {
  const moov = findBox(data, 0, data.length, ['moov'])
  if (!moov) {
    return false
  }
  let videoTrak: BoxRange | null = null
  for (const trak of findAllBoxes(data, moov.start, moov.end, 'trak')) {
    const hdlr = findBox(data, trak.start, trak.end, ['mdia', 'hdlr'])
    if (hdlr && boxType(data, hdlr.start + 8) === 'vide') {
      videoTrak = trak
      break
    }
  }
  if (!videoTrak) {
    return false
  }
  const stts = findBox(data, videoTrak.start, videoTrak.end, ['mdia', 'minf', 'stbl', 'stts'])
  const mdhd = findBox(data, videoTrak.start, videoTrak.end, ['mdia', 'mdhd'])
  if (!stts || !mdhd) {
    return false
  }
  const entryCount = readU32(data, stts.start + 4)
  if (entryCount < 2) {
    return false
  }
  const entries: { count: number, delta: number }[] = []
  for (let i = 0; i < entryCount; i++) {
    entries.push({
      count: readU32(data, stts.start + 8 + i * 8),
      delta: readU32(data, stts.start + 12 + i * 8),
    })
  }
  let dominant = entries[0]
  for (const e of entries) {
    if (e.count > dominant.count) {
      dominant = e
    }
  }
  const tolerance = Math.max(4, dominant.delta >> 4)
  if (!entries.some(e => e.delta !== dominant.delta)
    || entries.some(e => Math.abs(e.delta - dominant.delta) > tolerance)) {
    return false
  }
  let totalSamples = 0
  for (const [i, e] of entries.entries()) {
    totalSamples += e.count
    writeU32(data, stts.start + 12 + i * 8, dominant.delta)
  }
  const version = data[mdhd.start]
  const duration = totalSamples * dominant.delta
  if (version === 1) {
    writeU32(data, mdhd.start + 24, Math.floor(duration / 4_294_967_296))
    writeU32(data, mdhd.start + 28, duration >>> 0)
  } else {
    writeU32(data, mdhd.start + 16, duration)
  }
  return true
}

function writeU32 (data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xFF
  data[offset + 1] = (value >>> 16) & 0xFF
  data[offset + 2] = (value >>> 8) & 0xFF
  data[offset + 3] = value & 0xFF
}

function checkTiming (
  data: Uint8Array,
  videoTrak: BoxRange,
  stbl: BoxRange,
  sampleCount: number,
  warnings: string[],
): { fps: number, durationSec: number } {
  const mdhd = findBox(data, videoTrak.start, videoTrak.end, ['mdia', 'mdhd'])
  const stts = findBox(data, stbl.start, stbl.end, ['stts'])
  if (!mdhd || !stts) {
    return { fps: 0, durationSec: 0 }
  }
  const version = data[mdhd.start]
  const timescale = version === 1 ? readU32(data, mdhd.start + 20) : readU32(data, mdhd.start + 12)
  const sttsCount = readU32(data, stts.start + 4)
  const firstDelta = readU32(data, stts.start + 12)
  let fps = 0
  let durationSec = 0
  if (firstDelta > 0 && timescale > 0) {
    fps = timescale / firstDelta
    durationSec = sampleCount / fps
  }
  // muxer 可能把等值 delta 拆成多段（concat 常见），只有 delta 真不一致才算 VFR
  // 条目布局：entry_count 后每条 8 字节 (sample_count, sample_delta)
  const deltas = new Set<number>()
  for (let i = 0; i < sttsCount; i++) {
    deltas.add(readU32(data, stts.start + 12 + i * 8))
  }
  if (deltas.size > 1) {
    warnings.push(
      `stts 存在多种帧时长（${[...deltas].join('/')}@${timescale}）：疑似 VFR，设备会整段按首帧时长播`,
    )
  }
  return { fps, durationSec }
}

export function formatSummary (s: Mp4Summary): string {
  return `${s.width}x${s.height} ${s.codec} ${s.fps.toFixed(2)}fps `
    + `${s.durationSec.toFixed(2)}s ${s.sampleCount}帧 `
    + `最大sample ${(s.maxSampleSize / 1024).toFixed(1)}KB avcC ${s.avcCSize}B`
}
