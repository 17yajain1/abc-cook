import { describe, expect, it } from 'vitest'

import type { SourceRef } from '@abc-cook/schema'

import { canonicalSourceKey, thumbnailUrlFor, youtubeVideoId } from './sourceKey'

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
    expect(thumbnailUrlFor('url:example.com/page')).toBeNull()
    expect(thumbnailUrlFor('text:chop onion')).toBeNull()
  })
})
