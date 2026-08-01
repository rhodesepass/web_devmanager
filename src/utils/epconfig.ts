import type { MaterialInfo } from '@/types/material'

export interface ParsedEpConfig {
  uuid: string
  name: string
  description: string
  screen: string
  iconRelativePath: string | null
}

/** 与固件 PRTS_ASSET_VERSION_NUMBER 一致（a3.0-rc1+ 为 2），仅 version > 该值时拒绝 */
const EPCONFIG_MAX_VERSION = 2

export function parseEpConfig (json: string, folderName?: string): ParsedEpConfig {
  const obj = JSON.parse(json) as Record<string, unknown>
  if (typeof obj.version !== 'number' || obj.version > EPCONFIG_MAX_VERSION) {
    throw new Error(`不支持的 epconfig 版本: ${obj.version}`)
  }

  const uuid = typeof obj.uuid === 'string' ? obj.uuid.trim() : ''
  if (!uuid) {
    throw new Error('epconfig.json 缺少 uuid')
  }

  const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : ''
  const name = nameRaw || folderName || uuid

  const descRaw = typeof obj.description === 'string' ? obj.description.trim() : ''
  const description = descRaw || '(无描述)'

  // v2 起 screen 可选，只声明素材原生分辨率，固件不再据此拒绝
  const screen = typeof obj.screen === 'string' ? obj.screen : ''

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
