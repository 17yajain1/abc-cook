import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Ingredient, RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById, quantityLine, quantityPhrases } from './quantity'
import golden from './quantityLine.golden.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingNodeInfo } from '@/cooking/types'
import { panelIngredientGroups } from '@/plan/ingredientGroups'

const KADAI = kadaiPaneer as RecipePlanResponse
const model = deriveCookingModel(KADAI)
const ingredients = ingredientsById(KADAI.graph.ingredients)

describe('quantityLine', () => {
  it('renders "qty unit name", lower-cased, for a single ing_* consumer', () => {
    expect(quantityLine(model.nodes.chop_onion, ingredients)).toBe('2 medium onion')
    expect(quantityLine(model.nodes.cube_paneer, ingredients)).toBe('250 g paneer')
    expect(quantityLine(model.nodes.chop_capsicum, ingredients)).toBe('1 large capsicum')
  })

  it('joins several ing_* consumers with " · "', () => {
    expect(quantityLine(model.nodes.saute_onion, ingredients)).toBe('3 tbsp oil · 1 tbsp ginger-garlic paste')
  })

  it('renders a null-qty "to taste" ingredient as "name to taste"', () => {
    // cook_tomato_base consumes ing_salt (qty null, unit "to taste") alongside two
    // comp_* ids, which must be silently dropped.
    expect(quantityLine(model.nodes.cook_tomato_base, ingredients)).toBe('salt to taste')
  })

  describe('dedupe (B0, 09-29 eval)', () => {
    const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient => ({
      group: null,
      id,
      name,
      prep_note: null,
      qty: null,
      unit: null,
      ...over,
    })
    const nodeConsuming = (...ids: string[]): CookingNodeInfo =>
      ({ ...model.nodes.chop_onion, consumes: ids }) as CookingNodeInfo
    const lookup = (...list: Ingredient[]) => ingredientsById(list)

    it('collapses two ids that render the identical phrase', () => {
      const m = lookup(
        ing('ing_salt', 'Salt', { unit: 'to taste' }),
        ing('ing_salt2', 'Salt', { unit: 'to taste' }),
      )
      expect(quantityLine(nodeConsuming('ing_salt', 'ing_salt2'), m)).toBe('salt to taste')
    })

    it('prints an amount once when the name already starts with it', () => {
      const m = lookup(
        ing('ing_cor', 'A handful of fresh coriander leaves', { qty_text: 'a handful' }),
      )
      expect(quantityLine(nodeConsuming('ing_cor'), m)).toBe('a handful of fresh coriander leaves')
    })

    it('does not mistake a numeric prefix inside a word for the amount', () => {
      const m = lookup(ing('ing_milk', '1% milk', { qty_text: '1', unit: 'cup' }))
      expect(quantityLine(nodeConsuming('ing_milk'), m)).toBe('1 cup 1% milk')
    })

    it('leaves same-name, different-amount phrases alone (not the screen to decide)', () => {
      const m = lookup(
        ing('ing_oil', 'Oil', { qty: 1, unit: 'tsp' }),
        ing('ing_oil2', 'Oil', { qty: 1, unit: 'tbsp' }),
      )
      expect(quantityLine(nodeConsuming('ing_oil', 'ing_oil2'), m)).toBe('1 tsp oil · 1 tbsp oil')
    })
  })

  it('returns null for a node that consumes only components', () => {
    // add_veggies consumes comp_base / comp_capsicum / comp_kadai_masala — no ing_* ids.
    expect(quantityLine(model.nodes.add_veggies, ingredients)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// F2 ingredient chips: `quantityPhrases` is extracted from `quantityLine`, which must
// stay byte-for-byte identical. `quantityLine.golden.json` was captured from the
// UNMODIFIED quantity.ts (before the extraction) over every node of every
// `__fixtures__/*.plan-response.json`, so this compares against the old code's output,
// not against itself.
//
// One deliberate exception: the sabudana entry was regenerated for PR-C (D3). Its four
// nodes that name an ingredient listed in two groups (roasted peanuts, cumin seeds,
// sendha namak) now consume only the portion they use, so it reflects group-resolved
// `consumes` and is no longer the pre-F2 output. Every other entry is still pre-F2.
//
// Second documented exception: the croissant, kadhi-pakora and pumpkin-pancakes entries were
// added with the widened golden corpus (docs/plans/golden-corpus-widen.md). They are generated from
// the current quantity.ts over new fixtures, so they only guard against future change.
//
// Third documented exception: FGC-42 (docs/plans/fgc-42-chip-quantity.md): three entries edited by
// hand, 'to taste salt' -> 'salt to taste' (kadhi x2) and 'to taste sendha namak' -> 'sendha namak
// to taste' (sabudana). The chips now use the Ingredients tab's quantity text. Every other entry
// is unchanged.
// ---------------------------------------------------------------------------

const FIXTURES = fileURLToPath(new URL('../__fixtures__/', import.meta.url))
const fixtureFiles = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.plan-response.json'))
  .sort()
const loadPlan = (file: string) => JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as RecipePlanResponse
const GOLDEN = golden as Record<string, Record<string, string | null>>

describe('quantityLine regression (golden, pre-F2 output)', () => {
  it('covers every plan-response fixture and every node in it', () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(fixtureFiles)
    for (const file of fixtureFiles) {
      expect(Object.keys(GOLDEN[file]).sort()).toEqual(loadPlan(file).graph.nodes.map((n) => n.id).sort())
    }
  })

  it.each(fixtureFiles)('%s: quantityLine is byte-identical to the pre-F2 output for every node', (file) => {
    const plan = loadPlan(file)
    const m = deriveCookingModel(plan)
    const byId = ingredientsById(plan.graph.ingredients)
    for (const [id, expected] of Object.entries(GOLDEN[file])) {
      expect(quantityLine(m.nodes[id], byId), `${file} ${id}`).toBe(expected)
    }
  })

  it('joins with exactly U+0020 U+00B7 U+0020', () => {
    const line = quantityLine(model.nodes.saute_onion, ingredients)!
    const sep = line.slice('3 tbsp oil'.length, line.length - '1 tbsp ginger-garlic paste'.length)
    expect([...sep].map((c) => c.codePointAt(0))).toEqual([0x20, 0xb7, 0x20])
  })
})

describe('quantityPhrases (F2 chips)', () => {
  const ing = (id: string, name: string, over: Partial<Ingredient> = {}): Ingredient => ({
    group: null,
    id,
    name,
    prep_note: null,
    qty: null,
    unit: null,
    ...over,
  })
  const nodeConsuming = (...ids: string[]): CookingNodeInfo =>
    ({ ...model.nodes.chop_onion, consumes: ids }) as CookingNodeInfo
  const lookup = (...list: Ingredient[]) => ingredientsById(list)

  it('quantityLine is always quantityPhrases joined " · " (or null), for every fixture node', () => {
    for (const file of fixtureFiles) {
      const plan = loadPlan(file)
      const m = deriveCookingModel(plan)
      const byId = ingredientsById(plan.graph.ingredients)
      for (const node of Object.values(m.nodes)) {
        const phrases = quantityPhrases(node, byId)
        expect(phrases.length > 0 ? phrases.join(' · ') : null, `${file} ${node.id}`).toBe(quantityLine(node, byId))
      }
    }
  })

  it('a multi-ingredient node gives one phrase per ingredient, amount and unit kept', () => {
    expect(quantityPhrases(model.nodes.saute_onion, ingredients)).toEqual(['3 tbsp oil', '1 tbsp ginger-garlic paste'])
  })

  it('keeps consumes order', () => {
    const m = lookup(ing('ing_b', 'Bay leaf', { qty_text: '2' }), ing('ing_a', 'Anise', { qty_text: '1' }))
    expect(quantityPhrases(nodeConsuming('ing_b', 'ing_a'), m)).toEqual(['2 bay leaf', '1 anise'])
    expect(quantityPhrases(nodeConsuming('ing_a', 'ing_b'), m)).toEqual(['1 anise', '2 bay leaf'])
  })

  it('collapses identical phrases but keeps the same name with different amounts', () => {
    const m = lookup(
      ing('ing_salt', 'Salt', { unit: 'to taste' }),
      ing('ing_salt2', 'Salt', { unit: 'to taste' }),
      ing('ing_oil', 'Oil', { qty: 1, unit: 'tsp' }),
      ing('ing_oil2', 'Oil', { qty: 1, unit: 'tbsp' }),
    )
    expect(quantityPhrases(nodeConsuming('ing_salt', 'ing_oil', 'ing_salt2', 'ing_oil2'), m)).toEqual([
      'salt to taste',
      '1 tsp oil',
      '1 tbsp oil',
    ])
  })

  it('renders every supported amount form exactly as the quantity line does', () => {
    const m = lookup(
      ing('ing_num', 'Paneer', { qty: 250, unit: 'g' }),
      ing('ing_text', 'Haldi (turmeric) powder', { qty_text: '½ tsp' }),
      ing('ing_both', 'Milk', { qty: 2, qty_text: '2', unit: 'cup' }),
      ing('ing_taste', 'Salt', { unit: 'to taste' }),
      ing('ing_fold', 'A handful of fresh coriander leaves', { qty_text: 'a handful' }),
      ing('ing_bare', 'Water'),
    )
    expect(
      quantityPhrases(nodeConsuming('ing_num', 'ing_text', 'ing_both', 'ing_taste', 'ing_fold', 'ing_bare'), m),
    ).toEqual(['250 g paneer', '½ tsp haldi (turmeric) powder', '2 cup milk', 'salt to taste', 'a handful of fresh coriander leaves', 'water'])
  })

  it('returns [] for component-only nodes, unknown ids, an empty ingredient map, and no consumes', () => {
    expect(quantityPhrases(model.nodes.add_veggies, ingredients)).toEqual([])
    expect(quantityPhrases(nodeConsuming('ing_missing'), ingredients)).toEqual([])
    expect(quantityPhrases(model.nodes.chop_onion, new Map())).toEqual([])
    expect(quantityPhrases(nodeConsuming(), ingredients)).toEqual([])
    expect(quantityLine(nodeConsuming(), ingredients)).toBeNull()
  })
})

describe('chips share the Ingredients tab quantity text (FGC-42)', () => {
  const ing = (over: Partial<Ingredient>): Ingredient => ({
    id: 'ing_x',
    name: 'X',
    group: null,
    prep_note: null,
    qty: null,
    unit: null,
    ...over,
  })
  const chipOf = (item: Ingredient, factor?: number) =>
    quantityPhrases({ consumes: [item.id] } as CookingNodeInfo, ingredientsById([item]), factor)
  const tabOf = (item: Ingredient, factor?: number) =>
    panelIngredientGroups([{ group: null, items: [item] }], factor)[0].items[0].trailing

  const cases: Array<{ label: string; item: Ingredient; factor?: number; chip: string; tab: string }> = [
    {
      label: 'duplicate unit',
      item: ing({ name: 'Flour', qty_text: '1 cup', unit: 'cup', qty_amount: { low: 1, high: null, prefix: '', rest: ' cup' } }),
      chip: '1 cup flour',
      tab: '1 cup',
    },
    { label: 'duplicate unit, plural', item: ing({ name: 'Flour', qty_text: '2 cups', unit: 'cup' }), chip: '2 cups flour', tab: '2 cups' },
    {
      label: 'duplicate unit, glued',
      item: ing({ name: 'Flour', qty_text: '250g', unit: 'g', qty_amount: { low: 250, high: null, prefix: '', rest: 'g' } }),
      chip: '250g flour',
      tab: '250g',
    },
    {
      label: 'duplicate unit at 2/3',
      item: ing({ name: 'Flour', qty_text: '1 cup', unit: 'cup', qty_amount: { low: 1, high: null, prefix: '', rest: ' cup' } }),
      factor: 2 / 3,
      chip: '⅔ cup flour',
      tab: '⅔ cup',
    },
    { label: 'to-taste qty_text', item: ing({ name: 'Salt', qty_text: 'to taste' }), chip: 'salt to taste', tab: 'to taste' },
    { label: 'to-taste unit', item: ing({ name: 'Salt', unit: 'to taste' }), chip: 'salt to taste', tab: 'to taste' },
    {
      // Equals-only (Q2): other text next to a to-taste unit is kept, amount first, like the tab.
      label: 'to-taste unit with other text',
      item: ing({ name: 'Salt', unit: 'to taste', qty_text: '1 tsp' }),
      chip: '1 tsp to taste salt',
      tab: '1 tsp to taste',
    },
    {
      label: 'range',
      item: ing({ qty_text: '2-3', unit: 'medium', qty_amount: { low: 2, high: 3, prefix: '', rest: '' } }),
      chip: '2-3 medium x',
      tab: '2-3 medium',
    },
    {
      label: 'count with no unit',
      item: ing({ name: 'Eggs', qty_text: '3', qty_amount: { low: 3, high: null, prefix: '', rest: '' } }),
      chip: '3 eggs',
      tab: '3',
    },
    {
      label: 'unparsed amount, factor 1',
      item: ing({ qty_text: '1 cup (240 ml)', qty_amount: null }),
      factor: 1,
      chip: '1 cup (240 ml) x',
      tab: '1 cup (240 ml)',
    },
    {
      label: 'unparsed amount, factor 2',
      item: ing({ qty_text: '1 cup (240 ml)', qty_amount: null }),
      factor: 2,
      chip: '1 cup (240 ml) x',
      tab: '1 cup (240 ml)',
    },
  ]

  it.each(cases)('$label: chip and tab agree', ({ item, factor, chip, tab }) => {
    expect(tabOf(item, factor)).toBe(tab)
    expect(chipOf(item, factor)).toEqual([chip])
  })
})
