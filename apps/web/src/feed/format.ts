const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** `1 save`, `412 saves`, `1.2k saves`. The count is social, from the server — never a
 * cooking figure. */
export function formatSaves(n: number): string {
  if (n === 1) return '1 save'
  if (n < 1000) return `${n} saves`
  const k = Math.floor(n / 100) / 10
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k saves`
}

/** `just now`, `5m ago`, `2h ago`, `3d ago`, `2w ago`. `now` is injected (epoch ms). */
export function formatAgo(publishedAt: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(publishedAt))
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`
  if (elapsed < 14 * DAY) return `${Math.floor(elapsed / DAY)}d ago`
  return `${Math.floor(elapsed / (7 * DAY))}w ago`
}

/** The meta line's right side: `1.2k saves, 2h ago`. */
export function formatSavesAgo(saves: number, publishedAt: string, now: number): string {
  return `${formatSaves(saves)}, ${formatAgo(publishedAt, now)}`
}
