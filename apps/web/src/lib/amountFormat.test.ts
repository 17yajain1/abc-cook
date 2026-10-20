import { describe, expect, it } from 'vitest'

import { joinQtyUnit } from './quantity'
import { formatAmount, formatAmountRange, scaleQuantity, snapAmount } from './scaleQuantity'

/**
 * R6 A23: the one-amount formatter the editor writes `qty_text` with. It shares the scaler's
 * fraction table (cooking fractions, never 0.5 or 0.33) but, unlike the scaler, never rounds a
 * typed number to a coarser measure: a cook who types 12 g must not get 10 g back.
 */
describe('formatAmount (A28)', () => {
  it.each([
    [0.5, '½'],
    [0.25, '¼'],
    [0.75, '¾'],
    [1 / 3, '⅓'],
    [2 / 3, '⅔'],
    [1.5, '1½'],
    [2.5, '2½'],
    [1.25, '1¼'],
    [2.75, '2¾'],
    [3, '3'],
  ])('writes %s as %s', (value, text) => {
    expect(formatAmount(value)).toBe(text)
  })

  it('snaps only exact cooking-fraction equivalents: .33 and .333 are a third, .67 and .667 two thirds', () => {
    for (const v of [0.33, 0.333, 0.3333333]) expect(formatAmount(v)).toBe('⅓')
    for (const v of [0.67, 0.667, 0.6666667]) expect(formatAmount(v)).toBe('⅔')
    expect(formatAmount(1.33)).toBe('1⅓')
  })

  it('shows anything else as typed, up to 2 decimals', () => {
    expect(formatAmount(12)).toBe('12')
    expect(formatAmount(1.2)).toBe('1.2')
    expect(formatAmount(2.3)).toBe('2.3')
    expect(formatAmount(437)).toBe('437')
    expect(formatAmount(0.34)).toBe('0.34')
    expect(formatAmount(0.4)).toBe('0.4')
    expect(formatAmount(0.125)).toBe('0.13')
    expect(formatAmount(2.26)).toBe('2.26')
  })

  it('never writes a bare decimal for an exact fraction', () => {
    for (const value of [0.5, 1.5, 0.25, 0.75, 1 / 3, 2 / 3]) {
      expect(formatAmount(value)).not.toMatch(/\.\d/)
    }
  })

  it('"12" g reads "12 g" on the row', () => {
    expect(joinQtyUnit(formatAmount(12), 'g')).toBe('12 g')
  })
})

describe('snapAmount (A28)', () => {
  it('snaps an exact cooking-fraction equivalent to the fraction', () => {
    expect(snapAmount(0.33)).toBeCloseTo(1 / 3, 10)
    expect(snapAmount(0.667)).toBeCloseTo(2 / 3, 10)
    expect(snapAmount(1.5)).toBe(1.5)
  })

  it('leaves every other value as typed, rounded to 2 decimals', () => {
    expect(snapAmount(12)).toBe(12)
    expect(snapAmount(1.2)).toBe(1.2)
    expect(snapAmount(2.26)).toBe(2.26)
    expect(snapAmount(0.1234)).toBe(0.12)
  })
})

describe('formatAmountRange', () => {
  it('joins the two ends with an en dash', () => {
    expect(formatAmountRange(1.5, 2)).toBe('1½–2')
    expect(formatAmountRange(0.5, 0.75)).toBe('½–¾')
  })

  it('is the single amount when there is no high end', () => {
    expect(formatAmountRange(1.5, null)).toBe('1½')
  })
})

describe('scaleQuantity is unchanged by the export', () => {
  it('still rounds a scaled amount the way a cook measures', () => {
    const line = { qty_text: '4', unit: 'tbsp', qty_amount: { low: 4, high: null, prefix: '', rest: '' } }
    expect(scaleQuantity(line, 1.5).text).toBe('6')
    expect(scaleQuantity({ ...line, unit: 'g' }, 1.5).text).toBe('6')
  })

  it('A17: an amount whose `rest` is empty scales by the unit class from `unit` alone', () => {
    const spoon = { qty_text: '1½', unit: 'tbsp', qty_amount: { low: 1.5, high: null, prefix: '', rest: '' } }
    const metric = { qty_text: '120', unit: 'g', qty_amount: { low: 120, high: null, prefix: '', rest: '' } }
    expect(scaleQuantity(spoon, 2).text).toBe('3')
    expect(scaleQuantity(spoon, 0.5).text).toBe('¾')
    expect(scaleQuantity(metric, 1.5).text).toBe('180')
  })

  it('A17: "No unit" scales exactly like an imported unitless line', () => {
    const imported = { qty_text: '3', unit: null, qty_amount: { low: 3, high: null, prefix: '', rest: '' } }
    const edited = { qty_text: '3', unit: null, qty_amount: { low: 3, high: null, prefix: '', rest: '' } }
    for (const factor of [0.5, 1.5, 2, 3]) {
      expect(scaleQuantity(edited, factor)).toEqual(scaleQuantity(imported, factor))
    }
  })
})
