import { describe, expect, it } from 'vitest'

import { stalenessLineFor } from './staleness'

describe('stalenessLineFor', () => {
  it('stale is the short line, with no instruction (the button carries the action)', () => {
    expect(stalenessLineFor('stale')).toBe('This plan may be out of date.')
  })
  it('unchecked is unchanged', () => {
    expect(stalenessLineFor('unchecked')).toBe("Couldn't check for updates. Showing your saved plan.")
  })
})
