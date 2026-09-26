import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import * as engine from './engine'
import { deriveCookingModel } from './model'
import { current, executable, handover, lifecycle, nextRequiredAt, running, skipAllowed } from './select'
import type { CookingModel, CookingSession, Rejected } from './types'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

/**
 * CP2 engine tests — plan §H test matrix rows not already covered by CP1's
 * `select.test.ts` (rows 1-2, 7-13, 19-20, 29-33): rows 3-6, 14-18, 21-28, 34-37.
 * Every test drives the reducer through real `engine.*` calls (never hand-constructs a
 * `NodeState` map) — the point of CP2's tests is the reducer itself, not the selectors
 * CP1 already proved correct.
 */

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const DONUTS = homemadeDonuts as RecipePlanResponse
const PIZZA = pizzaDough as RecipePlanResponse
const MAGGI = maggi2min as RecipePlanResponse
// Referenced only by the full-run driver's fixture list (rows 36/37).
const SHORTCAKE = strawberryShortcake as RecipePlanResponse
const TWO_WINDOWS = syntheticTwoWindows as RecipePlanResponse
const TWO_SITTINGS = syntheticTwoSittings as RecipePlanResponse

const T0 = 1_700_000_000_000
const m = (min: number) => min * 60_000

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

function freshSession(model: CookingModel, planKey: string, now: number): CookingSession {
  return must(engine.start(null, model, planKey, now))
}

// ---------------------------------------------------------------------------
// Rows 3-6 — kadai: current progression, startNode, rejections, done gating (§F2/§C3/§K2)
// ---------------------------------------------------------------------------

describe('kadai — current progression and startNode (rows 3-4)', () => {
  it('row 3: current walks chop_onion -> saute_onion -> chop_tomato -> cook_tomato_base (awaiting start)', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    expect(current(model, s)).toBe('chop_onion')

    s = must(engine.markDone(s, model, 'chop_onion', T0))
    expect(current(model, s)).toBe('saute_onion')

    s = must(engine.markDone(s, model, 'saute_onion', T0))
    expect(current(model, s)).toBe('chop_tomato')

    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    expect(current(model, s)).toBe('cook_tomato_base')
    expect(model.nodes.cook_tomato_base.occupiesCook).toBe(false)
  })

  it('row 4: startNode(cook_tomato_base) at T0+10 sets endsAt to T0+22; current advances to chop_capsicum', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))

    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(s.nodes.cook_tomato_base).toEqual({ state: 'running', startedAt: T0 + m(10), endsAt: T0 + m(22), extendedMs: 0 })
    expect(current(model, s)).toBe('chop_capsicum')
  })
})

describe('kadai — startNode rejections (row 5)', () => {
  it('rejects a hands-on node it is not current, and a hands-on node it is (K2: only hands-off nodes ever start)', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(current(model, s)).toBe('chop_capsicum')

    const notCurrent = engine.startNode(s, model, 'add_veggies', T0 + m(10))
    expect(notCurrent).toEqual({ ok: false, reason: 'not_current' })

    const handsOn = engine.startNode(s, model, 'chop_capsicum', T0 + m(10))
    expect(handsOn).toEqual({ ok: false, reason: 'hands_on_node' })
  })
})

describe('kadai — done gating on a periodic host (row 6)', () => {
  it('add_veggies is rejected while cook_tomato_base has not been acknowledged, allowed once it is', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))

    expect(engine.markDone(s, model, 'add_veggies', T0 + m(10))).toEqual({ ok: false, reason: 'not_current' })

    s = must(engine.markDone(s, model, 'chop_capsicum', T0 + m(10)))
    s = must(engine.markDone(s, model, 'cube_paneer', T0 + m(12)))
    s = must(engine.markDone(s, model, 'make_kadai_masala', T0 + m(14)))
    // Base is periodic — required(§K3) the instant it expires, no consumer-readiness
    // test needed (matches CP1 row 10's kadai case exactly).
    expect(handover(model, s, T0 + m(22))).toEqual({
      producers: ['cook_tomato_base'],
      consumer: null,
      reason: 'must_attend',
      overrunMs: 0,
    })
    expect(engine.markDone(s, model, 'add_veggies', T0 + m(22))).toEqual({ ok: false, reason: 'not_current' })

    s = must(engine.acknowledge(s, model, T0 + m(22)))
    expect(s.nodes.cook_tomato_base.state).toBe('done')
    expect(current(model, s)).toBe('add_veggies')
    s = must(engine.markDone(s, model, 'add_veggies', T0 + m(25)))
    expect(s.nodes.add_veggies.state).toBe('done')
  })
})

