import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { layoutMap } from './layout'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'

const KADAI = kadaiPaneer as RecipePlanResponse
const MAGGI = maggi as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const DONUTS = homemadeDonuts as RecipePlanResponse
const SHORTCAKE = strawberryShortcake as RecipePlanResponse

const ALL: [string, RecipePlanResponse][] = [
  ['kadai-paneer', KADAI],
  ['maggi-2min', MAGGI],
  ['chicken-biryani', BIRYANI],
  ['homemade-donuts', DONUTS],
  ['strawberry-shortcake', SHORTCAKE],
]

describe.each(ALL)('layoutMap — %s (general invariants)', (_slug, fixture) => {
  const layout = layoutMap(fixture)

  it('is deterministic', () => {
    expect(layoutMap(fixture)).toEqual(layout)
  })

  it('never exceeds the 3-lane maximum', () => {
    expect(layout.lanes).toBeLessThanOrEqual(3)
    for (const card of layout.cards) {
      expect(card.lane).toBeLessThan(3)
      expect(card.lane).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives every card at least the 44px tap floor and 96px width floor', () => {
    for (const card of layout.cards) {
      expect(card.h).toBeGreaterThanOrEqual(44)
      expect(card.w).toBeGreaterThanOrEqual(96)
    }
  })

  it('places every critical-path node in lane 0', () => {
    const criticalSet = new Set(fixture.plan.critical_path)
    for (const card of layout.cards) {
      if (criticalSet.has(card.nodeId)) expect(card.lane).toBe(0)
    }
  })

  it('marks a card borrowed iff the scheduler assigned it a window_id', () => {
    const scheduledById = new Map(fixture.plan.scheduled.map((s) => [s.node_id, s]))
    for (const card of layout.cards) {
      const windowId = scheduledById.get(card.nodeId)?.window_id ?? null
      expect(card.borrowed).toBe(windowId != null)
    }
  })

  it('never overlaps two cards in the same lane', () => {
    const byLane = new Map<number, typeof layout.cards>()
    for (const card of layout.cards) {
      const bucket = byLane.get(card.lane) ?? []
      bucket.push(card)
      byLane.set(card.lane, bucket)
    }
    for (const cards of byLane.values()) {
      const sorted = [...cards].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h)
      }
    }
  })

  it('draws exactly one edge per depends_on pair', () => {
    const expectedPairs = fixture.graph.nodes.flatMap((n) =>
      (n.depends_on ?? []).map((dep) => `${dep}->${n.id}`),
    )
    const actualPairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(actualPairs.sort()).toEqual(expectedPairs.sort())
  })

  it('draws one flow branch per non-critical node the scheduler assigned to a window', () => {
    const criticalSet = new Set(fixture.plan.critical_path)
    const expectedBranchCount = fixture.plan.windows.reduce(
      (n, w) => n + w.assigned.filter((id) => !criticalSet.has(id)).length,
      0,
    )
    const actualBranchCount = layout.flows.reduce((n, f) => n + f.branches.length, 0)
    expect(actualBranchCount).toBe(expectedBranchCount)
  })

  it('has a y-monotone axis and a height that matches it', () => {
    expect(layout.axis.y1).toBeGreaterThan(layout.axis.y0)
    for (let i = 1; i < layout.axis.ticks.length; i++) {
      expect(layout.axis.ticks[i].y).toBeGreaterThan(layout.axis.ticks[i - 1].y)
    }
    expect(layout.height).toBeGreaterThan(layout.axis.y1)
  })

  it('names no card, edge, flow or legend entry after the critical path', () => {
    // plan.critical_path is a layout input only (DESIGN_SYSTEM.md § The Map grammar) —
    // it must never surface as a user-facing category.
    expect(layout).not.toHaveProperty('criticalPath')
    for (const card of layout.cards) {
      expect(card).not.toHaveProperty('onCriticalPath')
    }
  })
})

