import JSZip from 'jszip'
import { parseAppConfig } from './appconfig'
import { flattenZipPath, type ZipMaterialFile } from './zipMaterial'

const MAX_FILE_SIZE = 200 * 1024 * 1024

export interface ExtractedApp {
  uuid: string
  name: string
  appVer: number
  files: ZipMaterialFile[]
}

export async function extractAppFromZip (blob: Blob): Promise<ExtractedApp> {
  const zip = await JSZip.loadAsync(blob)
  const configEntries = Object.entries(zip.files).filter(([name, entry]) => {
    if (entry.dir) {
      return false
    }
    const base = name.replace(/\\/g, '/').split('/').pop()
    return base === 'appconfig.json'
  })
  if (configEntries.length === 0) {
    throw new Error('zip 中未找到 appconfig.json')
  }
  if (configEntries.length > 1) {
    throw new Error('zip 中包含多个 appconfig.json，请只打包一个 App')
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

  if (!flattened.has('appconfig.json')) {
    throw new Error('zip 中未找到 appconfig.json')
  }

  const configText = await flattened.get('appconfig.json')!.async('string')
  const parsed = parseAppConfig(configText)

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
    appVer: parsed.appVer,
    files,
  }
}