// ---------------------------------------------------------------------------
// Row 14 — wall-clock read: no state change between evaluations (§C4)
// ---------------------------------------------------------------------------

describe('biryani — wall-clock timer reads (row 14)', () => {
  it('remainingMs/overrunMs move with `now`; no engine call changes the stored endsAt', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = freshSession(model, 'server:biryani', T0)
    s = must(engine.startNode(s, model, 'boil_spiced_water', T0))
    s = must(engine.startNode(s, model, 'soak_rice', T0))
    s = must(engine.markDone(s, model, 'slice_onions', T0))
    s = must(engine.startNode(s, model, 'fry_birista', T0 + m(4)))

    const fryBirista = s.nodes.fry_birista
    if (fryBirista.state !== 'running') throw new Error('expected fry_birista running')
    expect(fryBirista.endsAt).toBe(T0 + m(14))

    // Three reads at different `now`, no action dispatched between them.
    expect(fryBirista.endsAt - (T0 + m(9))).toBe(m(5)) // remainingMs at t=9
    expect(fryBirista.endsAt - (T0 + m(14))).toBe(0) // remainingMs at t=14 (exactly expired)
    expect(Math.max(0, T0 + m(22) - fryBirista.endsAt)).toBe(m(8)) // overrunMs at t=22
    expect(s.nodes.fry_birista).toBe(fryBirista) // same object — nothing mutated it
  })
})

// ---------------------------------------------------------------------------
// Row 16/17 — extend (§C4/§K5 "Give it longer")
// ---------------------------------------------------------------------------

describe('extend (rows 16-17)', () => {
  it('row 16: kadai base at T0+22 (exactly expired) — extend adds one minute; extend twice accumulates', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(handover(model, s, T0 + m(22))?.reason).toBe('must_attend')

    s = must(engine.extend(s, model, 'cook_tomato_base', T0 + m(22)))
    expect(s.nodes.cook_tomato_base).toEqual({ state: 'running', startedAt: T0 + m(10), endsAt: T0 + m(23), extendedMs: m(1) })
    expect(handover(model, s, T0 + m(22))).toBeNull() // cleared until the new endsAt

    s = must(engine.extend(s, model, 'cook_tomato_base', T0 + m(22.5)))
    expect(s.nodes.cook_tomato_base).toMatchObject({ endsAt: T0 + m(24), extendedMs: m(2) })
  })

  it('row 17: donuts first_rise at T0+30 (unexpired) — extend is allowed pre-expiry', () => {
    const model = deriveCookingModel(DONUTS)
    let s = freshSession(model, 'server:donuts', T0)
    s = must(engine.markDone(s, model, 'bloom_yeast', T0))
    s = must(engine.markDone(s, model, 'mix_dough', T0 + m(4)))
    s = must(engine.markDone(s, model, 'knead_dough', T0 + m(10)))
    s = must(engine.startNode(s, model, 'first_rise', T0 + m(18)))
    expect(s.nodes.first_rise).toMatchObject({ endsAt: T0 + m(78) })

    s = must(engine.extend(s, model, 'first_rise', T0 + m(30)))
    expect(s.nodes.first_rise).toMatchObject({ endsAt: T0 + m(79), extendedMs: m(1) })
  })

  it('extend rejects a node that is not running', () => {
    const model = deriveCookingModel(KADAI)
    const s = freshSession(model, 'server:kadai', T0)
    expect(engine.extend(s, model, 'cook_tomato_base', T0)).toEqual({ ok: false, reason: 'not_running' })
  })
})

// ---------------------------------------------------------------------------
// Row 18 — judgement done, hands-off, while running and unexpired (§C4)
// ---------------------------------------------------------------------------

describe('maggi — judgement done (row 18)', () => {
  it('boil_water can be marked done at T0+2 while running and unexpired; current advances', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    expect(s.nodes.boil_water).toMatchObject({ state: 'running', endsAt: T0 + m(3) })

    s = must(engine.markDone(s, model, 'boil_water', T0 + m(2)))
    expect(s.nodes.boil_water).toEqual({ state: 'done', at: T0 + m(2), endsAt: T0 + m(3) })
    expect(current(model, s)).toBe('add_noodles_masala')
  })
})

