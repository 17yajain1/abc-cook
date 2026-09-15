import { describe, expect, it } from 'vitest'

import { formatQty } from './quantity'

describe('formatQty', () => {
  it('renders a whole number bare', () => {
    expect(formatQty(2)).toBe('2')
    expect(formatQty(0)).toBe('0')
  })

  it('renders common cooking fractions', () => {
    expect(formatQty(0.5)).toBe('1/2')
    expect(formatQty(0.25)).toBe('1/4')
    expect(formatQty(0.75)).toBe('3/4')
  })

  it('renders a mixed number as whole + fraction', () => {
    expect(formatQty(1.25)).toBe('1 1/4')
    expect(formatQty(3 + 1 / 3)).toBe('3 1/3')
  })

  it('renders null/undefined as an empty string, never "null"', () => {
    expect(formatQty(null)).toBe('')
    expect(formatQty(undefined)).toBe('')
  })

  it('falls back to a rounded decimal when no clean fraction matches', () => {
    expect(formatQty(1.13)).toBe('1.13')
  })
})
