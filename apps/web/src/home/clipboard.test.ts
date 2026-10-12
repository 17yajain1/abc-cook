import { describe, expect, it } from 'vitest'

import {
  asHttpUrl,
  clipboardReadGranted,
  displayUrl,
  platformOfUrl,
  readClipboardText,
} from './clipboard'

describe('asHttpUrl', () => {
  it('accepts a single http(s) URL and trims it', () => {
    expect(asHttpUrl('  https://instagram.com/reel/C8kD2xLp/ \n')).toBe(
      'https://instagram.com/reel/C8kD2xLp/',
    )
  })
  it('rejects prose, other schemes and empties', () => {
    expect(asHttpUrl('2 cups flour and a pinch of salt')).toBeNull()
    expect(asHttpUrl('see https://example.com now')).toBeNull()
    expect(asHttpUrl('javascript:alert(1)')).toBeNull()
    expect(asHttpUrl('')).toBeNull()
  })
})

describe('platformOfUrl / displayUrl', () => {
  it('names the platform', () => {
    expect(platformOfUrl('https://www.youtube.com/watch?v=x')).toBe('youtube')
    expect(platformOfUrl('https://youtu.be/x')).toBe('youtube')
    expect(platformOfUrl('https://m.instagram.com/reel/x')).toBe('instagram')
    expect(platformOfUrl('https://example.com/recipe')).toBe('web')
  })
  it('strips scheme, www and a trailing slash', () => {
    expect(displayUrl('https://www.instagram.com/reel/C8kD2xLp/')).toBe('instagram.com/reel/C8kD2xLp')
  })
})

describe('clipboard permission gate', () => {
  it('reads only when permission is already granted', async () => {
    expect(await clipboardReadGranted({ query: async () => ({ state: 'granted' }) })).toBe(true)
    expect(await clipboardReadGranted({ query: async () => ({ state: 'prompt' }) })).toBe(false)
    expect(await clipboardReadGranted({ query: async () => ({ state: 'denied' }) })).toBe(false)
  })
  it('treats a missing API or a thrown query as not granted', async () => {
    expect(await clipboardReadGranted(undefined)).toBe(false)
    expect(
      await clipboardReadGranted({
        query: async () => {
          throw new TypeError('clipboard-read is not a valid permission name')
        },
      }),
    ).toBe(false)
  })
  it('readClipboardText swallows a rejection and a missing API', async () => {
    expect(await readClipboardText(undefined)).toBeNull()
    expect(
      await readClipboardText({
        readText: async () => {
          throw new DOMException('denied', 'NotAllowedError')
        },
      }),
    ).toBeNull()
    expect(await readClipboardText({ readText: async () => 'hi' })).toBe('hi')
  })
})
