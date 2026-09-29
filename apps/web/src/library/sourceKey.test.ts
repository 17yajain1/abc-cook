import { describe, expect, it } from 'vitest'

import type { SourceRef } from '@abc-cook/schema'

import { canonicalSourceKey, instagramShortcode, thumbnailUrlFor, youtubeVideoId } from './sourceKey'

function urlSource(value: string): SourceRef {
  return { kind: 'url', value, imported_at: '2026-09-15T00:00:00Z' }
}

describe('canonicalSourceKey — YouTube', () => {
  it('collapses the owner test URL and its equivalent forms to one key', () => {
    const a = canonicalSourceKey(urlSource('https://youtu.be/nF8krMx7OxA?si=6ZkZIzKDjRjBeu8Z&'))
    const b = canonicalSourceKey(
      urlSource('https://www.youtube.com/watch?v=nF8krMx7OxA&t=42s'),
    )
    const c = canonicalSourceKey(urlSource('https://m.youtube.com/shorts/nF8krMx7OxA'))

    expect(a).toBe('youtube:nF8krMx7OxA')
    expect(b).toBe('youtube:nF8krMx7OxA')
    expect(c).toBe('youtube:nF8krMx7OxA')
  })

  it('reads embed and live paths too', () => {
    expect(youtubeVideoId('https://youtube.com/embed/abc123')).toBe('abc123')
    expect(youtubeVideoId('https://www.youtube.com/live/abc123?feature=share')).toBe('abc123')
  })

  it('returns null for a non-YouTube host', () => {
    expect(youtubeVideoId('https://vimeo.com/watch?v=abc123')).toBeNull()
  })
})

describe('canonicalSourceKey — Instagram', () => {
  it('collapses /reel/, /reels/ and the username-prefixed shape to one key', () => {
    // The username-prefixed shape is a confirmed real form (yt-dlp's own Instagram
    // extractor test fixture: instagram.com/marvelskies.fc/reel/CWqAgUZgCku/), not
    // just a defensive guess -- see instagramShortcode's docstring.
    const a = canonicalSourceKey(urlSource('https://www.instagram.com/reel/Abc123/'))
    const b = canonicalSourceKey(urlSource('https://instagram.com/reels/Abc123/'))
    const c = canonicalSourceKey(
      urlSource('https://www.instagram.com/marvelskies.fc/reel/Abc123/'),
    )

    expect(a).toBe('instagram:Abc123')
    expect(b).toBe('instagram:Abc123')
    expect(c).toBe('instagram:Abc123')
  })

  it('strips tracking params (igshid) via the shortcode path, same as before', () => {
    const key = canonicalSourceKey(
      urlSource('https://www.instagram.com/reel/Abc123/?igshid=xyz&utm_source=ig'),
    )
    expect(key).toBe('instagram:Abc123')
  })

  it('returns null for a non-Instagram host or a non-reel Instagram path', () => {
    expect(instagramShortcode('https://vimeo.com/reel/Abc123')).toBeNull()
    expect(instagramShortcode('https://www.instagram.com/someuser/')).toBeNull()
    expect(instagramShortcode('https://www.instagram.com/p/Abc123/')).toBeNull()
  })

  it('falls back to the generic URL key for a non-reel Instagram link', () => {
    const key = canonicalSourceKey(urlSource('https://www.instagram.com/someuser/'))
    expect(key).toBe('url:instagram.com/someuser')
  })
})

describe('canonicalSourceKey — other URLs', () => {
  it('normalises host case, www., utm_ params, hash and trailing slash', () => {
    const a = canonicalSourceKey(
      urlSource('https://WWW.Example.com/Recipes/dal/?utm_source=ig&ref=x#top'),
    )
    const b = canonicalSourceKey(urlSource('https://example.com/Recipes/dal?ref=x'))

    expect(a).toBe(b)
    expect(a).toBe('url:example.com/Recipes/dal?ref=x')
  })

  it('strips si/fbclid/igshid alongside utm_*', () => {
    const key = canonicalSourceKey(
      urlSource('https://example.com/page?si=1&fbclid=2&igshid=3&keep=yes'),
    )
    expect(key).toBe('url:example.com/page?keep=yes')
  })
})

describe('canonicalSourceKey — non-URL sources', () => {
  it('passes text sources through as kind:value', () => {
    expect(canonicalSourceKey({ kind: 'text', value: 'chop onion', imported_at: '2026-09-15T00:00:00Z' })).toBe(
      'text:chop onion',
    )
  })

  it('does not throw on a garbage URL value', () => {
    expect(() => canonicalSourceKey(urlSource('not a url at all'))).not.toThrow()
    expect(canonicalSourceKey(urlSource('not a url at all'))).toBe('url:not a url at all')
  })
})

describe('thumbnailUrlFor', () => {
  it('derives a hqdefault thumbnail for a youtube key', () => {
    expect(thumbnailUrlFor('youtube:nF8krMx7OxA')).toBe(
      'https://i.ytimg.com/vi/nF8krMx7OxA/hqdefault.jpg',
    )
  })

  it('returns null for anything else', () => {
    expect(thumbnailUrlFor('instagram:Abc123')).toBeNull() // no derivable public thumbnail
    expect(thumbnailUrlFor('url:example.com/page')).toBeNull()
    expect(thumbnailUrlFor('text:chop onion')).toBeNull()
  })
})
