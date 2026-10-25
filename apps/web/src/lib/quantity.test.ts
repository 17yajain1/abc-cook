import { describe, expect, it } from 'vitest'

import { formatQty, joinQtyUnit, quantityTrailing } from './quantity'

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

describe('joinQtyUnit', () => {
  it('joins a quantity and a unit', () => {
    expect(joinQtyUnit('2', 'tbsp')).toBe('2 tbsp')
    expect(joinQtyUnit('1/2', 'cup')).toBe('1/2 cup')
  })

  it('does not repeat a unit the quantity text already ends with', () => {
    expect(joinQtyUnit('1 cup', 'cup')).toBe('1 cup')
    expect(joinQtyUnit('1/4 tsp', 'tsp')).toBe('1/4 tsp')
    expect(joinQtyUnit('2 tbsp', 'tbsp')).toBe('2 tbsp')
    expect(joinQtyUnit('100 g', 'g')).toBe('100 g')
  })

  it('treats singular and plural as the same unit, in either direction, keeping the quantity text', () => {
    expect(joinQtyUnit('2 cups', 'cup')).toBe('2 cups')
    expect(joinQtyUnit('1 cup', 'cups')).toBe('1 cup')
    expect(joinQtyUnit('2 cups', 'cups')).toBe('2 cups')
  })

  it('is case-insensitive and ignores extra spaces', () => {
    expect(joinQtyUnit('1 Cup', 'cup')).toBe('1 Cup')
    expect(joinQtyUnit('1  cup ', ' CUP')).toBe('1  cup')
  })

  it('treats a unit written straight after the number as the same word', () => {
    expect(joinQtyUnit('250g', 'g')).toBe('250g')
  })

  it('does not dedupe when the quantity merely ends with the same letters', () => {
    expect(joinQtyUnit('1 cupcake', 'cup')).toBe('1 cupcake cup')
    expect(joinQtyUnit('2 teacups', 'cup')).toBe('2 teacups cup')
    expect(joinQtyUnit('1 big', 'g')).toBe('1 big g')
  })

  it('does not dedupe when the unit appears earlier in the text, not at the end', () => {
    expect(joinQtyUnit('1 cup (240 ml)', 'cup')).toBe('1 cup (240 ml) cup')
    expect(joinQtyUnit('1 cup of', 'cup')).toBe('1 cup of cup')
  })

  it('handles an empty quantity or an empty unit', () => {
    expect(joinQtyUnit('', 'cup')).toBe('cup')
    expect(joinQtyUnit(null, 'to taste')).toBe('to taste')
    expect(joinQtyUnit('1', '')).toBe('1')
    expect(joinQtyUnit('1', null)).toBe('1')
    expect(joinQtyUnit('', '')).toBe('')
    expect(joinQtyUnit(undefined, undefined)).toBe('')
    expect(joinQtyUnit('  ', ' ')).toBe('')
  })

  it('works on Devanagari units', () => {
    expect(joinQtyUnit('1 कप', 'कप')).toBe('1 कप')
    expect(joinQtyUnit('1', 'कप')).toBe('1 कप')
    expect(joinQtyUnit('एक चम्मच', 'कप')).toBe(
      'एक चम्मच कप',
    )
  })

  it('does not touch a multi-word unit unless the quantity ends with all of it', () => {
    expect(joinQtyUnit('a pinch', 'pinch')).toBe('a pinch')
    expect(joinQtyUnit('salt to taste', 'to taste')).toBe('salt to taste')
    expect(joinQtyUnit('2', 'to taste')).toBe('2 to taste')
  })
})

describe('quantityTrailing', () => {
  const item = (over: Partial<Parameters<typeof quantityTrailing>[0]>) => ({
    qty: null,
    qty_text: null,
    qty_amount: null,
    unit: null,
    ...over,
  })

  it('is null when the line states no amount and no unit', () => {
    expect(quantityTrailing(item({}))).toBeNull()
    expect(quantityTrailing(item({ qty_text: null, unit: '' }))).toBeNull()
  })

  it('prefers the source text, joined to its unit once', () => {
    expect(quantityTrailing(item({ qty_text: '1 cup', unit: 'cup' }))).toBe('1 cup')
    expect(quantityTrailing(item({ qty_text: '2', unit: 'tbsp' }))).toBe('2 tbsp')
  })

  it('falls back to formatQty for a bare number, and to a custom formatNumber when given', () => {
    expect(quantityTrailing(item({ qty: 1.5, unit: 'cup' }))).toBe('1 1/2 cup')
    expect(quantityTrailing(item({ qty: 1.5, unit: 'cup' }), 1, { formatNumber: String })).toBe('1.5 cup')
  })

  it('keeps a unit-only line', () => {
    expect(quantityTrailing(item({ unit: 'to taste' }))).toBe('to taste')
  })

  it('omitAmount drops the amount but keeps the unit', () => {
    const line = item({ qty_text: 'a handful', unit: 'bunch' })
    expect(quantityTrailing(line, 1, { omitAmount: (a) => a === 'a handful' })).toBe('bunch')
    expect(quantityTrailing(line, 1, { omitAmount: () => false })).toBe('a handful bunch')
  })

  it('scales through scaleQuantity', () => {
    const line = item({ qty_text: '1', unit: 'cup', qty_amount: { low: 1, high: null, prefix: '', rest: '' } })
    expect(quantityTrailing(line, 2 / 3)).toBe('⅔ cup')
  })

  it('an "A + B" amount reads as written at 1x and as the sum when scaled', () => {
    const line = item({
      qty_text: '1 tbsp + 1 tbsp',
      qty_amount: { low: 2, high: null, prefix: '', rest: ' tbsp' },
    })
    expect(quantityTrailing(line)).toBe('1 tbsp + 1 tbsp')
    expect(quantityTrailing(line, 2)).toBe('4 tbsp')
  })
})
