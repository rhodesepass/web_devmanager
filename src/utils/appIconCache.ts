import { makeIconCache } from './iconCache'

const cache = makeIconCache('devman:app-icon:')

export function getCachedAppIcon (
  uuid: string,
  expectedSize: number,
): { bytes: Uint8Array, mime: string } | null {
  return cache.get(uuid, expectedSize)
}

export function setCachedAppIcon (
  uuid: string,
  size: number,
  mime: string,
  bytes: Uint8Array,
): void {
  cache.set(uuid, size, mime, bytes)
}

export function removeCachedAppIcon (uuid: string): void {
  cache.remove(uuid)
}

export function clearAllAppIconCache (): number {
  return cache.clearAll()
}