// ---------------------------------------------------------------------------
// Rows 21-24 — skip / deferred (§B12/§F9/§C8)
// ---------------------------------------------------------------------------

describe('skip (rows 21-24)', () => {
  it('row 21: kadai — skip chop_capsicum while cube_paneer is a non-deferred alternative; it never satisfies add_veggies until done', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(current(model, s)).toBe('chop_capsicum')

    s = must(engine.skip(s, model, 'chop_capsicum', T0 + m(10)))
    expect(s.nodes.chop_capsicum).toEqual({ state: 'deferred', at: T0 + m(10) })
    expect(current(model, s)).toBe('cube_paneer')
    expect(executable(model, s, 'add_veggies')).toBe(false)
  })

  it('row 22: maggi — add_noodles_masala is the only executable node; skip is refused', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    s = must(engine.markDone(s, model, 'boil_water', T0 + m(3)))
    expect(current(model, s)).toBe('add_noodles_masala')
    expect(skipAllowed(model, s)).toBe(false)

    expect(engine.skip(s, model, 'add_noodles_masala', T0 + m(3))).toEqual({ ok: false, reason: 'no_alternative' })
  })

  it('row 23: a hands-off current node cannot be skipped; a non-current hands-on node cannot be skipped', () => {
    const maggiModel = deriveCookingModel(MAGGI)
    const maggiSession = freshSession(maggiModel, 'server:maggi', T0)
    expect(current(maggiModel, maggiSession)).toBe('boil_water')
    expect(engine.skip(maggiSession, maggiModel, 'boil_water', T0)).toEqual({ ok: false, reason: 'hands_off_node' })

    const kadaiModel = deriveCookingModel(KADAI)
    const kadaiSession = freshSession(kadaiModel, 'server:kadai', T0)
    expect(current(kadaiModel, kadaiSession)).toBe('chop_onion')
    expect(engine.skip(kadaiSession, kadaiModel, 'chop_tomato', T0)).toEqual({ ok: false, reason: 'not_current' })
  })

  // Row 24 (adapted — see note): the plan's original §H text ("skip make_kadai_masala;
  // do cube_paneer; base expires -> quiet") predates the §K3/§B5 must_attend resolution
  // that CP1 already implements and tests (row 9/10: a periodic host is required the
  // instant it expires, regardless of whether its consumer is blocked — never "quiet").
  // It is also not reachable by real sequential actions on this fixture: cube_paneer
  // (start_min 15) precedes make_kadai_masala (start_min 17) in execution order, so
  // make_kadai_masala cannot be `current` — and therefore cannot be `skip`ped — while
  // cube_paneer is still pending (cube_paneer would be `current` first). This test
  // keeps row 24's actual point — a deferred node returns as `current` once nothing
  // else is pending-executable, and later completing it unblocks its consumer — using
  // chop_capsicum (order position 5, genuinely skippable with cube_paneer/masala as
  // real alternatives) instead, and asserts the handover reason the K3 rule actually
  // produces rather than the superseded "quiet" framing.
  it('row 24 (adapted): a deferred node returns as current, and later unblocks its consumer', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(current(model, s)).toBe('chop_capsicum')

    s = must(engine.skip(s, model, 'chop_capsicum', T0 + m(10)))
    s = must(engine.markDone(s, model, 'cube_paneer', T0 + m(12)))
    s = must(engine.markDone(s, model, 'make_kadai_masala', T0 + m(14)))
    // No pending node is executable (add_veggies needs chop_capsicum done, not
    // deferred) — the two-phase scan falls back to the deferred node.
    expect(current(model, s)).toBe('chop_capsicum')

    // Base expires: periodic -> must_attend regardless of chop_capsicum's deferred
    // state (K3), not "quiet".
    expect(handover(model, s, T0 + m(22))).toEqual({
      producers: ['cook_tomato_base'],
      consumer: null,
      reason: 'must_attend',
      overrunMs: 0,
    })
    s = must(engine.acknowledge(s, model, T0 + m(22)))
    expect(current(model, s)).toBe('chop_capsicum') // still deferred, still the only thing to do

    s = must(engine.markDone(s, model, 'chop_capsicum', T0 + m(23)))
    expect(s.nodes.chop_capsicum).toEqual({ state: 'done', at: T0 + m(23), endsAt: null })
    expect(current(model, s)).toBe('add_veggies') // now unblocked
  })
})

