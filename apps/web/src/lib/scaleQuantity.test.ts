import { describe, expect, it } from 'vitest'

import type { Ingredient, QtyAmount } from '@abc-cook/schema'

import { joinQtyUnit } from './quantity'
import { scaleQuantity, unitClass } from './scaleQuantity'

type Line = Pick<Ingredient, 'qty_text' | 'qty_amount' | 'unit'>

/** An ingredient line the way the backend would hand it over. */
const line = (qty_text: string | null, unit: string | null, amount?: Partial<QtyAmount> | null): Line => ({
  qty_text,
  unit,
  qty_amount: amount === undefined ? undefined : amount === null ? null : { low: 1, ...amount },
})

/** What a cook reads: the scaled amount, then the unit (as the recipe tab joins them). */
const shown = (ingredient: Line, factor: number): string =>
  joinQtyUnit(scaleQuantity(ingredient, factor).text, ingredient.unit)

const exact = (low: number, unit: string | null, rest = ''): Line =>
  line(null, unit, { low, high: null, prefix: '', rest })

describe('scaleQuantity: factor 1 and unscalable lines are the source text', () => {
  it('returns qty_text verbatim, unscaled, at factor 1', () => {
    for (const text of ['2', '1 1/2', '1 ½', '2-3 medium', 'about 2', '250g', '', 'to taste']) {
      expect(scaleQuantity(line(text, 'cup', { low: 2 }), 1)).toEqual({ text, scaled: false })
    }
  })

  it('returns null text when there is no qty_text', () => {
    expect(scaleQuantity(line(null, null), 2)).toEqual({ text: null, scaled: false })
    expect(scaleQuantity(line(null, null, { low: 2 }), 1)).toEqual({ text: null, scaled: false })
  })

  it('leaves a line with no qty_amount as written (null, missing, or pre-v14 data)', () => {
    expect(scaleQuantity(line('to taste', null, null), 2 / 3)).toEqual({ text: 'to taste', scaled: false })
    expect(scaleQuantity(line('1 cup (240 ml)', null), 2)).toEqual({ text: '1 cup (240 ml)', scaled: false })
    expect(scaleQuantity({ qty_text: '3', unit: 'g' }, 2)).toEqual({ text: '3', scaled: false })
  })

  it('leaves the amount as written for a factor that is not a positive number', () => {
    for (const factor of [0, -1, NaN, Infinity]) {
      expect(scaleQuantity(line('2', 'g', { low: 2 }), factor)).toEqual({ text: '2', scaled: false })
    }
  })
})

describe('scaleQuantity: worked example (3 servings to 2, factor 2/3)', () => {
  const factor = 2 / 3
  it('onion, paneer, oil, salt', () => {
    expect(scaleQuantity(line('2', 'medium', { low: 2, rest: '' }), factor)).toEqual({ text: '1½', scaled: true })
    expect(scaleQuantity(line('250', 'g', { low: 250 }), factor)).toEqual({ text: '165', scaled: true })
    expect(scaleQuantity(line('3', 'tbsp', { low: 3 }), factor)).toEqual({ text: '2', scaled: true })
    expect(scaleQuantity(line('to taste', 'to taste'), factor)).toEqual({ text: 'to taste', scaled: false })
  })
})

describe('unitClass', () => {
  it.each([
    ['g', 'metricSmall'],
    ['Gms', 'metricSmall'],
    ['millilitres', 'metricSmall'],
    ['kg', 'metricLarge'],
    ['Litres', 'metricLarge'],
    ['tbsp', 'spoonCup'],
    ['Cups', 'spoonCup'],
    ['pounds', 'spoonCup'],
    ['medium', 'count'],
    ['nos', 'count'],
    ['packet', 'count'],
    ['inch', 'count'],
  ])('%s is %s', (unit, expected) => {
    expect(unitClass(unit, '')).toBe(expected)
  })

  it('reads the first word of the text after the number when there is no unit field', () => {
    expect(unitClass(null, ' tbsp')).toBe('spoonCup')
    expect(unitClass('', 'g')).toBe('metricSmall')
    expect(unitClass(null, ' pieces')).toBe('count')
    expect(unitClass(null, '')).toBe('count')
  })

  it('prefers the unit field over the text', () => {
    expect(unitClass('cup', ' g')).toBe('spoonCup')
  })
})

