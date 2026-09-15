import type { SourceRef } from '@abc-cook/schema'

/**
 * Collapses a recipe's source into one key so the same recipe saved twice updates one
 * entry instead of creating a duplicate (M2.12 design decision 2). Pure — no I/O.
 */

const TRACKING_PARAM_PREFIXES = ['utm_']
const TRACKING_PARAMS = new Set(['si', 'fbclid', 'igshid'])

/** Extracts a YouTube video id from any of its URL shapes, or `null` if it isn't one. */
export function youtubeVideoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  const segments = parsed.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be') {
    return segments[0] ?? null
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (segments[0] === 'watch') return parsed.searchParams.get('v')
    if (segments[0] === 'shorts' || segments[0] === 'embed' || segments[0] === 'live') {
      return segments[1] ?? null
    }
    return null
  }

  return null
}

/** `url:` + lowercased host (sans `www.`), path (sans trailing `/`), query sans tracking
 * params, no hash — for any non-YouTube URL. */
function canonicalUrlKey(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return `url:${raw.trim().toLowerCase()}`
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const path = parsed.pathname.replace(/\/+$/, '')

  const params = new URLSearchParams(parsed.search)
  for (const key of [...params.keys()]) {
    const lower = key.toLowerCase()
    if (TRACKING_PARAMS.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) {
      params.delete(key)
    }
  }
  params.sort()
  const query = params.toString()

  return `url:${host}${path}${query ? `?${query}` : ''}`
}

/** The canonical dedup key for a graph's source (M2.12 design decision 2). */
export function canonicalSourceKey(source: SourceRef): string {
  if (source.kind !== 'url') return `${source.kind}:${source.value}`

  const videoId = youtubeVideoId(source.value)
  if (videoId) return `youtube:${videoId}`

  return canonicalUrlKey(source.value)
}

/** A thumbnail image for a saved entry, derived from its key — never stored (M2.12
 * design decision 3). `null` when no thumbnail can be derived. */
export function thumbnailUrlFor(sourceKey: string): string | null {
  if (!sourceKey.startsWith('youtube:')) return null
  const id = sourceKey.slice('youtube:'.length)
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
}