// ---------------------------------------------------------------------------
// Row 25 — undo (§C8/§L1)
// ---------------------------------------------------------------------------

describe('undo (row 25)', () => {
  it('undoes a done, restoring pending and current; a second undo (or one after startNode) rejects', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.markDone(s, model, 'chop_onion', T0))
    expect(current(model, s)).toBe('saute_onion')

    s = must(engine.undo(s, model, T0 + m(1)))
    expect(s.nodes.chop_onion).toEqual({ state: 'pending' })
    expect(current(model, s)).toBe('chop_onion')
    expect(s.lastTransition).toBeNull()

    expect(engine.undo(s, model, T0 + m(1))).toEqual({ ok: false, reason: 'nothing_to_undo' })

    s = must(engine.markDone(s, model, 'chop_onion', T0))
    expect(s.lastTransition).toEqual({ kind: 'done', at: T0, entries: [{ nodeId: 'chop_onion', prev: { state: 'pending' } }] })

    // "no startNode has happened since" — demonstrated with the next real hands-off
    // node: startNode clears lastTransition even though the transition it clears was
    // for a different, already-done node.
    s = must(engine.markDone(s, model, 'saute_onion', T0))
    s = must(engine.markDone(s, model, 'chop_tomato', T0))
    s = must(engine.startNode(s, model, 'cook_tomato_base', T0 + m(10)))
    expect(s.lastTransition).toBeNull()
    expect(engine.undo(s, model, T0 + m(10))).toEqual({ ok: false, reason: 'nothing_to_undo' })
  })

  it('undoing the sink clears finishedAt', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    s = must(engine.markDone(s, model, 'boil_water', T0 + m(3)))
    s = must(engine.markDone(s, model, 'add_noodles_masala', T0 + m(4)))
    s = must(engine.startNode(s, model, 'cook_noodles', T0 + m(4)))
    s = must(engine.acknowledge(s, model, T0 + m(6)))
    s = must(engine.markDone(s, model, 'serve', T0 + m(7)))
    expect(s.finishedAt).toBe(T0 + m(7))
    expect(lifecycle(model, s, T0 + m(7))).toBe('finished')

    s = must(engine.undo(s, model, T0 + m(7)))
    expect(s.finishedAt).toBeNull()
    expect(s.nodes.serve.state).toBe('pending')
    expect(lifecycle(model, s, T0 + m(7))).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// Row 26 — leave / resume (§C6)
// ---------------------------------------------------------------------------

describe('leave / resume (row 26)', () => {
  it('biryani: leave at T0+10.4 does not touch timers; resume at T0+12.1 clears leftAt', () => {
    const model = deriveCookingModel(BIRYANI)
    let s = freshSession(model, 'server:biryani', T0)
    s = must(engine.startNode(s, model, 'boil_spiced_water', T0))
    s = must(engine.startNode(s, model, 'soak_rice', T0))
    s = must(engine.markDone(s, model, 'slice_onions', T0))
    s = must(engine.startNode(s, model, 'fry_birista', T0 + m(4)))
    s = must(engine.markDone(s, model, 'chop_mint_coriander', T0 + m(4)))
    s = must(engine.markDone(s, model, 'mix_marinade', T0 + m(7)))
    s = must(engine.startNode(s, model, 'marinate_chicken', T0 + m(10)))

    const fryBefore = s.nodes.fry_birista
    const marinateBefore = s.nodes.marinate_chicken

    s = must(engine.leave(s, model, T0 + m(10.4)))
    expect(s.leftAt).toBe(T0 + m(10.4))
    expect(s.lastSeenAt).toBe(T0 + m(10.4))
    // Timers untouched by leave (§C6).
    expect(s.nodes.fry_birista).toEqual(fryBefore)
    expect(s.nodes.marinate_chicken).toEqual(marinateBefore)
    // "returning" is not a Role member — it overlays, read directly off leftAt (§M1).
    expect(s.leftAt != null).toBe(true)

    // Quiet at T0+12.1: fry_birista (14) and marinate_chicken (25) unexpired; the
    // parboil_rice consumer is still blocked on soak_rice (running to 20, unexpired).
    expect(handover(model, s, T0 + m(12.1))).toBeNull()

    s = must(engine.resume(s, model, T0 + m(12.1)))
    expect(s.leftAt).toBeNull()
    expect(s.lastSeenAt).toBe(T0 + m(12.1))
  })

  it('resume rejects without a prior leave', () => {
    const model = deriveCookingModel(MAGGI)
    const s = freshSession(model, 'server:maggi', T0)
    expect(engine.resume(s, model, T0)).toEqual({ ok: false, reason: 'not_left' })
  })

  // "session live" (§E's leave precondition, otherwise undefined by the plan) is
  // defined by the 2026-09-22 audit clarification as `lifecycle() === 'active'` — so
  // leave must reject from both lifecycle values that aren't 'active': 'finished' and
  // 'stale'. Both boundaries are exercised explicitly below.
  it('leave rejects once the session is finished (§E "session live" = lifecycle() === \'active\', audit clarification)', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    s = must(engine.markDone(s, model, 'boil_water', T0 + m(3)))
    s = must(engine.markDone(s, model, 'add_noodles_masala', T0 + m(4)))
    s = must(engine.startNode(s, model, 'cook_noodles', T0 + m(4)))
    s = must(engine.acknowledge(s, model, T0 + m(6)))
    s = must(engine.markDone(s, model, 'serve', T0 + m(7)))
    expect(lifecycle(model, s, T0 + m(7))).toBe('finished')

    expect(engine.leave(s, model, T0 + m(7))).toEqual({ ok: false, reason: 'session_finished' })
  })

  it('leave rejects once the session is stale (same "session live" = active boundary, the other non-active lifecycle value)', () => {
    const model = deriveCookingModel(KADAI)
    const s = freshSession(model, 'server:kadai', T0)
    const staleNow = T0 + m(8 * 60) // 8h with nothing running — stale under the 6h floor
    expect(lifecycle(model, s, staleNow)).toBe('stale')

    expect(engine.leave(s, model, staleNow)).toEqual({ ok: false, reason: 'session_stale' })
  })

  it('resume works from a stale reopen (it is the engine action behind "Continue" — must not be blocked by staleness)', () => {
    const model = deriveCookingModel(KADAI)
    let s = freshSession(model, 'server:kadai', T0)
    s = must(engine.leave(s, model, T0 + m(1)))
    const reopenNow = T0 + m(1) + m(8 * 60) // 8h later — stale under the 6h floor
    expect(lifecycle(model, s, reopenNow)).toBe('stale')

    s = must(engine.resume(s, model, reopenNow))
    expect(s.leftAt).toBeNull()
    expect(s.lastSeenAt).toBe(reopenNow)
    // The refreshed lastSeenAt self-heals staleness for the next evaluation.
    expect(lifecycle(model, s, reopenNow)).toBe('active')
  })

  // 2026-09-22 audit clarification: §E's literal `resume` precondition is exactly
  // `leftAt != null` — nothing more. An earlier revision additionally rejected a
  // `finished` lifecycle; that was never authorized by §E/§K5/§L/§M and has been
  // removed. This test covers the literal precondition directly (resume succeeds
  // purely because `leftAt != null`, regardless of lifecycle) and confirms the
  // rationale that makes this safe: `lifecycle()` checks `finishedAt` first,
  // unconditionally (§M1), so clearing `leftAt` cannot resurrect a finished session —
  // `lifecycle()` still reports 'finished' immediately afterward.
  it('resume succeeds from a finished session (§E\'s only precondition is leftAt != null); lifecycle still reports finished afterward', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    s = must(engine.markDone(s, model, 'boil_water', T0 + m(3)))
    s = must(engine.markDone(s, model, 'add_noodles_masala', T0 + m(4)))
    s = must(engine.startNode(s, model, 'cook_noodles', T0 + m(4)))
    s = must(engine.acknowledge(s, model, T0 + m(6)))
    s = must(engine.markDone(s, model, 'serve', T0 + m(7)))
    expect(s.finishedAt).toBe(T0 + m(7))

    // leave() itself is gated (tested above) and would reject here — construct the
    // `leftAt != null` precondition directly, as e.g. a finish that raced an in-flight
    // leave could, rather than going through the gated action.
    const leftWhileFinished: CookingSession = { ...s, leftAt: T0 + m(7) }

    const resumed = must(engine.resume(leftWhileFinished, model, T0 + m(7) + m(5)))
    expect(resumed.leftAt).toBeNull()
    expect(resumed.lastSeenAt).toBe(T0 + m(7) + m(5))
    expect(resumed.finishedAt).toBe(T0 + m(7)) // untouched
    expect(lifecycle(model, resumed, T0 + m(7) + m(5))).toBe('finished') // still dominates
  })
})