describe('scaleQuantity: rounding by unit class', () => {
  it('metric small: nearest 5 from 10, nearest 1 below, never under 1', () => {
    expect(shown(exact(250, 'g'), 2 / 3)).toBe('165 g')
    expect(shown(exact(12, 'g'), 1.25)).toBe('15 g')
    expect(shown(exact(100, 'ml'), 0.6)).toBe('60 ml')
    expect(shown(exact(3, 'g'), 2 / 3)).toBe('2 g')
    expect(shown(exact(9, 'gm'), 1.1)).toBe('10 gm')
    expect(shown(exact(5, 'g'), 1.9)).toBe('10 g')
    expect(shown(exact(2, 'g'), 0.1)).toBe('1 g')
  })

  it('metric large: nearest 0.05, trimmed, never under 0.05', () => {
    expect(shown(exact(2, 'l'), 2 / 3)).toBe('1.35 l')
    expect(shown(exact(1, 'kg'), 1.5)).toBe('1.5 kg')
    expect(shown(exact(1, 'kg'), 2)).toBe('2 kg')
    expect(shown(exact(1, 'kg'), 1.25)).toBe('1.25 kg')
    expect(shown(exact(1, 'litres'), 0.01)).toBe('0.05 litres')
  })

  it('spoon, cup and imperial: whole plus the nearest of ¼ ⅓ ½ ⅔ ¾', () => {
    expect(shown(exact(0.75, 'tsp'), 2 / 3)).toBe('½ tsp')
    expect(shown(exact(0.75, 'tsp'), 2)).toBe('1½ tsp')
    expect(shown(exact(10, 'cups'), 2 / 3)).toBe('6⅔ cups')
    expect(shown(exact(2.5, 'cups'), 2 / 3)).toBe('1⅔ cups')
    expect(shown(exact(1, 'cup'), 2 / 3)).toBe('⅔ cup')
    expect(shown(exact(1.5, 'cups'), 2 / 3)).toBe('1 cups')
    expect(shown(exact(1, 'tbsp'), 1.5)).toBe('1½ tbsp')
    expect(shown(exact(2, 'oz'), 1.5)).toBe('3 oz')
    expect(shown(exact(1, 'lb'), 2.3)).toBe('2⅓ lb')
    expect(shown(exact(0.25, 'cup'), 3)).toBe('¾ cup')
  })

  it('shows ⅛ only below ¼, and never rounds to zero', () => {
    expect(shown(exact(0.5, 'tsp'), 0.3)).toBe('⅛ tsp')
    expect(shown(exact(1, 'tsp'), 0.1)).toBe('⅛ tsp')
    expect(shown(exact(0.5, 'tsp'), 0.4)).toBe('¼ tsp')
    expect(shown(exact(1 / 3, 'cup'), 2 / 3)).toBe('¼ cup')
    // above a quarter the eighths are gone: 1⅛ is 1¼, 1⅜ is 1⅓
    expect(shown(exact(1, 'cup'), 1.125)).toBe('1¼ cup')
    expect(shown(exact(1, 'cup'), 1.375)).toBe('1⅓ cup')
    expect(shown(exact(0.25, 'tsp'), 1.5)).toBe('⅓ tsp')
  })

  it('count: nearest half, never under ½', () => {
    expect(shown(exact(2, 'medium'), 2 / 3)).toBe('1½ medium')
    expect(shown(exact(2, 'nos'), 2 / 3)).toBe('1½ nos')
    expect(shown(exact(2, 'nos'), 2)).toBe('4 nos')
    expect(shown(exact(1, 'inch'), 2 / 3)).toBe('½ inch')
    expect(shown(exact(1, 'clove'), 0.1)).toBe('½ clove')
    expect(shown(exact(1, null), 3)).toBe('3')
  })
})

describe('scaleQuantity: ranges', () => {
  it('scales both ends, each rounded on its own, joined by an en dash', () => {
    const pieces = line('8-10 pieces', null, { low: 8, high: 10, rest: ' pieces' })
    expect(scaleQuantity(pieces, 2 / 3).text).toBe('5½–6½ pieces')
    expect(scaleQuantity(pieces, 2).text).toBe('16–20 pieces')
    const cups = line('1 1/2 to 2 cups', null, { low: 1.5, high: 2, rest: ' cups' })
    expect(scaleQuantity(cups, 2 / 3).text).toBe('1–1⅓ cups')
    expect(scaleQuantity(cups, 2).text).toBe('3–4 cups')
    expect(scaleQuantity(line('4-5', 'cups', { low: 4, high: 5 }), 2 / 3).text).toBe('2⅔–3⅓')
  })

  it('shows one value when the two ends round together', () => {
    expect(scaleQuantity(line('2-3', 'g', { low: 2, high: 3 }), 0.1).text).toBe('1')
    expect(scaleQuantity(line('1-1', 'tsp', { low: 1, high: 1.05 }), 1.2).text).toBe('1¼')
  })
})

