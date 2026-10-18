import { describe, expect, it } from 'vitest'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

import { deriveCookingModel } from './model'

const KADAI = kadaiPaneer as RecipePlanResponse
const MARKED: GraphProvenance = { nodes: { chop_tomato: { fields: {}, origin: 'added' } } }

describe('deriveCookingModel - added steps (FGC-3)', () => {
  it('carries the added label on the marked node only', () => {
    const model = deriveCookingModel(KADAI, MARKED)
    for (const node of Object.values(model.nodes)) {
      expect(node.addedLabel).toBe(
        node.id === 'chop_tomato' ? 'Added by ABC Cook, not in the recipe' : null,
      )
    }
  })

  it('is null everywhere without provenance (the call shape every existing caller uses)', () => {
    const model = deriveCookingModel(KADAI)
    expect(Object.values(model.nodes).every((n) => n.addedLabel === null)).toBe(true)
  })
})