// ---------------------------------------------------------------------------
// Rows 27-28 — stale / not-stale, through engine.open (§F8/§M1)
// ---------------------------------------------------------------------------

describe('open — stale/active lifecycle reporting (rows 27-28)', () => {
  it('row 27: kadai — nothing running, last seen 8h ago is stale (6h floor); 5h ago is not', () => {
    const model = deriveCookingModel(KADAI)
    const s = freshSession(model, 'server:kadai', T0 + m(20))

    const staleRead = engine.open(s, model, s.planKey, T0 + m(20) + m(8 * 60))
    expect(staleRead).toEqual({ status: 'ok', session: s, lifecycle: 'stale' })

    const activeRead = engine.open(s, model, s.planKey, T0 + m(20) + m(5 * 60))
    expect(activeRead).toEqual({ status: 'ok', session: s, lifecycle: 'active' })
  })

  it('row 28: pizza — refrigerate running to 1370, reopened 12h later is not stale (49h threshold)', () => {
    const model = deriveCookingModel(PIZZA)
    let s = freshSession(model, 'server:pizza', T0)
    // step_in_a_small_bowl_stir_together is hands-off (unattended) — start then
    // judgement-complete it, unlike the hands-on steps that follow.
    s = must(engine.startNode(s, model, 'step_in_a_small_bowl_stir_together', T0))
    s = must(engine.markDone(s, model, 'step_in_a_small_bowl_stir_together', T0 + m(5)))
    s = must(engine.markDone(s, model, 'step_measure_3_1_3_cups_flour', T0 + m(8)))
    s = must(engine.markDone(s, model, 'step_knead_by_hand_2_minutes_dough', T0 + m(10)))
    s = must(engine.startNode(s, model, 'step_cover_the_bowl_with_plastic_wrap', T0 + m(10)))
    expect(s.nodes.step_cover_the_bowl_with_plastic_wrap).toMatchObject({ endsAt: T0 + m(280) })

    s = must(engine.acknowledge(s, model, T0 + m(280)))
    s = must(engine.markDone(s, model, 'step_transfer_dough_to_a_floured_surface', T0 + m(290)))
    s = must(engine.startNode(s, model, 'step_cover_and_refrigerate_overnight_18_hours', T0 + m(290)))
    expect(s.nodes.step_cover_and_refrigerate_overnight_18_hours).toMatchObject({ endsAt: T0 + m(1370) })

    const reopenNow = T0 + m(1370) + m(12 * 60)
    const read = engine.open(s, model, s.planKey, reopenNow)
    expect(read).toEqual({ status: 'ok', session: s, lifecycle: 'active' })

    const h = handover(model, s, reopenNow)
    expect(h).toEqual({
      producers: ['step_cover_and_refrigerate_overnight_18_hours'],
      consumer: 'step_remove_the_dough_1_hour_before',
      reason: 'consumer_ready',
      overrunMs: m(12 * 60),
    })
  })

  it('a finished session is reported finished, never stale, regardless of how long ago', () => {
    const model = deriveCookingModel(MAGGI)
    let s = freshSession(model, 'server:maggi', T0)
    s = must(engine.startNode(s, model, 'boil_water', T0))
    s = must(engine.markDone(s, model, 'boil_water', T0 + m(3)))
    s = must(engine.markDone(s, model, 'add_noodles_masala', T0 + m(4)))
    s = must(engine.startNode(s, model, 'cook_noodles', T0 + m(4)))
    s = must(engine.acknowledge(s, model, T0 + m(6)))
    s = must(engine.markDone(s, model, 'serve', T0 + m(7)))

    const read = engine.open(s, model, s.planKey, T0 + m(7) + m(100 * 60))
    expect(read).toEqual({ status: 'ok', session: s, lifecycle: 'finished' })
  })
})

