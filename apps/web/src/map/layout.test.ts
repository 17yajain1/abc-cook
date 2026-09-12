import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { layoutMap } from './layout'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

const KADAI = kadaiPaneer as RecipePlanResponse
const MAGGI = maggi as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const DONUTS = homemadeDonuts as RecipePlanResponse
const SHORTCAKE = strawberryShortcake as RecipePlanResponse
const SYNTHETIC = syntheticTwoWindows as RecipePlanResponse

const ALL: [string, RecipePlanResponse][] = [
  ['kadai-paneer', KADAI],
  ['maggi-2min', MAGGI],
  ['chicken-biryani', BIRYANI],
  ['homemade-donuts', DONUTS],
  ['strawberry-shortcake', SHORTCAKE],
  ['synthetic-two-windows', SYNTHETIC],
]

/** Recomputes each node's expected role straight from plan facts — start_min, end_min,
 * window membership — independent of `layout.ts`'s own implementation, so a test bug
 * that copies the algorithm's mistake can't hide behind it. */
function expectedRoles(fixture: RecipePlanResponse): Map<string, 'mainline' | 'window-child' | 'independent'> {
  const scheduled = fixture.plan.scheduled
  const memberIds = new Set(fixture.plan.windows.flatMap((w) => w.assigned))
  const hostIds = new Set(fixture.plan.windows.map((w) => w.host_node_id))
  const byId = new Map(scheduled.map((s) => [s.node_id, s]))

  const roles = new Map<string, 'mainline' | 'window-child' | 'independent'>()
  for (const id of memberIds) roles.set(id, 'window-child')

  const reserved: { start: number; end: number }[] = []
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    a.start < b.end && b.start < a.end

  const sortedHosts = [...hostIds].sort(
    (a, b) => byId.get(a)!.start_min - byId.get(b)!.start_min || a.localeCompare(b),
  )
  for (const id of sortedHosts) {
    const s = byId.get(id)!
    const interval = { start: s.start_min, end: s.end_min }
    if (reserved.some((r) => overlaps(r, interval))) {
      roles.set(id, 'independent')
    } else {
      roles.set(id, 'mainline')
      reserved.push(interval)
    }
  }

  const rest = scheduled
    .filter((s) => !memberIds.has(s.node_id) && !hostIds.has(s.node_id))
    .sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min || a.node_id.localeCompare(b.node_id))
  for (const s of rest) {
    const interval = { start: s.start_min, end: s.end_min }
    if (reserved.some((r) => overlaps(r, interval))) {
      roles.set(s.node_id, 'independent')
    } else {
      roles.set(s.node_id, 'mainline')
      reserved.push(interval)
    }
  }
  return roles
}

