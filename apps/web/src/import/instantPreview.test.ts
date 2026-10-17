import { describe, expect, it } from 'vitest'

import { instantPreviewFor } from './instantPreview'

const ID = 'dQw4w9WgXcQ'

describe('instantPreviewFor', () => {
  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['mobile watch', `https://m.youtube.com/watch?v=${ID}&t=30s`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['youtu.be share link', `https://youtu.be/${ID}?si=abc123`],
    ['embed', `https://www.youtube.com/embed/${ID}`],
  ])('derives the thumbnail and oEmbed URL from a %s link', (_name, url) => {
    const preview = instantPreviewFor(url)
    expect(preview).not.toBeNull()
    expect(preview?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`)
  })

  it('builds the oEmbed URL from the canonical watch URL, encoded', () => {
    const preview = instantPreviewFor(`https://youtu.be/${ID}?si=zzz`)
    expect(preview?.oembedUrl).toBe(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)}&format=json`,
    )
    // The inner URL must not leak its own `?` or `&` into the outer query string.
    const outer = new URL(preview?.oembedUrl ?? '')
    expect(outer.searchParams.get('url')).toBe(`https://www.youtube.com/watch?v=${ID}`)
    expect(outer.searchParams.get('format')).toBe('json')
  })

  it('tolerates surrounding whitespace from a paste', () => {
    expect(instantPreviewFor(`  https://youtu.be/${ID}\n`)).not.toBeNull()
  })

  it.each([
    'https://www.instagram.com/reel/CWqAgUZgCku/',
    'https://kitchen.example/recipes/dal',
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/watch',
    'not a url',
    '',
  ])('returns null for %s', (url) => {
    expect(instantPreviewFor(url)).toBeNull()
  })
})