// ---------------------------------------------------------------------------
// Row 34 — conflict (§B15)
// ---------------------------------------------------------------------------

describe('open — conflict / none (row 34)', () => {
  it('a stored kadai session conflicts with an attempted biryani open; ending it clears the way', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const kadaiSession = freshSession(kadaiModel, 'library:kadai', T0)

    expect(engine.open(kadaiSession, biryaniModel, 'library:biryani', T0)).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: null, state: 'active' },
    })
    expect(engine.open(null, biryaniModel, 'library:biryani', T0)).toEqual({ status: 'none' })

    // start() itself refuses to create a second session while one is stored.
    expect(engine.start(kadaiSession, biryaniModel, 'library:biryani', T0)).toEqual({ ok: false, reason: 'session_exists' })
    expect(engine.end()).toBeNull()
    const afterEnd = must(engine.start(engine.end(), biryaniModel, 'library:biryani', T0))
    expect(afterEnd.planKey).toBe('library:biryani')
  })
})

// ---------------------------------------------------------------------------
// CP1a (M3.4.5 session-lockout plan) — recipeTitle/totalMin snapshot, conflict
// title/state, foreign lifecycle classification.
// ---------------------------------------------------------------------------

describe('start — recipeTitle/totalMin snapshot (CP1a)', () => {
  it('persists the recipeTitle passed to start()', () => {
    const model = deriveCookingModel(KADAI)
    const s = must(engine.start(null, model, 'server:kadai', T0, 'Kadai Paneer'))
    expect(s.recipeTitle).toBe('Kadai Paneer')
  })

  it('persists totalMin from the model, independent of whether recipeTitle was passed', () => {
    const model = deriveCookingModel(KADAI)
    const s = must(engine.start(null, model, 'server:kadai', T0))
    expect(s.recipeTitle).toBeUndefined()
    expect(s.totalMin).toBe(model.totalMin)
  })
})