describe.each(ALL)('layoutMap — %s (general invariants)', (_slug, fixture) => {
  const layout = layoutMap(fixture)
  const roles = expectedRoles(fixture)

  it('is deterministic', () => {
    expect(layoutMap(fixture)).toEqual(layout)
  })

  it('gives every visible card the classification the plan facts alone imply', () => {
    for (const card of layout.cards) {
      expect(card.role).toBe(roles.get(card.nodeId))
    }
  })

  it('places every card in exactly one of the two fixed columns by role', () => {
    for (const card of layout.cards) {
      if (card.role === 'mainline') {
        expect(card.x).toBe(20)
        expect(card.w).toBe(190)
      } else {
        expect(card.x).toBe(222)
        expect(card.w).toBe(108)
      }
    }
  })

  it('gives every card at least the 44px tap floor and its own text-fit floor', () => {
    for (const card of layout.cards) {
      expect(card.h).toBeGreaterThanOrEqual(44)
      expect(card.h).toBeGreaterThanOrEqual(card.labelLines.length * 16 + 34)
    }
  })

  it('never overlaps two mainline cards in time', () => {
    const mainline = layout.cards.filter((c) => c.role === 'mainline').sort((a, b) => a.y - b.y)
    for (let i = 1; i < mainline.length; i++) {
      expect(mainline[i].y).toBeGreaterThanOrEqual(mainline[i - 1].y + mainline[i - 1].h)
    }
  })

  it('never overlaps two visible right-column cards in time', () => {
    const right = layout.cards.filter((c) => c.role !== 'mainline').sort((a, b) => a.y - b.y)
    for (let i = 1; i < right.length; i++) {
      expect(right[i].y).toBeGreaterThanOrEqual(right[i - 1].y + right[i - 1].h)
    }
  })

  it('draws edges only between two mainline cards, one per real dependency', () => {
    const mainlineIds = new Set(layout.cards.filter((c) => c.role === 'mainline').map((c) => c.nodeId))
    const expectedPairs = fixture.graph.nodes
      .flatMap((n) => (n.depends_on ?? []).map((dep) => ({ from: dep, to: n.id })))
      .filter((p) => mainlineIds.has(p.from) && mainlineIds.has(p.to))
      .map((p) => `${p.from}->${p.to}`)
    const actualPairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(actualPairs.sort()).toEqual(expectedPairs.sort())
    for (const edge of layout.edges) {
      expect(mainlineIds.has(edge.from)).toBe(true)
      expect(mainlineIds.has(edge.to)).toBe(true)
    }
  })

  it('draws one bracket per window whose host is mainline and has a shown member, and no others', () => {
    for (const bracket of layout.brackets) {
      const host = layout.cards.find((c) => c.nodeId === bracket.hostId)
      expect(host?.role).toBe('mainline')
      expect(bracket.ticks.length).toBeGreaterThan(0)
    }
    const independentIds = new Set(
      layout.cards.filter((c) => c.role === 'independent').map((c) => c.nodeId),
    )
    for (const bracket of layout.brackets) {
      for (const tick of bracket.ticks) expect(independentIds.has(tick.to)).toBe(false)
    }
  })

  it('every scheduled node is either a visible card or belongs to exactly one fold group', () => {
    const cardIds = new Set(layout.cards.map((c) => c.nodeId))
    const foldedIds = layout.folds.flatMap((f) => f.nodeIds)
    const foldedSet = new Set(foldedIds)
    expect(foldedIds.length).toBe(foldedSet.size) // no id folded twice
    for (const s of fixture.plan.scheduled) {
      expect(cardIds.has(s.node_id) || foldedSet.has(s.node_id)).toBe(true)
    }
  })

  it('every fold anchor is itself a visible card', () => {
    const cardIds = new Set(layout.cards.map((c) => c.nodeId))
    for (const fold of layout.folds) {
      expect(cardIds.has(fold.anchorNodeId)).toBe(true)
      expect(fold.text).toBe(`+${fold.nodeIds.length} more`)
    }
  })

  it('shows a note only on a mainline card at least 60px tall', () => {
    for (const card of layout.cards) {
      if (card.note) {
        expect(card.role).toBe('mainline')
        expect(card.h).toBeGreaterThanOrEqual(60)
      }
    }
  })

  it('has a height taller than its last card', () => {
    const maxBottom = Math.max(...layout.cards.map((c) => c.y + c.h))
    expect(layout.height).toBeGreaterThan(maxBottom)
  })

  it('names no card, edge, bracket or legend entry after the critical path', () => {
    // plan.critical_path is not a Map concept at all in the M2.75 grammar.
    expect(layout).not.toHaveProperty('criticalPath')
    expect(layout).not.toHaveProperty('lanes')
    expect(layout).not.toHaveProperty('axis')
    for (const card of layout.cards) {
      expect(card).not.toHaveProperty('onCriticalPath')
      expect(card).not.toHaveProperty('lane')
      expect(card).not.toHaveProperty('borrowed')
    }
  })
})

describe('layoutMap — kadai-paneer specifics', () => {
  const layout = layoutMap(KADAI)

  it('has no folds — the only window has 3 members, none of it collides', () => {
    expect(layout.folds).toEqual([])
  })

  it('places chop_tomato on the mainline between saute_onion and cook_tomato_base with no arrow from saute_onion', () => {
    const chopTomato = layout.cards.find((c) => c.nodeId === 'chop_tomato')!
    expect(chopTomato.role).toBe('mainline')
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).not.toContain('saute_onion->chop_tomato')
    expect(pairs).toContain('chop_tomato->cook_tomato_base')
    expect(pairs).toContain('saute_onion->cook_tomato_base') // skip edge, same merge target
  })

  it('draws one bracket with 3 ticks for the single window', () => {
    expect(layout.brackets).toHaveLength(1)
    expect(layout.brackets[0].ticks.map((t) => t.to)).toEqual(['chop_capsicum', 'cube_paneer', 'make_kadai_masala'])
  })
})

describe('layoutMap — maggi-2min specifics (fully serial)', () => {
  const layout = layoutMap(MAGGI)

  it('has no brackets, no folds, and no parallel legend entry', () => {
    expect(layout.brackets).toEqual([])
    expect(layout.folds).toEqual([])
    expect(layout.legend.hasParallel).toBe(false)
  })

  it('every card is mainline', () => {
    expect(layout.cards.every((c) => c.role === 'mainline')).toBe(true)
  })
})

