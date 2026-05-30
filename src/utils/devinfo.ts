/** PRETTY_NAME from /etc/os-release (full rootfs KV value). */
export function extractPrettyName (rootfs: string): string | null {
  const line = rootfs.split('\n').find(l => l.startsWith('PRETTY_NAME='))
  if (!line) return null
  return line.slice('PRETTY_NAME='.length).replace(/^"|"$/g, '').trim() || null
}

/** APP_VERSION from `epass_drm_app version` stdout. */
export function extractAppVersion (raw: string): string | null {
  const line = raw.split('\n').find(l => l.startsWith('APP_VERSION:'))
  if (!line) return null
  return line.slice('APP_VERSION:'.length).trim() || null
}
