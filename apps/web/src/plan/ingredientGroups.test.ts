import { describe, expect, it } from 'vitest'

import type { Ingredient } from '@abc-cook/schema'

import { panelIngredientGroups } from './ingredientGroups'

const ing = (over: Partial<Ingredient> & { id: string; name: string }): Ingredient => ({
  group: null,
  prep_note: null,
  qty: null,
  unit: null,
  ...over,
})

describe('panelIngredientGroups', () => {
  it('keeps group order, headings and item order, and keys items by id', () => {
    const groups = panelIngredientGroups([
      { group: 'For kadi', items: [ing({ id: 'a', name: 'Curd', qty_text: '1 1/2', unit: 'cups' })] },
      { group: null, items: [ing({ id: 'b', name: 'Salt' }), ing({ id: 'c', name: 'Oil' })] },
    ])
    expect(groups.map((g) => g.heading)).toEqual(['For kadi', null])
    expect(groups[0].items).toEqual([{ key: 'a', name: 'Curd', optional: false, trailing: '1 1/2 cups' }])
    expect(groups[1].items.map((i) => i.key)).toEqual(['b', 'c'])
  })

  it('prefers the source quantity text, then the formatted number, then nothing', () => {
    const [g] = panelIngredientGroups([
      {
        group: null,
        items: [
          ing({ id: 'a', name: 'A', qty_text: 'a pinch', qty: 1 }),
          ing({ id: 'b', name: 'B', qty: 1.5, unit: 'cup' }),
          ing({ id: 'c', name: 'C', unit: 'to taste' }),
          ing({ id: 'd', name: 'D' }),
        ],
      },
    ])
    expect(g.items.map((i) => i.trailing)).toEqual(['a pinch', '1 1/2 cup', 'to taste', null])
  })

  it('carries optional through', () => {
    const [g] = panelIngredientGroups([{ group: null, items: [ing({ id: 'a', name: 'A', optional: true })] }])
    expect(g.items[0].optional).toBe(true)
  })

  it('gives every group a distinct key, ungrouped ones by position', () => {
    const groups = panelIngredientGroups([
      { group: null, items: [] },
      { group: 'X', items: [] },
      { group: null, items: [] },
    ])
    expect(new Set(groups.map((g) => g.key)).size).toBe(3)
  })
})
