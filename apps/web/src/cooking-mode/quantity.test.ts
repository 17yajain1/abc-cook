import { describe, expect, it } from 'vitest'

import type { Ingredient, RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById, quantityLine } from './quantity'
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
