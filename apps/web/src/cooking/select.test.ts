import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from './model'
import {
  awayClass,
  current,
  executable,
  foreignLifecycle,
  handover,
  holding,
  lifecycle,
  nextRequiredAt,
  role,
  sittingIndex,
  skipAllowed,
  waitSubject,
} from './select'
import type { CookingModel, CookingSession, NodeState } from './types'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

/**
 * CP1 covers only the pure model/selector layer (`types`, `constants`, `model`,
 * `select`) — `engine.ts`/`store.ts` land at CP2. Every scenario below therefore
 * hand-constructs the `NodeState` map a real `startNode`/`markDone`/`acknowledge` call
 * would have produced, rather than calling an action; `select.ts` never validates
 * transition history, only reads the state it is given, so this is a faithful test of
 * the selector layer in isolation. Where a test-matrix row describes an action's effect
 * (row 8's "acknowledge marks both done", rows 12/13's "sets finishedAt"), the
 * assertion is on the selector's reading of that already-applied effect.
 */

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const DONUTS = homemadeDonuts as RecipePlanResponse
const PIZZA = pizzaDough as RecipePlanResponse
const SHORTCAKE = strawberryShortcake as RecipePlanResponse
const TWO_WINDOWS = syntheticTwoWindows as RecipePlanResponse
const TWO_SITTINGS = syntheticTwoSittings as RecipePlanResponse
const MAGGI = maggi2min as RecipePlanResponse

const T0 = 1_700_000_000_000
const m = (min: number) => min * 60_000

function emptySession(model: CookingModel): CookingSession {
  const nodes: Record<string, NodeState> = {}
  for (const id of model.order) nodes[id] = { state: 'pending' }
  return {
    version: 1,
    planKey: 'server:test',
    graphId: model.graphId,
    startedAt: T0,
    lastSeenAt: T0,
    leftAt: null,
    finishedAt: null,
    lastTransition: null,
    nodes,
  }
}

/** Patches a session's `nodes` map. Freely mixes `done`/`running`/`pending` regardless
 * of dependency order — `select.ts` reads state, it does not validate history. */
function withNodes(session: CookingSession, patch: Record<string, NodeState>): CookingSession {
  return { ...session, nodes: { ...session.nodes, ...patch } }
}

function runningAt(startedAt: number, endsAt: number, extendedMs = 0): NodeState {
  return { state: 'running', startedAt, endsAt, extendedMs }
}

function doneAt(at: number, endsAt: number | null = null): NodeState {
  return { state: 'done', at, endsAt }
}

// ---------------------------------------------------------------------------
// Rows 7, 8, 9, 10, 10a, 11 — required / handover / holding (§F3)
// ---------------------------------------------------------------------------

