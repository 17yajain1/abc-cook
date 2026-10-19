import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Ingredient, RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById, quantityLine, quantityPhrases } from '@/cooking-mode/quantity'
import type { CookingNodeInfo } from '@/cooking/types'
import { panelIngredientGroups } from '@/plan/ingredientGroups'

import { formatQty, joinQtyUnit } from './quantity'
import { scaleQuantity } from './scaleQuantity'

// R3's promise: routing every quantity render through `scaleQuantity` changes nothing at factor 1.
// These are frozen copies of the two formatters as they were before the routing (the recipe tab's
// trailing text and the cooking-mode chip phrase). Never edit them to match new behaviour.

const oldTabText = (item: Ingredient): string | null =>
  item.qty_text != null || item.qty != null || item.unit
    ? joinQtyUnit(item.qty_text ?? formatQty(item.qty), item.unit)
    : null

function oldChipPhrase(ingredient: Ingredient): string {
  const name = ingredient.name.toLowerCase()
  if (ingredient.qty == null && ingredient.unit === 'to taste') return `${name} to taste`
  let qty = ingredient.qty_text ?? (ingredient.qty != null ? String(ingredient.qty) : null)
  if (qty != null && (name === qty.toLowerCase() || name.startsWith(`${qty.toLowerCase()} `))) qty = null
  return [qty, ingredient.unit, name].filter((part): part is string => !!part).join(' ')
}

const FIXTURES = fileURLToPath(new URL('../__fixtures__/', import.meta.url))
const fixtureIngredients: Array<[string, Ingredient]> = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.plan-response.json'))
  .sort()
  .flatMap((file) => {
    const plan = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as RecipePlanResponse
    return plan.graph.ingredients.map((ing): [string, Ingredient] => [`${file} ${ing.id}`, ing])
  })

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 'ing_x',
  name: 'X',
  group: null,
  prep_note: null,
  qty: null,
  unit: null,
  ...over,
})

const synthetic: Ingredient[] = [
  ing({ qty_text: '' }),
  ing({ qty_text: null }),
  ing({ qty_text: '1 cup', unit: 'cup' }),
  ing({ qty_text: 'to taste', unit: 'to taste' }),
  ing({ qty: null, unit: 'to taste' }),
  ing({ qty_text: 'a handful', name: 'A handful of herbs' }),
  ing({ qty_text: '1 ½', unit: 'cups', qty: 1.5 }),
  ing({ qty: 1.5, unit: 'cup', name: 'Water' }),
  ing({ qty_text: '2-3', unit: 'medium', qty: 2 }),
  ing({ qty_text: '250g', qty_amount: { low: 250, high: null, prefix: '', rest: 'g' } }),
  ing({ qty_text: '1', unit: 'cup', qty_amount: { low: 1, high: null, prefix: '', rest: '' } }),
  ing({ qty_text: '15 oz can', qty_amount: null }),
  ing({ qty_text: '1 cup (240 ml)', qty_amount: null }),
  ing({ unit: 'pinch' }),
]

// FGC-42: the chips now share the tab's quantity text. Every case not listed here is still
// byte-identical to the frozen pre-R3 phrase; each listed one pins both its old and new text.
const CHIP_CHANGES: Record<string, { old: string; new: string }> = {
  'kadhi-pakora.plan-response.json ing_salt': { old: 'to taste salt', new: 'salt to taste' },
  'kadhi-pakora.plan-response.json ing_salt_2': { old: 'to taste salt', new: 'salt to taste' },
  'sabudana-khichdi.plan-response.json ing_sendha_namak': {
    old: 'to taste sendha namak',
    new: 'sendha namak to taste',
  },
  'synthetic 2': { old: '1 cup cup x', new: '1 cup x' },
}

describe('factor 1 is byte-identical to the pre-R3 formatters', () => {
  const all: Array<[string, Ingredient]> = [
    ...fixtureIngredients,
    ...synthetic.map((s, i): [string, Ingredient] => [`synthetic ${i}`, s]),
  ]

  it('names only real cases in the FGC-42 chip exception map', () => {
    const labels = new Set(all.map(([label]) => label))
    for (const key of Object.keys(CHIP_CHANGES)) expect(labels.has(key), key).toBe(true)
  })

  it('covers every web fixture ingredient', () => {
    expect(fixtureIngredients.length).toBeGreaterThan(100)
  })

  it.each(all)('%s: Ingredients tab text', (_label, item) => {
    const [group] = panelIngredientGroups([{ group: null, items: [item] }])
    expect(group.items[0].trailing).toBe(oldTabText(item))
    const [explicit] = panelIngredientGroups([{ group: null, items: [item] }], 1)
    expect(explicit.items[0].trailing).toBe(oldTabText(item))
  })

  it.each(all)('%s: cooking-mode chip phrase and quantity line', (label, item) => {
    const node = { consumes: [item.id] } as CookingNodeInfo
    const byId = ingredientsById([item])
    const change = CHIP_CHANGES[label]
    if (change) expect(oldChipPhrase(item)).toBe(change.old)
    const expected = change ? change.new : oldChipPhrase(item)
    expect(quantityPhrases(node, byId)).toEqual([expected])
    expect(quantityPhrases(node, byId, 1)).toEqual([expected])
    expect(quantityLine(node, byId, 1)).toBe(expected)
  })

  it.each(all)('%s: scaleQuantity returns the source text, unscaled', (_label, item) => {
    expect(scaleQuantity(item, 1)).toEqual({ text: item.qty_text ?? null, scaled: false })
  })
})

describe('a factor other than 1 is threaded to both screens', () => {
  const item = ing({
    id: 'ing_a',
    name: 'Flour',
    qty_text: '250',
    unit: 'g',
    qty_amount: { low: 250, high: null, prefix: '', rest: '' },
  })

  it('the Ingredients tab and the chips scale together', () => {
    const [group] = panelIngredientGroups([{ group: null, items: [item] }], 2 / 3)
    expect(group.items[0].trailing).toBe('165 g')
    const node = { consumes: ['ing_a'] } as CookingNodeInfo
    expect(quantityLine(node, ingredientsById([item]), 2 / 3)).toBe('165 g flour')
  })
})
