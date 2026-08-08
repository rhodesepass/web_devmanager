import JSZip from 'jszip'
import { parseEpConfig } from './epconfig'

const MAX_FILE_SIZE = 200 * 1024 * 1024

export interface ZipMaterialFile {
  name: string
  data: Uint8Array
}

export interface ExtractedMaterial {
  uuid: string
  name: string
  files: ZipMaterialFile[]
}

/** 与 Android ZipImport.flattenPath 一致：去掉单层顶层目录并拒绝路径穿越 */
export function flattenZipPath (raw: string): string | null {
  if (raw.startsWith('/')) {
    return null
  }
  const parts = raw.split('/').filter(Boolean)
  if (parts.length === 0) {
    return null
  }
  const effective = parts.length > 1 ? parts.slice(1) : parts
  if (effective.includes('..')) {
    return null
  }
  return effective.join('/')
}

export async function extractMaterialFromZip (blob: Blob): Promise<ExtractedMaterial> {
  const zip = await JSZip.loadAsync(blob)
  const epconfigEntries = Object.entries(zip.files).filter(([name, entry]) => {
    if (entry.dir) {
      return false
    }
    const base = name.replace(/\\/g, '/').split('/').pop()
    return base === 'epconfig.json'
  })
  if (epconfigEntries.length === 0) {
    throw new Error('zip 中未找到 epconfig.json')
  }
  if (epconfigEntries.length > 1) {
    throw new Error('zip 中包含多个 epconfig.json，请只打包一个素材')
  }

  const flattened = new Map<string, JSZip.JSZipObject>()

  for (const [raw, entry] of Object.entries(zip.files)) {
    if (entry.dir) {
      continue
    }
    const name = flattenZipPath(raw)
    if (!name) {
      continue
    }
    flattened.set(name, entry)
  }

  if (!flattened.has('epconfig.json')) {
    throw new Error('zip 中未找到 epconfig.json')
  }

  const configText = await flattened.get('epconfig.json')!.async('string')
  const parsed = parseEpConfig(configText)

  const files: ZipMaterialFile[] = []
  for (const [name, entry] of flattened) {
    const data = await entry.async('uint8array')
    if (data.byteLength > MAX_FILE_SIZE) {
      throw new Error(`文件过大: ${name}`)
    }
    files.push({ name, data })
  }

  return {
    uuid: parsed.uuid,
    name: parsed.name,
    files,
  }
}

export async function buildMaterialZip (
  files: { name: string, data: Uint8Array }[],
): Promise<Blob> {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.name, file.data)
  }
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

/** 无压缩（STORE）打包：工程备份用——内容主要是已压缩的视频，DEFLATE 白费时间 */
export async function buildStoredZip (
  files: { name: string, data: Uint8Array | Blob }[],
): Promise<Blob> {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.name, file.data)
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' })
}

export function triggerBlobDownload (blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function sanitizeZipFilename (name: string): string {
  return name.replace(/[^\w\u4E00-\u9FFF.-]+/g, '_').slice(0, 80) || 'material'
}
