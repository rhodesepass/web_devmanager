import type {
  FileRole,
  FlashManifest,
  FlashTarget,
  ManifestEntry,
  ManifestFile,
  MirrorEntry,
  TargetFiles,
} from '@/types/flashManifest'
import { siteLinks } from '@/config/site'

interface RawManifestFile {
  name?: string
  sha256?: string
  size?: number
}

interface RawTargetFiles {
  felboot?: string
  uboot?: string
  boot?: string
  rootfs?: string
}

interface RawManifestEntry {
  version?: string
  channel?: string
  title?: string
  commit?: string
  description?: string
  targets?: Record<string, RawTargetFiles>
  files?: RawManifestFile[]
}

interface RawFlashManifest {
  schema?: number
  generated_at?: string
  available_mirror?: Array<{ name?: string, url?: string }>
  manifest?: RawManifestEntry[]
}

function normalizeBaseUrl (url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

/**
 * schema 3 清单固定文件名 manifest-v3.json（与旧的 manifest.json 区分）。
 * rev/screen 仅用于服务端统计，每种组合返回的都是同一份文档。
 */
export function buildFlashManifestUrl (rev: string, screen: string): string {
  const base = normalizeBaseUrl(siteLinks.flashBase)
  return new URL(`${rev}/${screen}/manifest-v3.json`, base).href
}

function parseTargetFiles (raw: RawTargetFiles | undefined): TargetFiles | null {
  if (!raw || !raw.felboot || !raw.uboot || !raw.boot || !raw.rootfs) {
    return null
  }
  return {
    felboot: raw.felboot,
    uboot: raw.uboot,
    boot: raw.boot,
    rootfs: raw.rootfs,
  }
}

function parseManifestEntry (raw: RawManifestEntry): ManifestEntry | null {
  if (!raw.version || !raw.title || !raw.targets) {
    return null
  }
  const nand = parseTargetFiles(raw.targets.nand)
  const sd = parseTargetFiles(raw.targets.sd)
  if (!nand && !sd) {
    return null
  }
  const files = (raw.files ?? [])
    .filter((f): f is Required<RawManifestFile> =>
      typeof f.name === 'string' && typeof f.sha256 === 'string')
    .map<ManifestFile>(f => ({ name: f.name, sha256: f.sha256, size: f.size ?? 0 }))

  return {
    version: raw.version,
    channel: raw.channel ?? 'stable',
    title: raw.title,
    commit: raw.commit ?? '',
    description: raw.description ?? '',
    // 缺失的目标用另一目标兜底，方便 UI 统一按 nand/sd 索引
    targets: {
      nand: nand ?? sd!,
      sd: sd ?? nand!,
    },
    files,
  }
}

function parseFlashManifest (data: unknown): FlashManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('manifest.json 格式无效')
  }
  const raw = data as RawFlashManifest
  if (raw.schema !== 3) {
    throw new Error(`manifest-v3.json 的 schema 必须是 3（实际为 ${raw.schema ?? '缺失'}）`)
  }
  const manifest = (raw.manifest ?? [])
    .map(parseManifestEntry)
    .filter((e): e is ManifestEntry => e != null)
  const availableMirror = (raw.available_mirror ?? [])
    .map(m => ({ name: m.name ?? '', url: m.url ?? '' }))
    .filter((m): m is MirrorEntry => !!m.name && !!m.url)

  if (manifest.length === 0) {
    throw new Error('manifest.json 中没有可用固件版本')
  }
  if (availableMirror.length === 0) {
    throw new Error('manifest.json 中没有可用下载镜像')
  }

  return {
    schema: raw.schema ?? 3,
    generatedAt: raw.generated_at ?? '',
    manifest,
    availableMirror,
  }
}

