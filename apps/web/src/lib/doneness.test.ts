import { describe, expect, it } from 'vitest'

import { cueShownWith } from './doneness'

describe('cueShownWith', () => {
  it('hides a cue the instruction already ends with', () => {
    expect(cueShownWith('Heat the milk. Bring to one boil and take off the fire.', 'bring to one boil')).toBeNull()
  })

  it('ignores case, punctuation and spacing when comparing', () => {
    expect(cueShownWith('Fry till golden,  brown.', 'Golden brown')).toBeNull()
    expect(cueShownWith('Cook until the oil separates!', 'the oil   separates.')).toBeNull()
  })

  it('does not match inside a longer word', () => {
    expect(cueShownWith('Keep it boiling gently.', 'boil')).toBe('Boil.')
  })

  it('prints a missing cue as its own capitalised sentence, without "until"', () => {
    expect(cueShownWith('Fry the bread in ghee.', 'golden on both sides')).toBe('Golden on both sides.')
  })

  it('does not double the full stop', () => {
    expect(cueShownWith('Stir well.', 'thick and glossy.')).toBe('Thick and glossy.')
  })

  it('is null for no cue, or one with no letters', () => {
    expect(cueShownWith('Stir.', null)).toBeNull()
    expect(cueShownWith('Stir.', '  ...  ')).toBeNull()
  })

  it('never produces the old "until bring to one boil" grammar', () => {
    const out = cueShownWith('Pour the milk in.', 'bring to one boil')
    expect(out).toBe('Bring to one boil.')
    expect(out).not.toMatch(/^until/i)
  })
})