describe('handover / holding — §F3', () => {
  it('row 7: biryani T0+6.2, quiet — boil_spiced_water expired but holding; no handover', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = emptySession(model)
    s = withNodes(s, {
      boil_spiced_water: runningAt(T0, T0 + m(6)),
      soak_rice: runningAt(T0, T0 + m(20)),
    })
    const now = T0 + m(6.2)

    expect(handover(model, s, now)).toBeNull()
    expect(holding(model, s, now)).toEqual(['boil_spiced_water'])
  })

  it('row 8: biryani T0+20, two producers — one handover; post-acknowledge current is parboil_rice', () => {
    const model = deriveCookingModel(BIRYANI)
    let pre = emptySession(model)
    pre = withNodes(pre, {
      boil_spiced_water: runningAt(T0, T0 + m(6)),
      soak_rice: runningAt(T0, T0 + m(20)),
    })
    const now = T0 + m(20)

    const h = handover(model, pre, now)
    expect(h).toEqual({
      producers: ['boil_spiced_water', 'soak_rice'],
      consumer: 'parboil_rice',
      reason: 'consumer_ready',
      overrunMs: m(14),
    })

    // Simulate `acknowledge`: both producers done, and every hands-on node earlier in
    // execution order than parboil_rice already done, so it is the first pending node.
    let post = withNodes(pre, {
      boil_spiced_water: doneAt(now, T0 + m(6)),
      soak_rice: doneAt(now, T0 + m(20)),
      slice_onions: doneAt(T0 + m(4)),
      fry_birista: doneAt(T0 + m(14)),
      chop_mint_coriander: doneAt(T0 + m(7)),
      mix_marinade: doneAt(T0 + m(10)),
      soak_saffron: doneAt(T0 + m(11)),
      marinate_chicken: runningAt(T0 + m(10), T0 + m(25)),
    })
    expect(current(model, post)).toBe('parboil_rice')
  })

  it('row 9: biryani T0+14, must_attend — fry_birista (periodic) required though cook_chicken is blocked', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = emptySession(model)
    s = withNodes(s, {
      boil_spiced_water: runningAt(T0, T0 + m(6)),
      soak_rice: runningAt(T0, T0 + m(20)),
      fry_birista: runningAt(T0 + m(4), T0 + m(14)),
      marinate_chicken: runningAt(T0 + m(10), T0 + m(25)),
    })
    const now = T0 + m(14)

    expect(handover(model, s, now)).toEqual({
      producers: ['fry_birista'],
      consumer: null,
      reason: 'must_attend',
      overrunMs: 0,
    })
  })

  it('row 10: must_attend fires for a periodic host even with its consumer blocked', () => {
    const donutsModel = deriveCookingModel(DONUTS)
    let donutsSession = emptySession(donutsModel)
    donutsSession = withNodes(donutsSession, {
      proof_donuts: doneAt(T0 + m(113), T0 + m(113)),
      heat_oil: doneAt(T0 + m(100), T0 + m(100)),
      fry_donuts: runningAt(T0 + m(113), T0 + m(127)),
    })
    const donutsNow = T0 + m(127)
    expect(handover(donutsModel, donutsSession, donutsNow)).toEqual({
      producers: ['fry_donuts'],
      consumer: null,
      reason: 'must_attend',
      overrunMs: 0,
    })

    const kadaiModel = deriveCookingModel(KADAI)
    let kadaiSession = emptySession(kadaiModel)
    kadaiSession = withNodes(kadaiSession, { cook_tomato_base: runningAt(T0 + m(10), T0 + m(22)) })
    const kadaiNow = T0 + m(22)
    expect(handover(kadaiModel, kadaiSession, kadaiNow)).toEqual({
      producers: ['cook_tomato_base'],
      consumer: null,
      reason: 'must_attend',
      overrunMs: 0,
    })
  })

  it('row 10a/11: every unattended expired node with a blocked consumer holds, never a handover', () => {
    const donutsModel = deriveCookingModel(DONUTS)
    let donutsSession = emptySession(donutsModel)
    donutsSession = withNodes(donutsSession, {
      heat_oil: runningAt(T0 + m(88), T0 + m(100)),
      proof_donuts: runningAt(T0 + m(88), T0 + m(113)),
    })
    const donutsNow = T0 + m(100)
    expect(handover(donutsModel, donutsSession, donutsNow)).toBeNull()
    expect(holding(donutsModel, donutsSession, donutsNow)).toEqual(['heat_oil'])

    const shortcakeModel = deriveCookingModel(SHORTCAKE)
    let shortcakeSession = emptySession(shortcakeModel)
    shortcakeSession = withNodes(shortcakeSession, {
      macerate_berries: runningAt(T0 + m(11), T0 + m(31)),
      cool_shortcakes: runningAt(T0 + m(24), T0 + m(34)),
    })
    const shortcakeNow = T0 + m(34)
    expect(handover(shortcakeModel, shortcakeSession, shortcakeNow)).toBeNull()
    expect(new Set(holding(shortcakeModel, shortcakeSession, shortcakeNow))).toEqual(
      new Set(['macerate_berries', 'cool_shortcakes']),
    )

    const twoWindowsModel = deriveCookingModel(TWO_WINDOWS)
    let twoWindowsSession = emptySession(twoWindowsModel)
    twoWindowsSession = withNodes(twoWindowsSession, {
      simmer_stew: runningAt(T0 + m(8), T0 + m(33)),
      soak_dried_beans: runningAt(T0 + m(8), T0 + m(28)),
    })
    const twoWindowsNow = T0 + m(28)
    expect(handover(twoWindowsModel, twoWindowsSession, twoWindowsNow)).toBeNull()
    expect(holding(twoWindowsModel, twoWindowsSession, twoWindowsNow)).toEqual(['soak_dried_beans'])

    // Biryani's own case (row 7) is covered above; re-asserted here to keep row 10a's
    // four-fixture list together.
    const biryaniModel = deriveCookingModel(BIRYANI)
    let biryaniSession = emptySession(biryaniModel)
    biryaniSession = withNodes(biryaniSession, {
      boil_spiced_water: runningAt(T0, T0 + m(6)),
      soak_rice: runningAt(T0, T0 + m(20)),
    })
    const biryaniNow = T0 + m(6.2)
    expect(handover(biryaniModel, biryaniSession, biryaniNow)).toBeNull()
    expect(holding(biryaniModel, biryaniSession, biryaniNow)).toEqual(['boil_spiced_water'])
  })
})