describe('layoutMap — chicken-biryani specifics (4-way concurrency + fold)', () => {
  const layout = layoutMap(BIRYANI)

  it('classifies the mainline set exactly as the interval walk demands', () => {
    const mainlineIds = layout.cards.filter((c) => c.role === 'mainline').map((c) => c.nodeId).sort()
    expect(mainlineIds).toEqual(['soak_rice', 'cook_chicken', 'layer_biryani', 'dum', 'rest_and_serve'].sort())
  })

  it('shows marinate_chicken as a visible independent card beside soak_rice', () => {
    // The other three independents (boil_spiced_water, fry_birista, parboil_rice) are
    // independent too, but each collides in time with something already shown in the
    // right column, so they fold — see the fold-group tests below. Only a card that
    // survives the fold gets its own MapCard.
    const marinate = layout.cards.find((c) => c.nodeId === 'marinate_chicken')!
    expect(marinate.role).toBe('independent')
  })

  it('folds the 4th w1 member and its two time-colliding independents under mix_marinade', () => {
    const w1Fold = layout.folds.find((f) => f.anchorNodeId === 'mix_marinade')!
    expect(w1Fold.nodeIds.sort()).toEqual(['boil_spiced_water', 'fry_birista', 'soak_saffron'].sort())
  })

  it('folds the collision on parboil_rice under marinate_chicken', () => {
    const w2Fold = layout.folds.find((f) => f.anchorNodeId === 'marinate_chicken')!
    expect(w2Fold.nodeIds).toEqual(['parboil_rice'])
  })

  it('draws no edge touching an overflowed or independent node', () => {
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).not.toContain('slice_onions->fry_birista')
    expect(pairs).not.toContain('boil_spiced_water->parboil_rice')
  })
})

describe('layoutMap — homemade-donuts specifics (long window + independent on the critical path)', () => {
  const layout = layoutMap(DONUTS)

  it('classifies proof_donuts independent despite sitting on the critical path', () => {
    const proof = layout.cards.find((c) => c.nodeId === 'proof_donuts')!
    expect(proof.role).toBe('independent')
    expect(proof.note).toBeNull() // notes are mainline-only
  })

  it('gives first_rise a tall but bounded mainline card', () => {
    const firstRise = layout.cards.find((c) => c.nodeId === 'first_rise')!
    expect(firstRise.role).toBe('mainline')
    expect(firstRise.h).toBeGreaterThanOrEqual(120)
    expect(firstRise.h).toBeLessThan(200)
    expect(firstRise.note).toBe('(hands off)')
  })

  it('draws the skip edge from fry_donuts to glaze_donuts over make_glaze', () => {
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).toContain('fry_donuts->glaze_donuts')
    expect(pairs).toContain('make_glaze->glaze_donuts')
  })

  it('fits within roughly two phone screens', () => {
    expect(layout.height).toBeLessThan(1700)
  })
})

describe('layoutMap — strawberry-shortcake specifics (independent overlap, dropped edge)', () => {
  const layout = layoutMap(SHORTCAKE)

  it('classifies macerate_berries independent and unbracketed', () => {
    const macerate = layout.cards.find((c) => c.nodeId === 'macerate_berries')!
    expect(macerate.role).toBe('independent')
    expect(layout.brackets.every((b) => b.ticks.every((t) => t.to !== 'macerate_berries'))).toBe(true)
  })

  it('does not draw macerate_berries -> assemble_shortcakes (source is not mainline)', () => {
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).not.toContain('macerate_berries->assemble_shortcakes')
  })

  it('still lays out cleanly with a non-integer window capacity', () => {
    expect(SHORTCAKE.plan.windows[0].capacity_min).toBe(16.2)
    for (const card of layout.cards) {
      expect(Number.isFinite(card.y)).toBe(true)
      expect(Number.isFinite(card.h)).toBe(true)
    }
  })
})

