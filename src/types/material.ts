export type MaterialStorage = 'nand' | 'sd'

export interface MaterialInfo {
  uuid: string
  name: string
  description: string
  screen: string
  iconRelativePath: string | null
  iconBytes: number | null
  fileCount: number
  totalBytes: number
  iconUrl: string | null
}

export interface RemoteMaterial {
  info: MaterialInfo
  storage: MaterialStorage
  /** 设备上实际目录名。目录名任意（≠uuid），删除/下载/读图标都用它拼路径 */
  dirName: string
  listKey: string
}

/** 素材列表加载进度：先逐目录读元数据，再后台补图标 */
export interface MaterialLoadProgress {
  phase: 'list' | 'meta' | 'icon'
  done: number
  total: number
  label: string
}

export interface TransferProgress {
  fileName: string
  bytes: number
  total: number
  isUpload: boolean
}

export interface MaterialStorageConfig {
  storage: MaterialStorage
  assetsBasePath: string
  displayLabel: string
  desireStorage: string
}

/** asset2share manifest.json 单条素材 */
export interface SharedMaterialAsset {
  uuid: string
  name: string
  desc: string
  icon: string | null
  preview: string | null
  download_url: string | null
  badges: string[]
  zip: string | null
}

export const MATERIAL_STORAGES: Record<MaterialStorage, MaterialStorageConfig> = {
  nand: {
    storage: 'nand',
    assetsBasePath: 'assets',
    displayLabel: '系统盘',
    desireStorage: 'nand',
  },
  sd: {
    storage: 'sd',
    assetsBasePath: 'sd/assets',
    displayLabel: '数据盘',
    desireStorage: 'sd',
  },
}