describe('open — conflict reports the other plan\'s title/state (CP1a)', () => {
  it('an active foreign session reports its title and state active', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const kadaiSession = must(engine.start(null, kadaiModel, 'library:kadai', T0, 'Kadai Paneer'))

    const result = engine.open(kadaiSession, biryaniModel, 'library:biryani', T0)
    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: 'Kadai Paneer', state: 'active' },
    })
  })

  it('a finished foreign session reports state finished, regardless of staleness', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const finished: CookingSession = {
      ...must(engine.start(null, kadaiModel, 'library:kadai', T0, 'Kadai Paneer')),
      finishedAt: T0 + m(30),
    }

    const result = engine.open(finished, biryaniModel, 'library:biryani', T0 + m(30) + m(1000 * 60))
    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: 'Kadai Paneer', state: 'finished' },
    })
  })

  it('a foreign session with every timer long expired and unseen reports state stale', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    let s = must(engine.start(null, kadaiModel, 'library:kadai', T0, 'Kadai Paneer'))
    s = must(engine.markDone(s, kadaiModel, 'chop_onion', T0))
    s = must(engine.markDone(s, kadaiModel, 'saute_onion', T0))
    s = must(engine.markDone(s, kadaiModel, 'chop_tomato', T0))
    s = must(engine.startNode(s, kadaiModel, 'cook_tomato_base', T0))

    const muchLater = T0 + m(2 * kadaiModel.totalMin * 60) + m(1)
    const result = engine.open(s, biryaniModel, 'library:biryani', muchLater)
    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: 'Kadai Paneer', state: 'stale' },
    })
  })

  it('a legacy foreign session with no totalMin snapshot reports state unknown, never active or stale', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const legacy: CookingSession = must(engine.start(null, kadaiModel, 'library:kadai', T0, 'Kadai Paneer'))
    delete (legacy as { totalMin?: number }).totalMin

    const result = engine.open(legacy, biryaniModel, 'library:biryani', T0 + m(1000 * 60))
    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: 'Kadai Paneer', state: 'unknown' },
    })
  })

  it('a legacy foreign session with no recipeTitle snapshot reports title null, not a placeholder', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const legacy = freshSession(kadaiModel, 'library:kadai', T0) // no recipeTitle, matches pre-CP1a start()

    const result = engine.open(legacy, biryaniModel, 'library:biryani', T0)
    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: null, state: 'active' },
    })
  })
})

// ---------------------------------------------------------------------------
// Rows 36-37 — determinism and invariants, full run over every fixture (§C1-C9)
// ---------------------------------------------------------------------------

