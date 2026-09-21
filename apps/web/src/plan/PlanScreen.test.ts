import { describe, expect, it } from 'vitest'

import type { ImportMeta } from '@abc-cook/schema'

import {
  allStagesExpanded,
  overviewControlLabel,
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

describe('allStagesExpanded (M3.2)', () => {
  it('is false for an empty stage list — there is nothing to call "all expanded"', () => {
    expect(allStagesExpanded([], new Set())).toBe(false)
  })

  it('is false when at least one stage is missing from the expanded set', () => {
    expect(allStagesExpanded(['prep', 'cook'], new Set(['prep']))).toBe(false)
  })

  it('is true only once every stage id is present', () => {
    expect(allStagesExpanded(['prep', 'cook'], new Set(['prep', 'cook']))).toBe(true)
  })
})

describe('overviewControlLabel (M3.2)', () => {
  it('reads "Show full recipe" when not everything is expanded', () => {
    expect(overviewControlLabel(false)).toBe('Show full recipe')
  })

  it('reads "Show overview" once everything is expanded', () => {
    expect(overviewControlLabel(true)).toBe('Show overview')
  })
})
