export type MaterialStorage = 'nand' | 'sd'

export interface MaterialInfo {
  uuid: string
  name: string
  description: string
  screen: string
  iconRelativePath: string | null
  fileCount: number
  totalBytes: number
  iconUrl: string | null
}

export interface RemoteMaterial {
  info: MaterialInfo
  storage: MaterialStorage
  listKey: string
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
    displayLabel: 'NAND',
    desireStorage: 'nand',
  },
  sd: {
    storage: 'sd',
    assetsBasePath: 'sd/assets',
    displayLabel: 'SD',
    desireStorage: 'sd',
  },
}