describe('layoutMap — kadai-paneer specifics', () => {
  const layout = layoutMap(KADAI)

  it('uses 2 lanes', () => {
    expect(layout.lanes).toBe(2)
  })

  it('has no overflow', () => {
    expect(layout.overflow).toEqual([])
  })

  it('sizes the 2-min chop and the 12-min cook on different clamp regions', () => {
    const chopOnion = layout.cards.find((c) => c.nodeId === 'chop_onion')!
    const cookBase = layout.cards.find((c) => c.nodeId === 'cook_tomato_base')!
    // chop_onion (0->3) is a single sqrt-scaled row, comfortably clear of the floor.
    expect(chopOnion.h).toBeCloseTo(34 * Math.sqrt(3) - 12, 1)
    // cook_tomato_base (10->22) spans several breakpoints (10-15-17-19-22) and so
    // accumulates several clamped segments — taller than the single chop row, but the
    // whole map still fits comfortably on a phone.
    expect(cookBase.h).toBeGreaterThan(chopOnion.h)
  })

  it('draws no dashed flow for the single-window recipe’s only window without one', () => {
    expect(layout.flows).toHaveLength(1)
    expect(layout.flows[0].branches.map((b) => b.to)).toEqual([
      'chop_capsicum',
      'cube_paneer',
      'make_kadai_masala',
    ])
  })
})

describe('layoutMap — maggi-2min specifics (no windows)', () => {
  const layout = layoutMap(MAGGI)

  it('has exactly 1 lane', () => {
    expect(layout.lanes).toBe(1)
  })

  it('draws no flows and the legend carries no parallel entry', () => {
    expect(layout.flows).toEqual([])
    expect(layout.legend.hasParallel).toBe(false)
  })

  it('has no overflow', () => {
    expect(layout.overflow).toEqual([])
  })
})

describe('layoutMap — chicken-biryani specifics (4-way concurrency)', () => {
  const layout = layoutMap(BIRYANI)

  it('overflows exactly the two free-floating nodes the fixture forces out', () => {
    expect(layout.overflow).toHaveLength(1)
    expect(layout.overflow[0].nodeIds.sort()).toEqual(['boil_spiced_water', 'fry_birista'])
  })

  it('keeps the dual-role borrowed-and-critical node on the spine, not beside its host', () => {
    const mixMarinade = layout.cards.find((c) => c.nodeId === 'mix_marinade')!
    expect(mixMarinade.lane).toBe(0)
    expect(mixMarinade.borrowed).toBe(true)
  })

  it('draws no flow branch to the dual-role node', () => {
    const w1 = layout.flows.find((f) => f.windowId === 'w1')!
    expect(w1.branches.map((b) => b.to)).not.toContain('mix_marinade')
  })

  it('still draws edges touching the overflowed nodes', () => {
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).toContain('slice_onions->fry_birista')
    expect(pairs).toContain('boil_spiced_water->parboil_rice')
  })
})

describe('layoutMap — homemade-donuts specifics (60-min clamp)', () => {
  const layout = layoutMap(DONUTS)

  it('clamps the first_rise stretch to the 140px ceiling', () => {
    // first_rise (18->78) spans the 18->21 and 21->78 breakpoints; the second, a
    // 57-minute stretch, is the one that hits the ceiling.
    const y18 = layout.axis.ticks.find((t) => t.label === '18 min')!.y
    const y21 = layout.axis.ticks.find((t) => t.label === '21 min')!.y
    const y78 = layout.axis.ticks.find((t) => t.label === '78 min')!.y
    expect(y78 - y21).toBe(140)
    expect(y21 - y18).toBeLessThan(140)
  })

  it('fits within roughly two phone screens', () => {
    expect(layout.height).toBeLessThan(1700) // ~2 screens at 390x844
  })
})

describe('layoutMap — strawberry-shortcake specifics (non-integer capacity)', () => {
  const layout = layoutMap(SHORTCAKE)

  it('still lays out cleanly even though the window capacity is non-integer', () => {
    expect(SHORTCAKE.plan.windows[0].capacity_min).toBe(16.2)
    expect(layout.overflow).toEqual([])
    for (const card of layout.cards) {
      expect(Number.isFinite(card.y)).toBe(true)
      expect(Number.isFinite(card.h)).toBe(true)
    }
  })
})