// ---------------------------------------------------------------------------
// Rows 12, 13 — finish (§F5 role, §C3 sink)
// ---------------------------------------------------------------------------

describe('finish — §F5/§C3/§M1', () => {
  it('row 12: pizza sink is hands-off — expiry produces a finish handover; acknowledging sets lifecycle finished', () => {
    const model = deriveCookingModel(PIZZA)
    let running = emptySession(model)
    running = withNodes(running, {
      step_transfer_the_pizza_to_a_cutting: runningAt(T0 + m(1469), T0 + m(1470)),
    })
    const now = T0 + m(1470)

    expect(handover(model, running, now)).toEqual({
      producers: ['step_transfer_the_pizza_to_a_cutting'],
      consumer: null,
      reason: 'finish',
      overrunMs: 0,
    })
    expect(role(model, running, now)).toBe('handover')

    const acknowledged = withNodes(
      { ...running, finishedAt: now },
      { step_transfer_the_pizza_to_a_cutting: doneAt(now, T0 + m(1470)) },
    )
    // §M1: finished is a lifecycle fact, not a Role — role() is no longer consulted
    // once lifecycle is 'finished' (that's the caller's job, checked first).
    expect(lifecycle(model, acknowledged, now)).toBe('finished')
  })

  it('row 13: kadai finish is hands-on — current until done, then lifecycle finished', () => {
    const model = deriveCookingModel(KADAI)
    let beforeDone = emptySession(model)
    beforeDone = withNodes(beforeDone, {
      chop_onion: doneAt(T0),
      saute_onion: doneAt(T0),
      chop_tomato: doneAt(T0),
      cook_tomato_base: doneAt(T0, T0),
      chop_capsicum: doneAt(T0),
      cube_paneer: doneAt(T0),
      make_kadai_masala: doneAt(T0),
      add_veggies: doneAt(T0),
      add_paneer: doneAt(T0),
    })
    const now = T0 + m(34)
    expect(current(model, beforeDone)).toBe('finish')
    expect(role(model, beforeDone, now)).toBe('task')

    const afterDone = withNodes({ ...beforeDone, finishedAt: now }, { finish: doneAt(now, null) })
    expect(lifecycle(model, afterDone, now)).toBe('finished')
  })
})

// ---------------------------------------------------------------------------
// Rows 19, 20 — wait subject (§F6)
// ---------------------------------------------------------------------------

