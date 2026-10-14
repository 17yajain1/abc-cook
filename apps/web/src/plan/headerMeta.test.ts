import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import sabudana from '@/__fixtures__/sabudana-khichdi.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'

import { deriveCookOutline } from './cookOutline'
import { headerMeta } from './headerMeta'

function meta(payload: RecipePlanResponse, phases = true) {
  const summary = phases ? payload.summary : { ...payload.summary!, phases: null }
  const outline = deriveCookOutline({
    summary,
    nodes: payload.graph.nodes,
    scheduled: payload.plan.scheduled,
    windows: payload.plan.windows,
    savedMin: payload.plan.saved_min,
  })
  return headerMeta(summary, payload.plan.total_min, outline?.card != null)
}

describe('headerMeta (R2 decision 14 + O3)', () => {
  it('keeps "~N min hands-on" next to the card for single-sitting recipes', () => {
    expect(meta(sabudana as RecipePlanResponse)).toEqual({
      primary: '2 hr 50 min – 3 hr 20 min',
      secondary: '~60 min hands-on',
    })
    expect(meta(homemadeDonuts as RecipePlanResponse).secondary).toBe('~40 min hands-on')
  })

  it('shows no timing for a multi-sitting recipe with the card (servings only)', () => {
    expect(meta(pizzaDough as RecipePlanResponse)).toEqual({ primary: null, secondary: null })
    expect(meta(syntheticTwoSittings as RecipePlanResponse)).toEqual({ primary: null, secondary: null })
  })

  it('is R1 unchanged without the card: no phases, or a one-stretch recipe', () => {
    expect(meta(pizzaDough as RecipePlanResponse, false).secondary).toMatch(/^Start about/)
    expect(meta(pizzaDough as RecipePlanResponse, false).primary).not.toBeNull()
    expect(meta(kadaiPaneer as RecipePlanResponse).primary).toBe('35–50 min')
  })
})
