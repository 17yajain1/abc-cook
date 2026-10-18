import { describe, expect, it } from 'vitest'

import { addedStepLabel } from './addedStep'

const url = (value: string) => ({ kind: 'url', value })

describe('addedStepLabel (FGC-3)', () => {
  it('says "not in the video" for a YouTube or Instagram source', () => {
    for (const value of [
      'https://www.youtube.com/watch?v=abc',
      'https://youtu.be/abc',
      'https://m.youtube.com/watch?v=abc',
      'https://www.instagram.com/reel/abc/',
    ]) {
      expect(addedStepLabel(url(value))).toBe('Added by ABC Cook, not in the video')
    }
  })

  it('says "not in the recipe" for a blog, pasted text, a photo or no source at all', () => {
    expect(addedStepLabel(url('https://example.com/a-recipe'))).toBe(
      'Added by ABC Cook, not in the recipe',
    )
    expect(addedStepLabel({ kind: 'text', value: 'Mix. Bake.' })).toBe(
      'Added by ABC Cook, not in the recipe',
    )
    expect(addedStepLabel({ kind: 'image', value: 'photo.jpg' })).toBe(
      'Added by ABC Cook, not in the recipe',
    )
    expect(addedStepLabel(null)).toBe('Added by ABC Cook, not in the recipe')
    expect(addedStepLabel(undefined)).toBe('Added by ABC Cook, not in the recipe')
  })

  it('does not treat pasted text that mentions a video link as a video source', () => {
    expect(addedStepLabel({ kind: 'text', value: 'see https://youtu.be/abc for the video' })).toBe(
      'Added by ABC Cook, not in the recipe',
    )
  })
})