export async function fetchFlashManifest (
  rev: string,
  screen: string,
): Promise<FlashManifest> {
  const url = buildFlashManifestUrl(rev, screen)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载固件清单失败 (${res.status})`)
  }
  const data: unknown = await res.json()
  return parseFlashManifest(data)
}

// ===========================================================================
// 旧版兼容模式仍用旧的 manifest.json（老格式：files[] 带 type/name/hash）。
// 这里把它归一化成上面的 FlashManifest 结构，供同一套 UI/下载逻辑复用。
// ===========================================================================

interface RawLegacyFile {
  type?: string
  name?: string
  hash?: string
}

interface RawLegacyEntry {
  version?: string
  title?: string
  commit?: string
  description?: string
  files?: RawLegacyFile[]
}

interface RawLegacyManifest {
  available_mirror?: Array<{ name?: string, url?: string }>
  manifest?: RawLegacyEntry[]
}

/** 旧清单文件名 manifest.json */
export function buildLegacyManifestUrl (rev: string, screen: string): string {
  const base = normalizeBaseUrl(siteLinks.flashBase)
  return new URL(`${rev}/${screen}/manifest.json`, base).href
}

function parseLegacyEntry (raw: RawLegacyEntry): ManifestEntry | null {
  if (!raw.version || !raw.title) {
    return null
  }
  const byType: Partial<Record<'uboot' | 'boot' | 'rootfs', string>> = {}
  const files: ManifestFile[] = []
  for (const f of raw.files ?? []) {
    if (!f.type || !f.name || !f.hash) {
      continue
    }
    if (f.type === 'uboot' || f.type === 'boot' || f.type === 'rootfs') {
      byType[f.type] = f.name
    }
    files.push({ name: f.name, sha256: f.hash, size: 0 })
  }
  if (!byType.uboot || !byType.boot || !byType.rootfs) {
    return null
  }
  // 老方法不用 felboot，也没有 nand/sd 之分，两个目标指向同一组文件
  const targets: TargetFiles = {
    felboot: '',
    uboot: byType.uboot,
    boot: byType.boot,
    rootfs: byType.rootfs,
  }
  return {
    version: raw.version,
    channel: 'legacy',
    title: raw.title,
    commit: raw.commit ?? '',
    description: raw.description ?? '',
    targets: { nand: targets, sd: targets },
    files,
  }
}

function parseLegacyManifest (data: unknown): FlashManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('manifest.json 格式无效')
  }
  const raw = data as RawLegacyManifest
  const manifest = (raw.manifest ?? [])
    .map(parseLegacyEntry)
    .filter((e): e is ManifestEntry => e != null)
  const availableMirror = (raw.available_mirror ?? [])
    .map(m => ({ name: m.name ?? '', url: m.url ?? '' }))
    .filter((m): m is MirrorEntry => !!m.name && !!m.url)

  if (manifest.length === 0) {
    throw new Error('manifest.json 中没有可用固件版本')
  }
  if (availableMirror.length === 0) {
    throw new Error('manifest.json 中没有可用下载镜像')
  }

  return { schema: 2, generatedAt: '', manifest, availableMirror }
}

export async function fetchLegacyManifest (
  rev: string,
  screen: string,
): Promise<FlashManifest> {
  const url = buildLegacyManifestUrl(rev, screen)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载固件清单失败 (${res.status})`)
  }
  const data: unknown = await res.json()
  return parseLegacyManifest(data)
}

/** 取某存储目标下某角色对应的固件文件元信息 */
export function getTargetFile (
  entry: ManifestEntry,
  target: FlashTarget,
  role: FileRole,
): ManifestFile | undefined {
  const name = entry.targets[target][role]
  return entry.files.find(f => f.name === name)
}

export function resolveMirrorDownloadUrl (
  mirror: MirrorEntry,
  version: string,
  fileName: string,
): string {
  return mirror.url
    .replace(/\$\{version\}/g, version)
    .replace(/\$\{file\}/g, fileName)
}

async function sha256Hex (data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer)
  return [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 占位哈希（清单尚未填真实值）时跳过校验 */
function isRealHash (hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash)
}

export async function downloadManifestFile (
  mirror: MirrorEntry,
  version: string,
  file: ManifestFile,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Uint8Array> {
  const url = resolveMirrorDownloadUrl(mirror, version, file.name)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载 ${file.name} 失败 (${res.status})`)
  }

  const total = res.headers.get('Content-Length')
    ? Number.parseInt(res.headers.get('Content-Length')!, 10)
    : (file.size || null)

  let buffer: Uint8Array
  if (!res.body) {
    buffer = new Uint8Array(await res.arrayBuffer())
    onProgress?.(buffer.byteLength, buffer.byteLength)
  } else {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      chunks.push(value)
      loaded += value.byteLength
      onProgress?.(loaded, total)
    }
    const length = chunks.reduce((sum, c) => sum + c.byteLength, 0)
    buffer = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    }
  }

  if (isRealHash(file.sha256)) {
    const hash = await sha256Hex(buffer)
    if (hash !== file.sha256.toLowerCase()) {
      throw new Error(`${file.name} 校验失败（哈希不匹配）`)
    }
  }
  return buffer
}
