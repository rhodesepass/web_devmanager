interface IconCacheEntry {
  size: number
  mime: string
  data: string
}

export interface IconCache {
  get (uuid: string, expectedSize: number): { bytes: Uint8Array, mime: string } | null
  set (uuid: string, size: number, mime: string, bytes: Uint8Array): void
  remove (uuid: string): void
  clearAll (): number
}

/** localStorage 图标缓存。key = prefix+uuid，按 uuid+size 校验，避免旧图错乱。 */
export function makeIconCache (prefix: string): IconCache {
  return {
    get (uuid, expectedSize) {
      try {
        const raw = localStorage.getItem(`${prefix}${uuid}`)
        if (!raw) {
          return null
        }
        const entry = JSON.parse(raw) as IconCacheEntry
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
    },

    set (uuid, size, mime, bytes) {
      try {
        const entry: IconCacheEntry = { size, mime, data: bytesToBase64(bytes) }
        localStorage.setItem(`${prefix}${uuid}`, JSON.stringify(entry))
      } catch {
        // quota exceeded or private mode — ignore
      }
    },

    remove (uuid) {
      try {
        localStorage.removeItem(`${prefix}${uuid}`)
      } catch {
        // ignore
      }
    },

    clearAll () {
      let removed = 0
      try {
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith(prefix)) {
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
    },
  }
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
