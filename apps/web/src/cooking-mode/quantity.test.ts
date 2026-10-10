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
