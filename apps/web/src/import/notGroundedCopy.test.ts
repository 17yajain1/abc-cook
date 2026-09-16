import { describe, expect, it } from 'vitest'

import { notGroundedCopy } from './notGroundedCopy'

describe('notGroundedCopy (A5 / A1.1)', () => {
  it('names the description-with-ingredients case', () => {
    expect(notGroundedCopy(['description'], true)).toBe(
      'This video has no captions, and its description lists ingredients without saying how the dish is made.',
    )
    expect(notGroundedCopy([], true)).toBe(
      'This video has no captions, and its description lists ingredients without saying how the dish is made.',
    )
  })

  it('falls back honestly when the description exists but no ingredients were found', () => {
    expect(notGroundedCopy(['description'], false)).toBe(
      "We couldn't find usable ingredients or instructions for this recipe.",
    )
  })

  it('names the transcript-present case, before blog, regardless of ingredients', () => {
    expect(notGroundedCopy(['transcript'], true)).toBe(
      "We read this video's captions but couldn't find the method in them.",
    )
    expect(notGroundedCopy(['transcript'], false)).toBe(
      "We read this video's captions but couldn't find the method in them.",
    )
    expect(notGroundedCopy(['transcript', 'blog'], true)).toBe(
      "We read this video's captions but couldn't find the method in them.",
    )
  })

  it('names the blog-present case when there is no transcript, regardless of ingredients', () => {
    expect(notGroundedCopy(['blog'], true)).toBe(
      'The linked recipe page had no instructions we could use.',
    )
    expect(notGroundedCopy(['blog'], false)).toBe(
      'The linked recipe page had no instructions we could use.',
    )
    expect(notGroundedCopy(['description', 'blog'], true)).toBe(
      'The linked recipe page had no instructions we could use.',
    )
  })

  it('names the completely empty case: no description, no transcript, no blog/method', () => {
    expect(notGroundedCopy([], false)).toBe(
      "We couldn't find usable ingredients or instructions for this recipe.",
    )
  })
})
