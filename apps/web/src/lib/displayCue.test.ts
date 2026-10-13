import { describe, expect, it } from 'vitest'

import { displayCue } from './displayCue'

describe('displayCue (D4 stopgap)', () => {
  it('keeps an English cue unchanged', () => {
    expect(displayCue('the pearls turn translucent')).toBe('the pearls turn translucent')
  })

  it('keeps accented Latin letters, digits and punctuation', () => {
    expect(displayCue('sauté 2–3 min, until golden (not brown)')).toBe(
      'sauté 2–3 min, until golden (not brown)',
    )
  })

  it('hides a Hindi cue quoted verbatim from a transcript', () => {
    expect(displayCue('जब आपको लगे कि आलू अच्छे से कुक हो गया है')).toBeNull()
    expect(displayCue('ट्रांसलूसेंट हो गया है')).toBeNull()
  })

  it('hides a mixed-script cue rather than showing half of it', () => {
    expect(displayCue('until आलू are soft')).toBeNull()
  })

  it('hides other non-Latin scripts too', () => {
    expect(displayCue('நன்றாக வதக்கவும்')).toBeNull()
  })

  it('is null for a missing or blank cue', () => {
    expect(displayCue(null)).toBeNull()
    expect(displayCue('   ')).toBeNull()
  })
})
