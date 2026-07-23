import type { AppInfo, AppType } from '@/types/app'

export interface ParsedAppConfig {
  uuid: string
  name: string
  description: string
  type: AppType
  screens: string[]
  executable: string
  extensions: string[]
  appVer: number
  iconRelativePath: string | null
}

const APP_TYPES: readonly AppType[] = ['fg', 'bg', 'fg_ext']

export function parseAppConfig (json: string, folderName?: string): ParsedAppConfig {
  const obj = JSON.parse(json) as Record<string, unknown>
  const version = typeof obj.version === 'number' ? obj.version : 0
  // 固件 APPS_CONFIG_VERSION 当前为 2（v2 = v1 + 必填 screens）；本解析器本就
  // 强制 screens，兼容读取两个版本
  if (version !== 1 && version !== 2) {
    throw new Error(`不支持的 appconfig 版本: ${version}`)
  }

  const uuid = typeof obj.uuid === 'string' ? obj.uuid.trim() : ''
  if (!uuid) {
    throw new Error('appconfig.json 缺少 uuid')
  }

  const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : ''
  const name = nameRaw || folderName || uuid

  const descRaw = typeof obj.description === 'string' ? obj.description.trim() : ''
  const description = descRaw || '(无描述)'

  // executable 支持对象 {file:"..."} 或直接字符串（对应设备端两种写法）
  const execObj = obj.executable
  let executable = ''
  if (execObj && typeof execObj === 'object' && !Array.isArray(execObj)) {
    const file = (execObj as Record<string, unknown>).file
    executable = typeof file === 'string' ? file.trim() : ''
  } else if (typeof execObj === 'string') {
    executable = execObj.trim()
  }
  if (!executable) {
    throw new Error('appconfig.json 缺少可执行文件 executable')
  }

  const typeRaw = typeof obj.type === 'string' ? obj.type.trim() : ''
  if (!APP_TYPES.includes(typeRaw as AppType)) {
    throw new Error(`appconfig.json type 不合法: ${typeRaw || '(空)'}`)
  }
  const type = typeRaw as AppType

  const screens = Array.isArray(obj.screens)
    ? obj.screens.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    : []
  if (screens.length === 0) {
    throw new Error('appconfig.json 缺少 screens')
  }

  const extensions = Array.isArray(obj.extensions)
    ? obj.extensions.filter((e): e is string => typeof e === 'string' && e.trim() !== '')
    : []

  const iconRaw = typeof obj.icon === 'string' ? obj.icon.trim() : ''
  const iconRelativePath = iconRaw || null

  // 可选字段:应用版本号(与 schema version 无关),缺失/非法视为 0(未知),绝不报错
  const appVer = typeof obj.app_ver === 'number'
    && Number.isInteger(obj.app_ver) && obj.app_ver >= 0
    ? obj.app_ver
    : 0

  return { uuid, name, description, type, screens, executable, extensions, appVer, iconRelativePath }
}

export function toAppInfo (
  parsed: ParsedAppConfig,
  fileCount: number,
  totalBytes: number,
  iconUrl: string | null,
  iconBytes: number | null = null,
): AppInfo {
  return {
    uuid: parsed.uuid,
    name: parsed.name,
    description: parsed.description,
    type: parsed.type,
    screens: parsed.screens,
    executable: parsed.executable,
    extensions: parsed.extensions,
    appVer: parsed.appVer,
    iconRelativePath: parsed.iconRelativePath,
    iconBytes,
    fileCount,
    totalBytes,
    iconUrl,
  }
}
