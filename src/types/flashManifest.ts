export interface FlasherInfo {
  latestVersion: number
  url: string
}

export interface ManifestFile {
  name: string
  hash: string
  type: string
}

export interface ManifestEntry {
  type: string
  title: string
  commit: string
  version: string
  description: string
  minimalFlasherVersion: number
  files: ManifestFile[]
}

export interface MirrorEntry {
  name: string
  url: string
}

export interface FlashManifest {
  flasher: FlasherInfo
  manifest: ManifestEntry[]
  availableMirror: MirrorEntry[]
}
