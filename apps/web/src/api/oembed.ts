/** What YouTube's public oEmbed endpoint tells us about a video. */
export interface OEmbed {
  title: string
  channel: string | null
}

const OEMBED_TIMEOUT_MS = 2500

/**
 * Fetch a video's title and channel straight from YouTube's oEmbed endpoint. The browser
 * calls it directly (the endpoint answers CORS for any origin), so there is no API round
 * trip and no cold start in the way. `null` on *any* failure — a video with embedding
 * disabled answers 401, an unknown id 400, and a blocker or a slow network just aborts —
 * because the server's own `acquired` block fills the same gap a few seconds later.
 * `fetchFn` is injectable so the parsing and failure paths test without a network.
 */
export async function fetchOEmbed(
  oembedUrl: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<OEmbed | null> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), OEMBED_TIMEOUT_MS)
  const onOuterAbort = () => timeout.abort()
  signal?.addEventListener('abort', onOuterAbort)
  try {
    const response = await fetchFn(oembedUrl, { signal: timeout.signal })
    if (!response.ok) return null
    const body: unknown = await response.json()
    return parseOEmbed(body)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

export function parseOEmbed(body: unknown): OEmbed | null {
  if (!body || typeof body !== 'object') return null
  const { title, author_name: author } = body as Record<string, unknown>
  if (typeof title !== 'string' || !title.trim()) return null
  return {
    title: title.trim(),
    channel: typeof author === 'string' && author.trim() ? author.trim() : null,
  }
}