describe('waitSubject — §F6', () => {
  it('row 19: biryani T0+11, w1 done — current null, role wait, subject fry_birista, judgeable', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = emptySession(model)
    s = withNodes(s, {
      boil_spiced_water: runningAt(T0, T0 + m(6)),
      soak_rice: runningAt(T0, T0 + m(20)),
      slice_onions: doneAt(T0 + m(4)),
      fry_birista: runningAt(T0 + m(4), T0 + m(14)),
      chop_mint_coriander: doneAt(T0 + m(7)),
      mix_marinade: doneAt(T0 + m(10)),
      marinate_chicken: runningAt(T0 + m(10), T0 + m(25)),
      soak_saffron: doneAt(T0 + m(11)),
    })
    const now = T0 + m(11)

    expect(current(model, s)).toBeNull()
    expect(handover(model, s, now)).toBeNull()
    expect(role(model, s, now)).toBe('wait')
    expect(waitSubject(model, s, now)).toEqual({ nodeId: 'fry_birista', judgeable: true })
  })

  it('row 20: maggi T0+0.5 and donuts T0+22 are judgeable; a soak-only biryani wait is not', () => {
    const maggiModel = deriveCookingModel(MAGGI)
    let maggiSession = emptySession(maggiModel)
    maggiSession = withNodes(maggiSession, { boil_water: runningAt(T0, T0 + m(3)) })
    expect(waitSubject(maggiModel, maggiSession, T0 + m(0.5))).toEqual({ nodeId: 'boil_water', judgeable: true })

    const donutsModel = deriveCookingModel(DONUTS)
    let donutsSession = emptySession(donutsModel)
    donutsSession = withNodes(donutsSession, {
      grease_pan: doneAt(T0 + m(21)),
      first_rise: runningAt(T0 + m(18), T0 + m(78)),
    })
    expect(waitSubject(donutsModel, donutsSession, T0 + m(22))).toEqual({ nodeId: 'first_rise', judgeable: true })

    const biryaniModel = deriveCookingModel(BIRYANI)
    let biryaniSession = emptySession(biryaniModel)
    biryaniSession = withNodes(biryaniSession, {
      boil_spiced_water: doneAt(T0),
      soak_rice: runningAt(T0, T0 + m(20)),
    })
    expect(waitSubject(biryaniModel, biryaniSession, T0 + m(2))).toEqual({ nodeId: 'soak_rice', judgeable: false })
  })
})

// ---------------------------------------------------------------------------
// Rows 29, 30, 31, 32 — away class / nextRequiredAt (§F7)
// ---------------------------------------------------------------------------

describe('awayClass / nextRequiredAt — §F7', () => {
  it('row 29: pizza sitting break 1 — nextRequiredAt is 280, not a later moment', () => {
    const model = deriveCookingModel(PIZZA)
    let s = emptySession(model)
    s = withNodes(s, {
      step_in_a_small_bowl_stir_together: doneAt(T0 + m(5)),
      step_measure_3_1_3_cups_flour: doneAt(T0 + m(8)),
      step_knead_by_hand_2_minutes_dough: doneAt(T0 + m(10)),
      step_cover_the_bowl_with_plastic_wrap: runningAt(T0 + m(10), T0 + m(280)),
    })
    const now = T0 + m(10)

    expect(current(model, s)).toBeNull()
    expect(nextRequiredAt(model, s)).toBe(T0 + m(280))
    expect(awayClass(model, s, now)).toBe('sitting_break')
    expect(sittingIndex(model, s)).toBe(0)
  })

  it('row 30: pizza sitting break 2 — nextRequiredAt is 1370 (the fridge), not 1440 (next sitting)', () => {
    const model = deriveCookingModel(PIZZA)
    let s = emptySession(model)
    s = withNodes(s, {
      step_in_a_small_bowl_stir_together: doneAt(T0 + m(5)),
      step_measure_3_1_3_cups_flour: doneAt(T0 + m(8)),
      step_knead_by_hand_2_minutes_dough: doneAt(T0 + m(10)),
      step_cover_the_bowl_with_plastic_wrap: doneAt(T0 + m(280), T0 + m(280)),
      step_transfer_dough_to_a_floured_surface: doneAt(T0 + m(290)),
      step_cover_and_refrigerate_overnight_18_hours: runningAt(T0 + m(290), T0 + m(1370)),
    })
    const now = T0 + m(290)

    expect(nextRequiredAt(model, s)).toBe(T0 + m(1370))
    expect(awayClass(model, s, now)).toBe('sitting_break')
  })

  it('row 31: donuts long wait — 57 min is long_wait, not sitting_break', () => {
    const model = deriveCookingModel(DONUTS)
    let s = emptySession(model)
    s = withNodes(s, {
      bloom_yeast: doneAt(T0),
      mix_dough: doneAt(T0 + m(4)),
      knead_dough: doneAt(T0 + m(10)),
      first_rise: runningAt(T0 + m(18), T0 + m(78)),
      grease_pan: doneAt(T0 + m(21)),
      // make_glaze has no dependencies (COOKING_GRAPH.md invariant), so it is
      // independently executable — pin it done too, or `current` finds it and this
      // stops being the "nothing to do but wait" scenario the row describes.
      make_glaze: doneAt(T0 + m(21)),
    })
    const now = T0 + m(21)

    expect(current(model, s)).toBeNull()
    expect(nextRequiredAt(model, s)).toBe(T0 + m(78))
    expect(awayClass(model, s, now)).toBe('long_wait')
  })

  it('row 32: synthetic-two-sittings — sitting break to 483, then handover names saute_and_add_beans', () => {
    const model = deriveCookingModel(TWO_SITTINGS)
    let s = emptySession(model)
    s = withNodes(s, {
      rinse_beans: doneAt(T0 + m(3)),
      soak_beans: runningAt(T0 + m(3), T0 + m(483)),
    })
    const now = T0 + m(3)

    expect(nextRequiredAt(model, s)).toBe(T0 + m(483))
    expect(awayClass(model, s, now)).toBe('sitting_break')

    const reopenNow = T0 + m(483)
    const h = handover(model, s, reopenNow)
    expect(h?.consumer).toBe('saute_and_add_beans')
  })
})

