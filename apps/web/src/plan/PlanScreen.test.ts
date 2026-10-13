import { describe, expect, it } from 'vitest'

import type { ImportMeta } from '@abc-cook/schema'

import type { Ingredient } from '@abc-cook/schema'

import {
  ingredientCount,
  statusLineFor,
  toggleStageSet,
} from './PlanScreen'

describe('statusLineFor (A6) — priority: degraded > review_recommended > none', () => {
  it('is null when there is no import meta (fixture-path recipes)', () => {
    expect(statusLineFor(null)).toBeNull()
    expect(statusLineFor(undefined)).toBeNull()
  })

  it('is null when neither degraded nor review_recommended is set', () => {
    const meta: ImportMeta = { degraded: false, review_recommended: false }
    expect(statusLineFor(meta)).toBeNull()
  })

  it('shows the review-recommended line when only that flag is set', () => {
    const meta: ImportMeta = { degraded: false, review_recommended: true }
    expect(statusLineFor(meta)).toBe('Some timings are estimates.')
  })

  it('shows the degraded line when only that flag is set', () => {
    const meta: ImportMeta = { degraded: true, review_recommended: false }
    expect(statusLineFor(meta)).toBe('Plan simplified — steps run one after another.')
  })

  it('prefers degraded over review_recommended when both are set', () => {
    const meta: ImportMeta = { degraded: true, review_recommended: true }
    expect(statusLineFor(meta)).toBe('Plan simplified — steps run one after another.')
  })
})

describe('toggleStageSet (M3.2)', () => {
  it('adds a stage id that is not yet in the set', () => {
    const next = toggleStageSet(new Set(), 'prep')
    expect([...next]).toEqual(['prep'])
  })

  it('removes a stage id that is already in the set', () => {
    const next = toggleStageSet(new Set(['prep', 'cook']), 'prep')
    expect([...next]).toEqual(['cook'])
  })

  it('toggles each stage independently — one call never touches another id', () => {
    const afterPrep = toggleStageSet(new Set(), 'prep')
    const afterCook = toggleStageSet(afterPrep, 'cook')
    expect([...afterCook].sort()).toEqual(['cook', 'prep'])
    const afterPrepAgain = toggleStageSet(afterCook, 'prep')
    expect([...afterPrepAgain]).toEqual(['cook'])
  })

  it('does not mutate the set it was given', () => {
    const original = new Set(['prep'])
    toggleStageSet(original, 'prep')
    expect([...original]).toEqual(['prep'])
  })
})

describe('ingredientCount (R1 tab label)', () => {
  const item = (id: string) => ({ id }) as Ingredient

  it('counts every item across groups', () => {
    expect(
      ingredientCount([
        { group: 'For the khichdi', items: [item('a'), item('b'), item('c')] },
        { group: 'For the chutney', items: [item('d'), item('e')] },
      ]),
    ).toBe(5)
  })

  it('counts an ungrouped list', () => {
    expect(ingredientCount([{ group: null, items: [item('a'), item('b')] }])).toBe(2)
  })

  it('is 0 for a recipe with no ingredients', () => {
    expect(ingredientCount([])).toBe(0)
  })
})
