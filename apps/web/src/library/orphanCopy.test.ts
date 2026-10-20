import { describe, expect, it } from 'vitest'

import { orphanNoticeLine } from './recipeEdits'

describe('orphanNoticeLine (A22)', () => {
  it('says nothing when every edit applied', () => {
    expect(orphanNoticeLine(0)).toBeNull()
  })

  it('names one, then a count', () => {
    expect(orphanNoticeLine(1)).toBe("1 of your changes couldn't be applied.")
    expect(orphanNoticeLine(3)).toBe("3 of your changes couldn't be applied.")
  })
})
