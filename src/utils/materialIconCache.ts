const STORAGE_PREFIX = 'devman:material-icon:'

interface MaterialIconCacheEntry {
  size: number
  mime: string
  data: string
}

export function getCachedMaterialIcon (
  uuid: string,
  expectedSize: number,
): { bytes: Uint8Array, mime: string } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${uuid}`)
    if (!raw) {
      return null
    }
    const entry = JSON.parse(raw) as MaterialIconCacheEntry
    if (
      entry.size !== expectedSize
      || typeof entry.data !== 'string'
      || typeof entry.mime !== 'string'
      || !entry.data
    ) {
      return null
    }
    return { bytes: base64ToBytes(entry.data), mime: entry.mime }
  } catch {
    return null
  }
}

export function setCachedMaterialIcon (
  uuid: string,
  size: number,
  mime: string,
  bytes: Uint8Array,
): void {
  try {
    const entry: MaterialIconCacheEntry = {
      size,
      mime,
      data: bytesToBase64(bytes),
    }
    localStorage.setItem(`${STORAGE_PREFIX}${uuid}`, JSON.stringify(entry))
  } catch {
    // quota exceeded or private mode — ignore
  }
}

export function removeCachedMaterialIcon (uuid: string): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${uuid}`)
  } catch {
    // ignore
  }
}

export function clearAllMaterialIconCache (): number {
  let removed = 0
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
      removed += 1
    }
  } catch {
    // ignore
  }
  return removed
}

function bytesToBase64 (bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes (base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
