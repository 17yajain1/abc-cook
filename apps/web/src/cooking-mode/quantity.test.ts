import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById, quantityLine } from './quantity'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { deriveCookingModel } from '@/cooking/model'

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

  it('returns null for a node that consumes only components', () => {
    // add_veggies consumes comp_base / comp_capsicum / comp_kadai_masala — no ing_* ids.
    expect(quantityLine(model.nodes.add_veggies, ingredients)).toBeNull()
  })
})
