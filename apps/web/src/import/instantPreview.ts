import { thumbnailUrlFor, youtubeVideoId } from '../library/sourceKey'

/**
 * What can be shown for a YouTube link the moment it is submitted, before the API has
 * answered: the thumbnail (derived from the video id, so no request is needed to know its
 * URL) and the address of YouTube's public oEmbed endpoint for the title and channel.
 * Pure — no I/O. Instagram's oEmbed needs auth, so only YouTube gets an instant preview.
 */
export interface InstantPreview {
  thumbnailUrl: string
  oembedUrl: string
}

/** The header the import screen can draw before any server answer. `title` and `channel`
 * fill in when oEmbed answers; until then (or if it never does) only the thumbnail shows. */
export interface InstantHeader {
  thumbnailUrl: string
  title: string | null
  channel: string | null
}

export function instantPreviewFor(url: string): InstantPreview | null {
  const id = youtubeVideoId(url.trim())
  if (!id) return null
  const thumbnailUrl = thumbnailUrlFor(`youtube:${id}`)
  if (!thumbnailUrl) return null
  const watch = `https://www.youtube.com/watch?v=${id}`
  return {
    thumbnailUrl,
    oembedUrl: `https://www.youtube.com/oembed?url=${encodeURIComponent(watch)}&format=json`,
  }
}