// A structural sanity check for the `executable` helper used throughout this file —
// not a numbered row, but cheap and directly exercises the §F2 predicate the rest of
// this suite leans on.
describe('executable — §F2', () => {
  it('a node with an undone dependency is never executable, regardless of its own state', () => {
    const model = deriveCookingModel(KADAI)
    const s = emptySession(model)
    expect(executable(model, s, 'add_veggies')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// CP1 audit coverage additions (2026-09-22) — five lightweight selector-only gaps
// the audit surfaced. No engine/store behavior; same hand-constructed-state style as
// the rest of this file.
// ---------------------------------------------------------------------------

describe('audit gap: periodic + a genuinely ready consumer — must_attend still wins (§F3 precedence)', () => {
  it('biryani: fry_birista is periodic AND marinate_chicken (cook_chicken\'s other dep) is already done', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = emptySession(model)
    s = withNodes(s, {
      fry_birista: runningAt(T0 + m(4), T0 + m(14)),
      // Makes cook_chicken genuinely ready too (both its deps satisfied), not just
      // blocked as in rows 9/10 — proving must_attend wins even under real overlap,
      // not merely because the consumer_ready branch was unreachable.
      marinate_chicken: doneAt(T0 + m(14)),
    })
    const now = T0 + m(14)

    const h = handover(model, s, now)
    expect(h?.reason).toBe('must_attend')
    expect(h?.consumer).toBeNull()
    expect(h?.producers).toEqual(['fry_birista'])
  })
})

describe('audit gap: sittingIndex() with current != null (§F10)', () => {
  it('pizza: current in sitting 2 wins over the more-recently-done node in sitting 1', () => {
    const model = deriveCookingModel(PIZZA)
    let s = emptySession(model)
    s = withNodes(s, {
      step_in_a_small_bowl_stir_together: doneAt(T0 + m(5)),
      step_measure_3_1_3_cups_flour: doneAt(T0 + m(8)),
      step_knead_by_hand_2_minutes_dough: doneAt(T0 + m(10)),
      step_cover_the_bowl_with_plastic_wrap: doneAt(T0 + m(280), T0 + m(280)),
      step_transfer_dough_to_a_floured_surface: doneAt(T0 + m(290)),
      step_cover_and_refrigerate_overnight_18_hours: doneAt(T0 + m(1370), T0 + m(1370)),
      step_remove_the_dough_1_hour_before: doneAt(T0 + m(1430), T0 + m(1430)),
      // The most recently *done* node (by `at`) is in sitting 1 — if sittingIndex
      // fell back to "last done" here it would wrongly report 1.
      step_place_a_pizza_stone_or_inverted: doneAt(T0 + m(1440), T0 + m(1440)),
    })
    // step_lightly_flour_a_pizza_peel_and (sitting 2's first node) is left pending —
    // its only dependency is done, so it is `current`.
    expect(current(model, s)).toBe('step_lightly_flour_a_pizza_peel_and')
    expect(sittingIndex(model, s)).toBe(2)
  })
})

describe('audit gap: deferred-node return in current() (§F2 pending-then-deferred two-phase scan)', () => {
  it('kadai: chop_capsicum was skipped; once no pending node is executable, current falls back to it', () => {
    const model = deriveCookingModel(KADAI)
    let s = emptySession(model)
    s = withNodes(s, {
      chop_onion: doneAt(T0),
      saute_onion: doneAt(T0),
      chop_tomato: doneAt(T0),
      cook_tomato_base: doneAt(T0, T0),
      cube_paneer: doneAt(T0),
      make_kadai_masala: doneAt(T0),
      chop_capsicum: { state: 'deferred', at: T0 },
    })
    // add_veggies needs chop_capsicum done (not just deferred), so it stays blocked —
    // no pending node is executable, and the deferred-scan finds chop_capsicum.
    expect(current(model, s)).toBe('chop_capsicum')
  })
})

describe('audit gap: skipAllowed() when current is hands-off (§F9)', () => {
  it('biryani: a fresh session\'s current is boil_spiced_water (hands-off) — skip is never offered', () => {
    const model = deriveCookingModel(BIRYANI)
    const s = emptySession(model)
    expect(current(model, s)).toBe('boil_spiced_water')
    expect(model.nodes.boil_spiced_water.occupiesCook).toBe(false)
    expect(skipAllowed(model, s)).toBe(false)
  })
})

describe('foreignLifecycle — CP1a (M3.4.5 session-lockout plan)', () => {
  it('active: totalMin present, nothing finished, nothing stale', () => {
    const model = deriveCookingModel(KADAI)
    const s: CookingSession = { ...emptySession(model), totalMin: model.totalMin }
    expect(foreignLifecycle(s, T0)).toBe('active')
  })

  it('finished: finishedAt set takes precedence, and needs no totalMin', () => {
    const model = deriveCookingModel(KADAI)
    const s: CookingSession = { ...emptySession(model), finishedAt: T0 + m(30) }
    // Reopened absurdly later — still finished, never re-evaluated as stale.
    expect(foreignLifecycle(s, T0 + m(30) + m(100_000))).toBe('finished')
  })

  it('stale: a running node long expired and unseen past the totalMin-derived threshold', () => {
    const model = deriveCookingModel(KADAI)
    let s: CookingSession = { ...emptySession(model), totalMin: model.totalMin, lastSeenAt: T0 }
    s = withNodes(s, { cook_tomato_base: runningAt(T0, T0 + m(12)) })
    const muchLater = T0 + m(2 * model.totalMin * 60) + m(1)
    expect(foreignLifecycle(s, muchLater)).toBe('stale')
  })

  it('not yet stale: same running node, reopened well inside the threshold', () => {
    const model = deriveCookingModel(KADAI)
    let s: CookingSession = { ...emptySession(model), totalMin: model.totalMin, lastSeenAt: T0 }
    s = withNodes(s, { cook_tomato_base: runningAt(T0, T0 + m(12)) })
    expect(foreignLifecycle(s, T0 + m(20))).toBe('active')
  })

  it('unknown: legacy session with no totalMin snapshot, not finished — never guessed as active or stale', () => {
    const model = deriveCookingModel(KADAI)
    const s = emptySession(model) // no totalMin, matches a session persisted before CP1a
    expect(s.totalMin).toBeUndefined()
    expect(foreignLifecycle(s, T0 + m(100_000))).toBe('unknown')
  })
})

describe('audit gap: awayClass() when nextRequiredAt == null (§F7/§M2 resolution)', () => {
  it('falls into wait — the only bucket left once neither numeric threshold can be evaluated', () => {
    const model = deriveCookingModel(MAGGI)
    // Nothing running: `running()` is empty, so `nextRequiredAt` is trivially null.
    // (Reachability note, recorded in the audit response: constructing a *graph-valid*
    // state with something running that contributes nothing to `nextRequiredAt`, while
    // `current` is also null, was not achievable in any of the 8 fixtures — every
    // fixture's dependency shape makes at least one running node's later `endsAt`
    // converge with the others once its co-producers are already resolved. This test
    // exercises the function's own documented fallback directly instead.)
    const s = emptySession(model)
    expect(nextRequiredAt(model, s)).toBeNull()
    expect(awayClass(model, s, T0)).toBe('wait')
  })
})
