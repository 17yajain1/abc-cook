import { describe, expect, it } from 'vitest'

import type { NormalizedIngredient } from '@abc-cook/schema'

import { draftIngredientGroups, previewIngredientGroups } from './draftView'

const ing = (name: string, over: Partial<NormalizedIngredient> = {}): NormalizedIngredient => ({
  name,
  group: null,
  prep_note: null,
  qty: null,
  unit: null,
  ...over,
})

describe('draftIngredientGroups', () => {
  it('shows the quantity and unit verbatim, with nothing parsed or formatted', () => {
    const [g] = draftIngredientGroups([
      ing('Curd', { qty: '1/2', unit: 'cup' }),
      ing('Salt', { qty: 'a pinch' }),
      ing('Water', { unit: 'as needed' }),
      ing('Oil'),
    ])
    expect(g.items.map((i) => i.trailing)).toEqual(['1/2 cup', 'a pinch', 'as needed', null])
  })

  it('puts ungrouped ingredients in a single headingless bucket', () => {
    const groups = draftIngredientGroups([ing('A'), ing('B')])
    expect(groups).toHaveLength(1)
    expect(groups[0].heading).toBeNull()
    expect(groups[0].items.map((i) => i.name)).toEqual(['A', 'B'])
  })

  it('keeps arrival order and opens a new heading whenever the group changes', () => {
    const groups = draftIngredientGroups([
      ing('A', { group: 'For kadi' }),
      ing('B', { group: 'For kadi' }),
      ing('C', { group: 'For pakora' }),
      ing('D', { group: 'For kadi' }),
      ing('E'),
    ])
    expect(groups.map((g) => [g.heading, g.items.map((i) => i.name)])).toEqual([
      ['For kadi', ['A', 'B']],
      ['For pakora', ['C']],
      ['For kadi', ['D']],
      [null, ['E']],
    ])
  })

  it('is append-only: adding an item never changes the keys of the ones already shown', () => {
    const first = [ing('A', { group: 'X' }), ing('B', { group: 'X' })]
    const before = draftIngredientGroups(first)
    const after = draftIngredientGroups([...first, ing('C', { group: 'X' }), ing('D', { group: 'Y' })])
    expect(after[0].key).toBe(before[0].key)
    expect(after[0].items.slice(0, 2).map((i) => i.key)).toEqual(before[0].items.map((i) => i.key))
    expect(new Set(after.flatMap((g) => g.items.map((i) => i.key))).size).toBe(4)
  })

  it('treats a blank group like no group', () => {
    const groups = draftIngredientGroups([ing('A', { group: ' ' }), ing('B')])
    expect(groups).toHaveLength(1)
    expect(groups[0].heading).toBeNull()
  })

  it('is empty for no ingredients', () => {
    expect(draftIngredientGroups([])).toEqual([])
  })
})

describe('previewIngredientGroups', () => {
  it('draws the source lines whole, in one headingless group, with no trailing column', () => {
    const [g, ...rest] = previewIngredientGroups(['200 g flour (7 oz)', '1 tsp salt'])
    expect(rest).toEqual([])
    expect(g.heading).toBeNull()
    expect(g.items.map((i) => [i.name, i.trailing])).toEqual([
      ['200 g flour (7 oz)', null],
      ['1 tsp salt', null],
    ])
  })
})

describe('draftIngredientGroups : a unit already in the quantity', () => {
  it('is not repeated', () => {
    const [g] = draftIngredientGroups([
      { name: 'Chole', group: null, prep_note: null, qty: '1 cup', unit: 'cup' },
      { name: 'Maida', group: null, prep_note: null, qty: '2 cups', unit: 'cups' },
      { name: 'Oil', group: null, prep_note: null, qty: '2', unit: 'tbsp' },
    ])
    expect(g.items.map((i) => i.trailing)).toEqual(['1 cup', '2 cups', '2 tbsp'])
  })
})
