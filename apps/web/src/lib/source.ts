import { platformOfUrl } from '@/home/clipboard'

/**
 * R2: the recipe page's "From YouTube ↗" link. `null` (no line drawn) when there is no URL,
 * it doesn't parse, or it isn't http(s) — never a link the browser would treat as script.
 */
export function sourceLink(url: string | null | undefined): { name: string; href: string } | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null

  const platform = platformOfUrl(url)
  const name =
    platform === 'youtube' ? 'YouTube' : platform === 'instagram' ? 'Instagram' : parsed.hostname.replace(/^www\./, '')
  return { name, href: parsed.href }
}