describe('layoutMap — synthetic-two-windows specifics (a fixture the algorithm has never seen)', () => {
  const layout = layoutMap(SYNTHETIC)

  it('classifies soak_dried_beans independent (it overlaps simmer_stew, it is not a member of w1)', () => {
    // It also happens to collide in time with the right column's own occupancy once
    // dice_potatoes is shown, so — like Biryani's boil_spiced_water — it folds rather
    // than rendering its own card. Its classification is still independent, not
    // window-child: proven by the fold-group test below, which is the only place a
    // folded node's role is externally observable.
    const cardIds = new Set(layout.cards.map((c) => c.nodeId))
    expect(cardIds.has('soak_dried_beans')).toBe(false)
    const fold = layout.folds.find((f) => f.nodeIds.includes('soak_dried_beans'))
    expect(fold).toBeDefined()
  })

  it('keeps two consecutive non-dependent mainline cards without inventing an edge', () => {
    const pairs = layout.edges.map((e) => `${e.from}->${e.to}`)
    expect(pairs).not.toContain('chop_vegetables->toast_whole_spices')
    expect(pairs).toContain('chop_vegetables->simmer_stew')
    expect(pairs).toContain('toast_whole_spices->simmer_stew')
  })

  it('folds the 4th member of the 4-member window plus its time-colliding independent under one label', () => {
    const fold = layout.folds.find((f) => f.anchorNodeId === 'mince_garlic_ginger')!
    expect(fold.nodeIds.sort()).toEqual(['rinse_rice', 'soak_dried_beans'].sort())
  })

  it('draws two brackets, 3 ticks then 1', () => {
    expect(layout.brackets).toHaveLength(2)
    const byWindow = new Map(layout.brackets.map((b) => [b.windowId, b.ticks.length]))
    expect(byWindow.get('w1')).toBe(3)
    expect(byWindow.get('w2')).toBe(1)
  })

  it('wraps the long window-child label onto multiple lines instead of clipping it', () => {
    const crush = layout.cards.find((c) => c.nodeId === 'crush_spice_blend')!
    expect(crush.role).toBe('window-child')
    expect(crush.labelLines.length).toBeGreaterThan(1)
    expect(crush.labelLines.join(' ')).toBe('Crush toasted spice blend')
    expect(crush.h).toBeGreaterThanOrEqual(crush.labelLines.length * 16 + 34)
  })
})

/**
 * A hand-built `RecipePlanResponse` — never routed through the real scheduler — purely
 * to isolate `hasParallel` from every golden fixture, none of which happens to have an
 * independent-overlap card with zero windows. `b` overlaps `a` in time and belongs to no
 * window, so it classifies independent; there is no window at all, so no bracket can
 * ever be drawn (CP2, "Fix hasParallel").
 */
function independentOnlyPlan(): RecipePlanResponse {
  const node = (id: string) => ({
    id,
    stage: 's',
    label: id,
    instruction: '',
    kind: 'prep' as const,
    attention: 'hands_on' as const,
    duration_min: 5,
    duration_typical: 5,
    duration_max: 5,
    station: 'counter' as const,
    depends_on: [],
    interruptible: true,
  })
  return {
    graph: {
      id: 'inline-independent-only',
      title: 'Inline fixture',
      servings: 1,
      cuisine: null,
      source: { kind: 'text', value: 'inline test fixture, not a real recipe', imported_at: '2026-01-01T00:00:00Z' },
      ingredients: [],
      nodes: [node('a'), node('b')],
      stages: [{ id: 's', label: 'Stage', color_key: 's' }],
      stated_total_min: null,
    },
    plan: {
      graph_id: 'inline-independent-only',
      scheduled: [
        { node_id: 'a', start_min: 0, end_min: 10, occupies_cook: true, window_id: null, rank_in_window: null },
        { node_id: 'b', start_min: 5, end_min: 15, occupies_cook: true, window_id: null, rank_in_window: null },
      ],
      windows: [],
      total_min: 15,
      serial_min: 10,
      saved_min: -5,
      critical_path: ['a'],
      warnings: [],
    },
    stages: [],
  } as unknown as RecipePlanResponse
}

describe('layoutMap — hasParallel semantics (CP2)', () => {
  it('is false for an independent-only plan: an independent card draws no bracket, so it must not key the dashed legend entry', () => {
    const layout = layoutMap(independentOnlyPlan())
    const independentCard = layout.cards.find((c) => c.role === 'independent')
    expect(independentCard).toBeDefined() // sanity: the fixture does produce one
    expect(layout.brackets).toEqual([])
    expect(layout.legend.hasParallel).toBe(false)
  })

  it('is true as soon as the plan has a real window, independent of how many independent cards also exist', () => {
    // chicken-biryani has both windows and independents; hasParallel must still trace
    // to the windows, not merely to "something concurrent exists".
    const layout = layoutMap(BIRYANI)
    expect(layout.brackets.length).toBeGreaterThan(0)
    expect(layout.legend.hasParallel).toBe(true)
  })
})
