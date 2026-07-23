import type { MaterialStorage, TransferProgress } from './material'

export type AppStorage = MaterialStorage

export type { TransferProgress }

/** appconfig.json 的 type 字段：前台 / 后台 / 仅按扩展名启动 */
export type AppType = 'fg' | 'bg' | 'fg_ext'

export interface AppInfo {
  uuid: string
  name: string
  description: string
  type: AppType
  screens: string[]
  executable: string
  extensions: string[]
  /** appconfig.json 可选 app_ver(单调递增整数),缺失视为 0(版本未知) */
  appVer: number
  iconRelativePath: string | null
  iconBytes: number | null
  fileCount: number
  totalBytes: number
  iconUrl: string | null
}

/** app2share manifest.json 单条应用 */
export interface SharedAppEntry {
  uuid: string
  name: string
  desc: string
  /** 版本比较用,与 zip 内 appconfig.json 的 app_ver 保持一致 */
  app_ver: number
  /** UI 展示用的人类可读版本,如 "1.2.0" */
  ver_name: string | null
  app_type: AppType | null
  icon: string | null
  preview: string | null
  download_url: string | null
  badges: string[]
  zip: string | null
  changelog: string | null
}

/** 商店条目相对已装应用的状态 */
export type SharedAppInstallState
  = 'not_installed' | 'installed' | 'updatable' | 'maybe_updatable'

export interface RemoteApp {
  info: AppInfo
  storage: AppStorage
  /** 设备上实际目录名。App 目录名任意（≠uuid），删除/下载/读图标都用它拼路径 */
  dirName: string
  listKey: string
}

export interface AppStorageConfig {
  storage: AppStorage
  appsBasePath: string
  displayLabel: string
}

export const APP_STORAGES: Record<AppStorage, AppStorageConfig> = {
  nand: {
    storage: 'nand',
    appsBasePath: 'app',
    displayLabel: '系统盘',
  },
  sd: {
    storage: 'sd',
    appsBasePath: 'sd/app',
    displayLabel: '数据盘',
  },
}

export const APP_TYPE_LABELS: Record<AppType, string> = {
  fg: '前台',
  bg: '后台',
  fg_ext: '扩展启动',
}
