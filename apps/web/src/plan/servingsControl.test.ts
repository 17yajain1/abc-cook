import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Ingredient } from '@abc-cook/schema'

import type { ServingsChoice } from '@/lib/servings'

import { panelIngredientGroups } from './ingredientGroups'
import { ServingsControl, type ServingsControlState } from './ServingsControl'

const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })
const B = (multiplier: 0.5 | 1 | 1.5 | 2 | 3): ServingsChoice => ({ mode: 'batch', multiplier })

const html = (state: ServingsControlState) =>
  renderToStaticMarkup(createElement(ServingsControl, { state, onChange: () => {} }))

describe('ServingsControl markup (A5)', () => {
  it('live servings: labelled buttons, a polite live value, no reset at the original', () => {
    const out = html({ kind: 'live', choice: S(4, 4), unscaled: 0 })
    expect(out).toContain('aria-label="Fewer servings"')
    expect(out).toContain('aria-label="More servings"')
    expect(out).toContain('aria-live="polite"')
    expect(out).toContain('Servings')
    expect(out).toContain('Times stay the same')
    expect(out).not.toContain('Reset to')
    expect(out).not.toContain('disabled=""')
  })
  it('reset shows when the choice is not the original, on the same row as the sub-line', () => {
    const out = html({ kind: 'live', choice: S(6, 4), unscaled: 0 })
    expect(out).toContain('Reset to 4')
    const sub = out.indexOf('Times stay the same')
    const reset = out.indexOf('Reset to 4')
    const between = out.slice(sub, reset)
    expect(between).not.toContain('</div>')
  })
  it('the lower bound and upper bound disable their own button', () => {
    const low = html({ kind: 'live', choice: S(1, 4), unscaled: 0 })
    expect(low).toMatch(/aria-label="Fewer servings"[^>]*disabled|disabled=""[^>]*aria-label="Fewer servings"/)
    const high = html({ kind: 'live', choice: S(8, 4), unscaled: 0 })
    expect(high).toMatch(/aria-label="More servings"[^>]*disabled|disabled=""[^>]*aria-label="More servings"/)
  })
  it('batch: Amounts, x-value, batch labels', () => {
    const out = html({ kind: 'live', choice: B(1.5), unscaled: 0 })
    expect(out).toContain('Amounts')
    expect(out).toContain('×1½')
    expect(out).toContain('aria-label="Smaller batch"')
    expect(out).toContain('aria-label="Larger batch"')
    expect(out).toContain('Reset to ×1')
  })
  it('times note replaces the sub-line from factor 2', () => {
    const out = html({ kind: 'live', choice: S(8, 4), unscaled: 0 })
    expect(out).toContain('Times are for 4 servings. A bigger batch can take longer.')
    expect(out).not.toContain('Times stay the same')
  })
  it('the recipe-level line shows only when something is unscaled and the factor is not 1', () => {
    expect(html({ kind: 'live', choice: S(6, 4), unscaled: 2 })).toContain('2 amounts are for 4 servings — scale them yourself.')
    expect(html({ kind: 'live', choice: S(6, 4), unscaled: 1 })).toContain('1 amount is for 4 servings — scale it yourself.')
    expect(html({ kind: 'live', choice: S(4, 4), unscaled: 2 })).not.toContain('scale')
    expect(html({ kind: 'live', choice: S(6, 4), unscaled: 0 })).not.toContain('scale')
  })
  it('locked: disabled stepper with the visible reason, no reset', () => {
    const out = html({ kind: 'locked', choice: S(6, 4) })
    expect(out).toContain('Cooking for 6 — finish to change')
    expect((out.match(/disabled=""/g) ?? []).length).toBe(2)
    expect(out).not.toContain('Reset to')
  })
  it('locked batch', () => {
    expect(html({ kind: 'locked', choice: B(2) })).toContain('Cooking at ×2 — finish to change')
  })
  it('gated (W1-2): only the line, no stepper at all', () => {
    const out = html({ kind: 'gated' })
    expect(out).toContain("Amounts in this recipe can&#x27;t be scaled yet.")
    expect(out).not.toContain('<button')
    expect(out).not.toContain('aria-live')
  })
})

const ing = (over: Partial<Ingredient> & { id: string; name: string }): Ingredient => ({
  group: null,
  prep_note: null,
  qty: null,
  unit: null,
  ...over,
})
const amount = (low: number) => ({ low, high: null, prefix: '', rest: '' })

describe('panelIngredientGroups at a factor (marker note)', () => {
  const groups = [
    {
      group: null,
      items: [
        ing({ id: 'a', name: 'Flour', qty_text: '2', unit: 'cups', qty: 2, qty_amount: amount(2) }),
        ing({ id: 'b', name: 'Butter', qty_text: '5 tbsp (50g)', qty: 5 }),
        ing({ id: 'c', name: 'Salt', qty_text: 'to taste' }),
      ],
    },
  ]
  it('factor 1: no notes at all', () => {
    expect(panelIngredientGroups(groups, 1)[0].items.every((i) => i.note === undefined)).toBe(true)
  })
  it('factor != 1: only the numbered-but-unscaled line gets the note', () => {
    const items = panelIngredientGroups(groups, 2, 'for 4 servings')[0].items
    expect(items.map((i) => i.note)).toEqual([undefined, 'for 4 servings', undefined])
    expect(items[0].trailing).toBe('4 cups')
  })
  it('no note text given: never any note', () => {
    expect(panelIngredientGroups(groups, 2)[0].items.every((i) => i.note === undefined)).toBe(true)
  })
})
