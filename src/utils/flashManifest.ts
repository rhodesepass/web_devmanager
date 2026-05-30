import type {
  FlashManifest,
  ManifestEntry,
  ManifestFile,
  MirrorEntry,
} from '@/types/flashManifest'
import { siteLinks } from '@/config/site'

interface RawManifestFile {
  type?: string
  name?: string
  hash?: string
}

interface RawManifestEntry {
  version?: string
  title?: string
  commit?: string
  description?: string
  type?: string
  minimal_flasher_version?: number
  files?: RawManifestFile[]
}

interface RawFlashManifest {
  flasher?: {
    latest_version?: number
    description?: string
    url?: string
  }
  available_mirror?: Array<{ name?: string, url?: string }>
  manifest?: RawManifestEntry[]
}

function normalizeBaseUrl (url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

export function buildFlashManifestUrl (rev: string, screen: string): string {
  const base = normalizeBaseUrl(siteLinks.flashBase)
  return new URL(`${rev}/${screen}/manifest.json`, base).href
}

function parseManifestFile (raw: RawManifestFile): ManifestFile | null {
  if (!raw.type || !raw.name || !raw.hash) {
    return null
  }
  return {
    type: raw.type,
    name: raw.name,
    hash: raw.hash,
  }
}

function parseManifestEntry (raw: RawManifestEntry): ManifestEntry | null {
  if (!raw.version || !raw.title) {
    return null
  }
  const files = (raw.files ?? [])
    .map(parseManifestFile)
    .filter((f): f is ManifestFile => f != null)
  if (files.length === 0) {
    return null
  }
  return {
    version: raw.version,
    title: raw.title,
    commit: raw.commit ?? '',
    description: raw.description ?? '',
    type: raw.type ?? 'release',
    minimalFlasherVersion: raw.minimal_flasher_version ?? 1,
    files,
  }
}

function parseFlashManifest (data: unknown): FlashManifest {
  if (!data || typeof data !== 'object') {
    throw new Error('manifest.json 格式无效')
  }
  const raw = data as RawFlashManifest
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
    flasher: {
      latestVersion: raw.flasher?.latest_version ?? 1,
      url: raw.flasher?.url ?? '',
    },
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

export function getEntryFile (
  entry: ManifestEntry,
  type: 'uboot' | 'boot' | 'rootfs',
): ManifestFile | undefined {
  return entry.files.find(f => f.type === type)
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
    : null

  if (!res.body) {
    const buffer = new Uint8Array(await res.arrayBuffer())
    onProgress?.(buffer.byteLength, buffer.byteLength)
    const hash = await sha256Hex(buffer)
    if (hash !== file.hash) {
      throw new Error(`${file.name} 校验失败（哈希不匹配）`)
    }
    return buffer
  }

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
  const buffer = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  const hash = await sha256Hex(buffer)
  if (hash !== file.hash) {
    throw new Error(`${file.name} 校验失败（哈希不匹配）`)
  }
  return buffer
}
