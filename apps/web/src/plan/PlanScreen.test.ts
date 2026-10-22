import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import croissant from '@/__fixtures__/croissant.plan-response.json'

import { derivePlan } from './derive'

import type { Ingredient } from '@abc-cook/schema'

import {
  allStageKeys,
  ingredientCount,
  isCompactHeader,
  PlanScreen,
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

describe('ingredientCount (the N in "N ingredients")', () => {
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

describe('isCompactHeader (R1 sticky bar)', () => {
  // The page's title ends 420px down the scroll area; the bar is 56px tall (the title row height).
  it('stays on the full header at the very top', () => {
    expect(isCompactHeader(0, 420, 56)).toBe(false)
  })

  it('stays on the full header until the title reaches the bar', () => {
    expect(isCompactHeader(363, 420, 56)).toBe(false)
  })

  it('switches to the compact bar once the title reaches it', () => {
    expect(isCompactHeader(364, 420, 56)).toBe(true)
    expect(isCompactHeader(900, 420, 56)).toBe(true)
  })

  it('accounts for a top safe-area inset in the bar offset', () => {
    // 47px notch inset: the bar is 103px tall, so it takes over 47px sooner.
    expect(isCompactHeader(317, 420, 103)).toBe(true)
    expect(isCompactHeader(316, 420, 103)).toBe(false)
  })

  it('never shows the bar at scroll 0, even on a page too short to have a header gap', () => {
    expect(isCompactHeader(0, 40, 56)).toBe(false)
  })
})

describe('allStageKeys (D2: every card starts open)', () => {
  it('is one key per rendered card, in order', () => {
    const plan = derivePlan(croissant as RecipePlanResponse)
    expect(allStageKeys(plan)).toEqual(plan.stages.map((s) => s.key))
    expect(allStageKeys(plan).length).toBeGreaterThan(0)
  })

  it('renders every stage open, with no tab row', () => {
    const out = renderToStaticMarkup(
      createElement(PlanScreen, { plan: derivePlan(croissant as RecipePlanResponse), onBack: () => {}, onStartCooking: () => {} }),
    )
    expect(out).not.toContain('aria-expanded="false"')
    expect(out).toContain('aria-expanded="true"')
    expect(out).not.toContain('aria-pressed')
    expect(out).toContain('What you need')
  })
})

describe('FGC-16 (F1): the status line sits under the title, before What you need', () => {
  const LINE = 'Plan simplified — steps run one after another.'
  const meta = { degraded: true, review_recommended: false, warnings: ['degraded'] } as unknown as ImportMeta
  const html = (staleness?: { kind: 'stale' | 'unchecked' }) =>
    renderToStaticMarkup(
      createElement(PlanScreen, {
        plan: derivePlan(croissant as RecipePlanResponse),
        onBack: () => {},
        onStartCooking: () => {},
        importMeta: meta,
        staleness,
      }),
    )

  it('comes after the title and before What you need and the steps', () => {
    const out = html()
    const at = out.indexOf(LINE)
    expect(at).toBeGreaterThan(out.indexOf('</h1>'))
    expect(at).toBeLessThan(out.indexOf('What you need'))
    expect(at).toBeLessThan(out.indexOf('Steps'))
  })

  it('shows once', () => {
    expect(html().split(LINE).length - 1).toBe(1)
  })

  it('is still absent while the staleness line shows (A5)', () => {
    expect(html({ kind: 'stale' })).not.toContain(LINE)
  })
})
