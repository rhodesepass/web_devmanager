import type { SharedMaterialAsset } from '@/types/material'
import { siteLinks } from '@/config/site'
import { triggerBlobDownload } from '@/utils/zipMaterial'

function normalizeBaseUrl (url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}

function isAbsoluteUrl (url: string): boolean {
  return /^https?:\/\//i.test(url)
}

/** 将相对基址（如 /asset2share/）解析为可用于 URL 构造的绝对地址 */
function toAbsoluteBaseUrl (base: string): string {
  const normalized = normalizeBaseUrl(base)
  if (isAbsoluteUrl(normalized)) {
    return normalized
  }
  if (typeof window === 'undefined') {
    return normalized
  }
  return new URL(normalized, window.location.origin).href
}

/** 将 manifest 中的相对路径解析为完整 URL */
export function resolveSharedMaterialUrl (
  path: string | null | undefined,
  baseUrl?: string,
): string | null {
  if (!path) {
    return null
  }
  if (isAbsoluteUrl(path)) {
    return path
  }
  const base = toAbsoluteBaseUrl(baseUrl ?? siteLinks.sharedMaterialsBase)
  return new URL(path.replace(/^\//, ''), base).href
}

export type SharedManifestVersion = 'new' | 'old'

const MANIFEST_FILES: Record<SharedManifestVersion, string> = {
  new: 'manifest_new.json',
  old: 'manifest.json',
}

/** manifest_new 中 icon/preview 仍写作 previews/,实际文件位于 previews_new/ */
function remapNewPreviewPath (path: string | null): string | null {
  if (path && path.startsWith('previews/')) {
    return `previews_new/${path.slice('previews/'.length)}`
  }
  return path
}

export async function fetchSharedMaterialManifest (
  version: SharedManifestVersion = 'new',
): Promise<SharedMaterialAsset[]> {
  const base = toAbsoluteBaseUrl(siteLinks.sharedMaterialsBase)
  const url = new URL(MANIFEST_FILES[version], base).href
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载素材清单失败 (${res.status})`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error(`${MANIFEST_FILES[version]} 格式无效`)
  }
  const assets = data as SharedMaterialAsset[]
  if (version !== 'new') {
    return assets
  }
  return assets.map(a => ({
    ...a,
    icon: remapNewPreviewPath(a.icon),
    preview: remapNewPreviewPath(a.preview),
  }))
}

export async function downloadSharedMaterialZipFile (
  asset: SharedMaterialAsset,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<File> {
  const url = asset.download_url
  if (!url) {
    throw new Error('该素材没有下载地址')
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载失败 (${res.status})`)
  }

  const total = res.headers.get('Content-Length')
    ? Number.parseInt(res.headers.get('Content-Length')!, 10)
    : null

  if (!res.body) {
    const blob = await res.blob()
    onProgress?.(blob.size, blob.size)
    const filename = asset.zip || `${sanitizeDownloadName(asset.name)}.zip`
    return new File([blob], filename, { type: 'application/zip' })
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

  const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' })
  const filename = asset.zip || `${sanitizeDownloadName(asset.name)}.zip`
  return new File([blob], filename, { type: 'application/zip' })
}

export async function triggerSharedMaterialLocalDownload (
  asset: SharedMaterialAsset,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<void> {
  const file = await downloadSharedMaterialZipFile(asset, onProgress)
  triggerBlobDownload(file, file.name)
}

/**
 * Embed/WebView 场景下的直链下载：跳过 fetch + Blob，直接由宿主浏览器
 * 或外层 WebView 处理 zip URL，避免跨域和无下载权限的问题。
 */
export function navigateSharedMaterialDownload (asset: SharedMaterialAsset): void {
  const url = resolveSharedMaterialUrl(asset.download_url)
  if (!url) {
    throw new Error('该素材没有下载地址')
  }
  if (typeof window === 'undefined') {
    return
  }
  window.location.assign(url)
}

function sanitizeDownloadName (name: string): string {
  return name.replace(/[^\w\u4E00-\u9FFF.-]+/g, '_').slice(0, 80) || 'material'
}

export function filterSharedMaterials (
  assets: SharedMaterialAsset[],
  query: string,
  badges: string[] = [],
): SharedMaterialAsset[] {
  let result = assets
  if (badges.length > 0) {
    result = result.filter(a => badges.every(b => a.badges.includes(b)))
  }
  const q = query.trim().toLowerCase()
  if (!q) {
    return result
  }
  return result.filter(
    a =>
      a.name.toLowerCase().includes(q)
      || a.desc.toLowerCase().includes(q),
  )
}

/** 收集清单中出现过的所有 badge,按出现次数降序 */
export function collectSharedMaterialBadges (assets: SharedMaterialAsset[]): string[] {
  const counts = new Map<string, number>()
  for (const a of assets) {
    for (const b of a.badges) {
      counts.set(b, (counts.get(b) ?? 0) + 1)
    }
  }
  return [...counts.keys()].sort((x, y) => counts.get(y)! - counts.get(x)!)
}

export function badgeChipColor (badge: string): string | undefined {
  switch (badge) {
    case '干员信息': { return 'blue-grey'
    }
    case '图片叠加': { return 'teal'
    }
    case '有入场动画': { return 'deep-purple'
    }
    default: { return undefined
    }
  }
}
