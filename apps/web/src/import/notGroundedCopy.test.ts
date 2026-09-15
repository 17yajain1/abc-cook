import { describe, expect, it } from 'vitest'

import { notGroundedCopy } from './notGroundedCopy'

describe('notGroundedCopy (A5)', () => {
  it('names the no-captions-no-blog case', () => {
    expect(notGroundedCopy([])).toBe(
      'This video has no captions, and its description lists ingredients without saying how the dish is made.',
    )
    expect(notGroundedCopy(['description'])).toBe(
      'This video has no captions, and its description lists ingredients without saying how the dish is made.',
    )
  })

  it('names the transcript-present case, before blog', () => {
    expect(notGroundedCopy(['transcript'])).toBe(
      "We read this video's captions but couldn't find the method in them.",
    )
    expect(notGroundedCopy(['transcript', 'blog'])).toBe(
      "We read this video's captions but couldn't find the method in them.",
    )
  })

  it('names the blog-present case when there is no transcript', () => {
    expect(notGroundedCopy(['blog'])).toBe(
      'The linked recipe page had no instructions we could use.',
    )
    expect(notGroundedCopy(['description', 'blog'])).toBe(
      'The linked recipe page had no instructions we could use.',
    )
  })
})