const ALL_FIXTURES: [string, RecipePlanResponse][] = [
  ['kadai-paneer', KADAI],
  ['chicken-biryani', BIRYANI],
  ['homemade-donuts', DONUTS],
  ['pizza-dough', PIZZA],
  ['maggi-2min', MAGGI],
  ['strawberry-shortcake', SHORTCAKE],
  ['synthetic-two-windows', TWO_WINDOWS],
  ['synthetic-two-sittings', TWO_SITTINGS],
]

/**
 * Drives a fixture to completion with a single deterministic strategy — act on the
 * earliest opportunity every time: acknowledge any pending handover; otherwise act on
 * `current` (markDone if hands-on, startNode if hands-off, immediately); otherwise jump
 * `now` to `nextRequiredAt`. This never re-derives a duration or dependency (it only
 * ever calls engine actions with a `now` it read from `nextRequiredAt`/`endsAt`), so it
 * does not invent cooking behavior — it is a fixed, reproducible walk of the same graph
 * every real session would eventually traverse, useful only for exercising terminal
 * invariants across all eight fixtures.
 */
function runToCompletion(payload: RecipePlanResponse, startAt: number): CookingSession {
  const model = deriveCookingModel(payload)
  let session = freshSession(model, `test:${model.graphId}`, startAt)
  let now = startAt

  for (let iterations = 0; session.finishedAt == null; iterations++) {
    if (iterations > 1000) {
      throw new Error(
        `${model.graphId}: did not terminate in 1000 steps — possible §M3 unreachable state ` +
          '(something running while current is null and nextRequiredAt is null)',
      )
    }

    const h = handover(model, session, now)
    if (h != null) {
      session = must(engine.acknowledge(session, model, now))
      continue
    }

    const cur = current(model, session)
    if (cur != null) {
      const info = model.nodes[cur]
      session = must(info.occupiesCook ? engine.markDone(session, model, cur, now) : engine.startNode(session, model, cur, now))
      continue
    }

    const next = nextRequiredAt(model, session)
    if (next == null) {
      const stillRunning = running(model, session)
      throw new Error(
        `${model.graphId}: current is null, no handover, nextRequiredAt is null, but running=[${stillRunning.join(', ')}] ` +
          '— this is the §M3 reachability finding the CP2 brief asked to be reported rather than worked around.',
      )
    }
    now = next
  }

  return session
}

describe('full-run determinism and invariants (rows 36-37)', () => {
  it.each(ALL_FIXTURES)('%s: two independent runs from the same start produce byte-identical sessions', (_name, payload) => {
    const a = runToCompletion(payload, T0)
    const b = runToCompletion(payload, T0)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it.each(ALL_FIXTURES)('%s: every node ends done; finishedAt set exactly once, on the sink', (_name, payload) => {
    const model = deriveCookingModel(payload)
    const s = runToCompletion(payload, T0)

    for (const id of model.order) expect(s.nodes[id].state).toBe('done')
    expect(s.finishedAt).not.toBeNull()
    const sinkState = s.nodes[model.sinkId]
    expect(sinkState.state).toBe('done')
    expect(sinkState.state === 'done' && sinkState.at).toBe(s.finishedAt)
  })

  it.each(ALL_FIXTURES)('%s: no hands-on node ever carries a timer (endsAt is always null on its done state)', (_name, payload) => {
    const model = deriveCookingModel(payload)
    const s = runToCompletion(payload, T0)

    for (const id of model.order) {
      if (!model.nodes[id].occupiesCook) continue
      const state = s.nodes[id]
      expect(state.state).toBe('done')
      expect(state.state === 'done' && state.endsAt).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// Row 36 — no action reads Date.now() (grep test; the real audit is the Bash grep in
// the CP2 report, this is the same check pinned as a test so it fails loudly in CI)
// ---------------------------------------------------------------------------

describe('Date.now() audit (row 36)', () => {
  it('engine.ts, model.ts and select.ts never call Date.now() from actual code (comment mentions of the rule are fine)', () => {
    for (const file of ['engine.ts', 'model.ts', 'select.ts']) {
      const path = fileURLToPath(new URL(`./${file}`, import.meta.url))
      const source = readFileSync(path, 'utf-8')
      const codeLines = source.split('\n').filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('*') && !trimmed.startsWith('//')
      })
      expect(codeLines.some((line) => line.includes('Date.now'))).toBe(false)
    }
  })
})
