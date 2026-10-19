import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Ingredient, RecipePlanResponse } from '@abc-cook/schema'

import { quantityTrailing, quantityTrailingScaled, unscaledCount } from './quantity'

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 'ing_x',
  name: 'X',
  group: null,
  prep_note: null,
  qty: null,
  unit: null,
  ...over,
})
const scalable = ing({ qty: 2, qty_text: '2', unit: 'cups', qty_amount: { low: 2, high: null, prefix: '', rest: '' } })
const packaged = ing({ qty: 5, qty_text: '5 tbsp (50g) for dough', unit: null })
const vague = ing({ qty: null, qty_text: 'to taste', unit: null })
const pinch = ing({ qty: null, qty_text: 'a pinch', unit: null })
const empty = ing({})

describe('quantityTrailingScaled', () => {
  it('a scaled line is not marked', () => {
    expect(quantityTrailingScaled(scalable, 2)).toEqual({ text: '4 cups', unscaled: false })
  })
  it('a numbered line it cannot scale is marked, and keeps its own text', () => {
    expect(quantityTrailingScaled(packaged, 2)).toEqual({ text: '5 tbsp (50g) for dough', unscaled: true })
  })
  it('"to taste", "a pinch" and an empty line are never marked', () => {
    for (const item of [vague, pinch, empty]) expect(quantityTrailingScaled(item, 2).unscaled).toBe(false)
  })
  it('at factor 1 nothing is marked', () => {
    for (const item of [scalable, packaged, vague, pinch, empty]) expect(quantityTrailingScaled(item, 1).unscaled).toBe(false)
  })
  it('a Devanagari digit counts as a number', () => {
    expect(quantityTrailingScaled(ing({ qty_text: '२ कप' }), 2).unscaled).toBe(true)
  })
  it('options reach the text the same way as quantityTrailing', () => {
    const options = { formatNumber: (q: number | null | undefined) => (q != null ? `<${q}>` : '') }
    const noText = ing({ qty: 3, unit: 'g' })
    expect(quantityTrailingScaled(noText, 1, options).text).toBe(quantityTrailing(noText, 1, options))
  })
})

describe('unscaledCount', () => {
  it('counts the marked lines at a factor', () => {
    expect(unscaledCount([scalable, packaged, vague, pinch], 2)).toBe(1)
    expect(unscaledCount([scalable, packaged], 1)).toBe(0)
  })
})

describe('identity at factor 1, every fixture ingredient', () => {
  const FIXTURES = fileURLToPath(new URL('../__fixtures__/', import.meta.url))
  const lines = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.plan-response.json'))
    .flatMap((f) => (JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as RecipePlanResponse).graph.ingredients)
  it('text equals quantityTrailing and nothing is marked', () => {
    expect(lines.length).toBeGreaterThan(50)
    for (const item of lines) {
      const r = quantityTrailingScaled(item, 1)
      expect(r.text).toBe(quantityTrailing(item, 1))
      expect(r.unscaled).toBe(false)
    }
  })
})
