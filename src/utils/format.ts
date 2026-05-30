const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export function formatBytes (bytes: number): string {
  if (bytes === 0) return '0 B'
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const idx = Math.min(i, units.length - 1)
  const val = bytes / Math.pow(1024, idx)
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[idx]}`
}

export function formatPerm (perm: string): string {
  const n = parseInt(perm, 8)
  const chars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx']
  return chars[(n >> 6) & 7] + chars[(n >> 3) & 7] + chars[n & 7]
}
