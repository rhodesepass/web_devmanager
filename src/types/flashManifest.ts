export type FlashTarget = 'nand' | 'sd'

/** 一个可烧录角色对应的固件文件（含校验信息） */
export interface ManifestFile {
  name: string
  sha256: string
  size: number
}

/** 某个存储目标（nand/sd）下各角色 -> 文件名的映射 */
export interface TargetFiles {
  felboot: string
  uboot: string
  boot: string
  rootfs: string
}

export interface ManifestEntry {
  version: string
  channel: string
  title: string
  commit: string
  description: string
  targets: Record<FlashTarget, TargetFiles>
  files: ManifestFile[]
}

export interface MirrorEntry {
  name: string
  url: string
}

export interface FlashManifest {
  schema: number
  generatedAt: string
  manifest: ManifestEntry[]
  availableMirror: MirrorEntry[]
}

export type FileRole = keyof TargetFiles
