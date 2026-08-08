export function formatUs (us: number): string {
  return (us / 1_000_000).toFixed(2) + 's'
}