describe('scaleQuantity: the source words are kept verbatim', () => {
  it('keeps the approximate prefix and the text after the number', () => {
    const about = line('about 2', null, { low: 2, prefix: 'about ' })
    expect(scaleQuantity(about, 2).text).toBe('about 4')
    const tilde = line('~2 medium', null, { low: 2, prefix: '~', rest: ' medium' })
    expect(scaleQuantity(tilde, 2).text).toBe('~4 medium')
    const glued = line('250g', null, { low: 250, rest: 'g' })
    expect(scaleQuantity(glued, 2).text).toBe('500g')
  })

  it('never rewrites a word or a plural', () => {
    expect(shown(line('1 cup', 'cup', { low: 1, rest: ' cup' }), 2)).toBe('2 cup')
    expect(shown(line('2 cups', 'cups', { low: 2, rest: ' cups' }), 0.5)).toBe('1 cups')
    expect(shown(line('1 cup', 'cup', { low: 1, rest: ' cup' }), 0.5)).toBe('½ cup')
  })

  it('does not convert units', () => {
    expect(shown(exact(1000, 'g'), 3)).toBe('3000 g')
    expect(shown(exact(4, 'tsp'), 3)).toBe('12 tsp')
  })
})

describe('scaleQuantity: ordinary servings factors, built as chosen / original', () => {
  // One line per unit class, scaled by the factors a servings control produces.
  const flour = exact(250, 'g')
  const butter = exact(0.75, 'tsp')
  const milk = exact(2, 'cups')
  const eggs = exact(3, 'nos')
  const water = exact(1.5, 'l')
  const rows: Array<[string, number, string, string, string, string, string]> = [
    // label, factor, flour, butter, milk, eggs, water
    ['4 to 2 (1/2)', 2 / 4, '125 g', '⅓ tsp', '1 cups', '1½ nos', '0.75 l'],
    ['3 to 4 (4/3)', 4 / 3, '335 g', '1 tsp', '2⅔ cups', '4 nos', '2 l'],
    ['2 to 3 (3/2)', 3 / 2, '375 g', '1¼ tsp', '3 cups', '4½ nos', '2.25 l'],
    ['3 to 5 (5/3)', 5 / 3, '415 g', '1¼ tsp', '3⅓ cups', '5 nos', '2.5 l'],
    ['2 to 6 (3)', 6 / 2, '750 g', '2¼ tsp', '6 cups', '9 nos', '4.5 l'],
  ]
  it.each(rows)('%s', (_label, factor, f, b, m, e, w) => {
    expect(shown(flour, factor)).toBe(f)
    expect(shown(butter, factor)).toBe(b)
    expect(shown(milk, factor)).toBe(m)
    expect(shown(eggs, factor)).toBe(e)
    expect(shown(water, factor)).toBe(w)
  })

  it('does not let float error push an exact boundary to the wrong side', () => {
    // 11.25 * (7 / 5) is 15.749999999999998 in floating point; the true value 15.75 is exactly
    // between 15½ and 16, and a half rounds up. Without snapping, a count would read 15½.
    expect(11.25 * (7 / 5)).toBeLessThan(15.75)
    expect(shown(exact(11.25, 'nos'), 7 / 5)).toBe('16 nos')
    // float error just over a boundary lands on the same side
    expect(1.05 * (5 / 3)).toBeGreaterThan(1.75)
    expect(shown(exact(1.05, 'nos'), 5 / 3)).toBe('2 nos')
  })

  it('a result is never zero', () => {
    expect(shown(exact(1, 'g'), 1 / 1000)).toBe('1 g')
    expect(shown(exact(1, 'kg'), 1 / 1000)).toBe('0.05 kg')
    expect(shown(exact(1, 'tsp'), 1 / 1000)).toBe('⅛ tsp')
    expect(shown(exact(1, 'nos'), 1 / 1000)).toBe('½ nos')
  })
})
