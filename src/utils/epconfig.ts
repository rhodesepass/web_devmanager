import type { MaterialInfo } from '@/types/material'

export interface ParsedEpConfig {
  uuid: string
  name: string
  description: string
  screen: string
  iconRelativePath: string | null
}

export function parseEpConfig (json: string, folderName?: string): ParsedEpConfig {
  const obj = JSON.parse(json) as Record<string, unknown>
  const version = typeof obj.version === 'number' ? obj.version : 0
  if (version !== 1) {
    throw new Error(`不支持的 epconfig 版本: ${version}`)
  }

  const uuid = typeof obj.uuid === 'string' ? obj.uuid.trim() : ''
  if (!uuid) {
    throw new Error('epconfig.json 缺少 uuid')
  }

  const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : ''
  const name = nameRaw || folderName || uuid

  const descRaw = typeof obj.description === 'string' ? obj.description.trim() : ''
  const description = descRaw || '(无描述)'

  const screen = typeof obj.screen === 'string' ? obj.screen : ''
  if (!screen) {
    throw new Error('epconfig.json 缺少 screen')
  }

  const iconRaw = typeof obj.icon === 'string' ? obj.icon.trim() : ''
  const iconRelativePath = iconRaw || null

  return { uuid, name, description, screen, iconRelativePath }
}

export function toMaterialInfo (
  parsed: ParsedEpConfig,
  fileCount: number,
  totalBytes: number,
  iconUrl: string | null,
  iconBytes: number | null = null,
): MaterialInfo {
  return {
    uuid: parsed.uuid,
    name: parsed.name,
    description: parsed.description,
    screen: parsed.screen,
    iconRelativePath: parsed.iconRelativePath,
    iconBytes,
    fileCount,
    totalBytes,
    iconUrl,
  }
}
