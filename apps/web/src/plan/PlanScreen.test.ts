import { describe, expect, it } from 'vitest'

import type { ImportMeta } from '@abc-cook/schema'

import { statusLineFor } from './PlanScreen'

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
