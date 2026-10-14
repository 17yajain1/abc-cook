import { describe, expect, it } from 'vitest'

import { sourceLink } from './source'

describe('sourceLink', () => {
  it.each([
    ['https://www.youtube.com/watch?v=oHHFafPET90&t=9s', 'YouTube'],
    ['https://youtu.be/WM1XcYXix0Y', 'YouTube'],
    ['https://m.youtube.com/watch?v=abc', 'YouTube'],
    ['https://www.instagram.com/reel/C8kD2xLp/', 'Instagram'],
    ['https://www.example.com/recipes/dal', 'example.com'],
    ['https://cooking.example.org/x', 'cooking.example.org'],
  ])('%s -> %s', (url, name) => {
    expect(sourceLink(url)).toEqual({ name, href: new URL(url).href })
  })

  it('is null for no URL', () => {
    expect(sourceLink(null)).toBeNull()
    expect(sourceLink(undefined)).toBeNull()
    expect(sourceLink('')).toBeNull()
  })

  it('is null for an invalid or non-http URL', () => {
    expect(sourceLink('not a url')).toBeNull()
    expect(sourceLink('javascript:alert(1)')).toBeNull()
  })
})
