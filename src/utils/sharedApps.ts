import type { RemoteApp, SharedAppEntry, SharedAppInstallState } from '@/types/app'
import { siteLinks } from '@/config/site'
import { resolveSharedMaterialUrl } from '@/utils/sharedMaterials'
import { triggerBlobDownload } from '@/utils/zipMaterial'

/** 解析商店 manifest 内的相对路径(icon/preview/download_url) */
export function resolveSharedAppUrl (path: string | null | undefined): string | null {
  return resolveSharedMaterialUrl(path, siteLinks.sharedAppsBase)
}

export async function fetchSharedAppManifest (): Promise<SharedAppEntry[]> {
  const url = resolveSharedAppUrl('manifest.json')!
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`加载应用清单失败 (${res.status})`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error('manifest.json 格式无效')
  }
  return (data as Record<string, unknown>[]).map(normalizeEntry)
}

function normalizeEntry (raw: Record<string, unknown>): SharedAppEntry {
  return {
    uuid: typeof raw.uuid === 'string' ? raw.uuid : '',
    name: typeof raw.name === 'string' ? raw.name : '(未命名)',
    desc: typeof raw.desc === 'string' ? raw.desc : '',
    app_ver: typeof raw.app_ver === 'number' && Number.isInteger(raw.app_ver) && raw.app_ver >= 0
      ? raw.app_ver
      : 0,
    ver_name: typeof raw.ver_name === 'string' && raw.ver_name ? raw.ver_name : null,
    app_type: raw.app_type === 'fg' || raw.app_type === 'bg' || raw.app_type === 'fg_ext'
      ? raw.app_type
      : null,
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : null,
    preview: typeof raw.preview === 'string' && raw.preview ? raw.preview : null,
    download_url: typeof raw.download_url === 'string' && raw.download_url ? raw.download_url : null,
    badges: Array.isArray(raw.badges)
      ? raw.badges.filter((b): b is string => typeof b === 'string')
      : [],
    zip: typeof raw.zip === 'string' && raw.zip ? raw.zip : null,
    changelog: typeof raw.changelog === 'string' && raw.changelog ? raw.changelog : null,
  }
}

/** 商店条目 vs 设备已装应用:决定卡片状态与按钮文案 */
export function sharedAppInstallState (
  entry: SharedAppEntry,
  installed: RemoteApp[],
): { state: SharedAppInstallState, installedVer: number | null } {
  const app = installed.find(a => a.info.uuid === entry.uuid)
  if (!app) {
    return { state: 'not_installed', installedVer: null }
  }
  const installedVer = app.info.appVer
  if (installedVer === 0 && entry.app_ver > 0) {
    // 旧应用没写 app_ver,无从比较,只给软提示
    return { state: 'maybe_updatable', installedVer }
  }
  if (entry.app_ver > installedVer) {
    return { state: 'updatable', installedVer }
  }
  return { state: 'installed', installedVer }
}

/** 有明确可更新项的 uuid 集合(apps 页角标用) */
export function updatableUuidSet (
  entries: SharedAppEntry[],
  installed: RemoteApp[],
): Set<string> {
  const result = new Set<string>()
  for (const entry of entries) {
    if (sharedAppInstallState(entry, installed).state === 'updatable') {
      result.add(entry.uuid)
    }
  }
  return result
}

export async function downloadSharedAppZipFile (
  entry: SharedAppEntry,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<File> {
  const url = resolveSharedAppUrl(entry.download_url)
  if (!url) {
    throw new Error('该应用没有下载地址')
  }

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`下载失败 (${res.status})`)
  }

  const total = res.headers.get('Content-Length')
    ? Number.parseInt(res.headers.get('Content-Length')!, 10)
    : null

  const filename = entry.zip || `${sanitizeDownloadName(entry.name)}.zip`

  if (!res.body) {
    const blob = await res.blob()
    onProgress?.(blob.size, blob.size)
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
  return new File([blob], filename, { type: 'application/zip' })
}

export async function triggerSharedAppLocalDownload (
  entry: SharedAppEntry,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<void> {
  const file = await downloadSharedAppZipFile(entry, onProgress)
  triggerBlobDownload(file, file.name)
}

function sanitizeDownloadName (name: string): string {
  return name.replace(/[^\w一-鿿.-]+/g, '_').slice(0, 80) || 'app'
}

export function filterSharedApps (
  entries: SharedAppEntry[],
  query: string,
): SharedAppEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) {
    return entries
  }
  return entries.filter(
    e =>
      e.name.toLowerCase().includes(q)
      || e.desc.toLowerCase().includes(q),
  )
}
