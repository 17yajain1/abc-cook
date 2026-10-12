/** Pure helpers for the Copy sheet's clipboard row. */

/** The trimmed text if it is a single http(s) URL, else null. */
export function asHttpUrl(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:' ? trimmed : null
  } catch {
    return null
  }
}

export type Platform = 'youtube' | 'instagram' | 'web'

export function platformOfUrl(url: string): Platform {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^www\./, '').replace(/^m\./, '')
  } catch {
    return 'web'
  }
  if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube'
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram'
  return 'web'
}

/** `instagram.com/reel/C8kD2xLp` — the URL without scheme, `www.` or a trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}

interface ClipboardLike {
  readText(): Promise<string>
}
interface PermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: string }>
}

/**
 * Whether opening the sheet may read the clipboard without a prompt. Only when the
 * `clipboard-read` permission already resolves to `granted`; a missing API or a thrown
 * query (Safari, Firefox) means no read at all.
 */
export async function clipboardReadGranted(permissions: PermissionsLike | undefined): Promise<boolean> {
  if (!permissions) return false
  try {
    const status = await permissions.query({ name: 'clipboard-read' })
    return status.state === 'granted'
  } catch {
    return false
  }
}

/** `readText()` or null on any rejection / missing API. */
export async function readClipboardText(clipboard: ClipboardLike | undefined): Promise<string | null> {
  if (!clipboard) return null
  try {
    return await clipboard.readText()
  } catch {
    return null
  }
}
