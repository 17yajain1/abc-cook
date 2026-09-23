import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { buildCookingView, buildEntryView, buildSheetView } from './viewModel'
import { ingredientsById } from './quantity'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'
import { createSessionStore, type StorageLike } from '@/cooking/store'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingModel, CookingSession, Rejected } from '@/cooking/types'
import { headerTiming } from '@/lib/duration'

/**
 * Cooking Mode screen/copy-layer coverage, driven exclusively through real
 * `engine.ts` actions and read through the real `@/cooking/select` functions (via
 * `viewModel.ts`) — every `now` here is an explicit literal passed to the engine/view
 * builders, never a real timer, `setTimeout`, or `Date.now()`. This exercises
 * `resolveScreen`'s composition (lifecycle -> leaving -> leftAt -> role) and the copy
 * each screen derives from it, not the selectors themselves — those are proved by
 * `select.test.ts` / `engine.test.ts` already.
 *
 * Scenario names below are keyed to the M3.4 design handoff's own prototype frame
 * names (`Cooking Mode - M3.4 UI.dc.html`'s `SC` array) so this file's coverage can be
 * checked frame-by-frame against that list.
 */

const MIN = 60_000

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

// ---------------------------------------------------------------------------
// kadai-paneer — entry, task, handsoff_pending, task_window, wait, handover_late,
// sheet (single row), done, stale
// ---------------------------------------------------------------------------

describe('kadai-paneer', () => {
  const KADAI = kadaiPaneer as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(KADAI)
  const ingredients = ingredientsById(KADAI.graph.ingredients)
  const timing = headerTiming(KADAI.summary ?? null, KADAI.plan.total_min)

  function view(session: CookingSession, now: number, leaving = false) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: KADAI.graph.title, leaving })
  }

  it('entry: quotes the header timing range and the node count', () => {
    const v = buildEntryView(model, KADAI.graph.title, timing)
    expect(v.screenId).toBe('entry')
    expect(v.title).toBe('Kadai Paneer')
    expect(v.instr).toContain(timing.primary)
    expect(v.note).toBe(`${model.order.length} things to do.`)
    expect(v.primary).toEqual({ label: 'Start cooking', solid: true, action: { kind: 'start' } })
  })

  it('task: shows the hands-on task screen for the first node', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const v = view(se, T0)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Chop onion')
    expect(v.qty).toBe('2 medium onion')
    expect(v.primary).toEqual({ label: 'Done', solid: true, action: { kind: 'markDone', nodeId: 'chop_onion' } })
  })

  it('handsoff_pending: shows the hands-off-pending screen once every hands-on prerequisite is done', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))

    const v = view(se, T0 + 10 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(v.label).toBe('Cook tomato base')
    expect(v.primary).toEqual({
      label: 'Started',
      solid: false,
      action: { kind: 'startNode', nodeId: 'cook_tomato_base' },
    })
  })

  it('task_window: shows a task inside the wait window with a whisper naming the host', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))

    const v = view(se, T0 + 10 * MIN + 1000)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Cube capsicum')
    expect(v.showLink).toBe(true)
    expect(v.whisperText).toContain('Cook tomato base')
  })

  it('wait: shows the cue as title/instr with a primary once the running host is the wait subject', () => {
    // Renamed from a prior test that claimed "no primary" without asserting it — the
    // audit found `cook_tomato_base` carries a doneness cue, so this frame *does* have
    // a primary ("It's done"). The no-primary case is `wait_two_pans`, covered
    // separately below on the `bowl` fixture, where `waitSubject` genuinely is null.
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'chop_capsicum', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'cube_paneer', T0 + 14 * MIN))
    se = must(engine.markDone(se, model, 'make_kadai_masala', T0 + 16 * MIN))

    // cook_tomato_base started at +10, duration 12 -> ends at +22. At +16 it is running
    // and its only consumer (add_veggies) is now unblocked by everything else, so it IS
    // the wait subject — this is the design's `K_WAIT` scenario.
    const v = view(se, T0 + 16 * MIN)
    expect(v.screenId).toBe('wait')
    expect(v.title.toLowerCase()).toContain('oil pooling')
    expect(v.primary).toEqual({ label: "It's done", solid: false, action: { kind: 'markDone', nodeId: 'cook_tomato_base' } })
    expect(v.secondary).toEqual({
      label: 'Give it longer',
      solid: false,
      action: { kind: 'extend', nodeId: 'cook_tomato_base' },
    })
  })

  it('handover_late: shows the elapsed/overrun wording once the host node has expired', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'chop_capsicum', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'cube_paneer', T0 + 14 * MIN))
    se = must(engine.markDone(se, model, 'make_kadai_masala', T0 + 16 * MIN))

    const v = view(se, T0 + 23 * MIN) // ends at +22, so this is 1 min past
    expect(v.screenId).toBe('handover')
    expect(v.shell).toBe('dark')
    // must_attend (periodic) + overrun >= 60s -> the elapsed-fact wording, not the
    // plain "is done"/"wants a look" copy (that's handover_ready's distinguishing case).
    expect(v.title).toBe('One minute past.')
    expect(v.primary).toEqual({ label: "It's done", solid: false, action: { kind: 'acknowledge' } })
    expect(v.secondary).toEqual({
      label: 'Needs a minute more',
      solid: false,
      action: { kind: 'extend', nodeId: 'cook_tomato_base' },
    })
  })

  it('sheet: lists the single running host', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))

    const sheet = buildSheetView(model, se, T0 + 12 * MIN)
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0].label).toBe('Cook tomato base')
  })

  it('done: reports completion only — no total, no saved figure, no ongoing chrome', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'saute_onion', 'chop_tomato'] as const) {
      se = must(engine.markDone(se, model, id, T0 + 10 * MIN))
    }
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) {
      se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    }
    se = must(engine.acknowledge(se, model, T0 + 22 * MIN))
    se = must(engine.markDone(se, model, 'add_veggies', T0 + 27 * MIN))
    se = must(engine.markDone(se, model, 'add_paneer', T0 + 32 * MIN))
    se = must(engine.markDone(se, model, 'finish', T0 + 34 * MIN))

    const v = view(se, T0 + 34 * MIN)
    expect(v.screenId).toBe('done')
    expect(v.title).toBe('Kadai Paneer is done.')
    expect(v.instr).toBe(model.nodes.finish.instruction)
    expect(v.note).toBeNull()
    expect(v.qty).toBeNull()
    expect(v.topRecipe).toBe('')
    expect(v.showTopRight).toBe(false)
    expect(v.primary).toEqual({ label: 'Finished cooking', solid: true, action: { kind: 'end' } })
    expect(v.secondary).toBeNull()
  })

  it('stale: offers Continue / Start again with the elapsed-since-start copy', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const v = view(se, T0 + 361 * MIN) // staleThresholdMs(34) = 6h floor
    expect(v.screenId).toBe('stale')
    expect(v.title).toBe('You started this six hours ago.')
    expect(v.instr).toBe('Every timer here is long past.')
    expect(v.primary).toEqual({ label: 'Continue', solid: true, action: { kind: 'touch' } })
    expect(v.secondary).toEqual({ label: 'Start again', solid: false, action: { kind: 'end' } })
  })

  it('returning: no handover pending — "everything kept its own time", not the ready-and-waiting copy', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.leave(se, model, T0 + 5 * MIN))

    const v = view(se, T0 + 9 * MIN) // 4 min later, nothing running, nothing to hand over
    expect(v.screenId).toBe('returning')
    expect(v.title).toBe('You left about four minutes ago.')
    expect(v.instr).toBe('Everything kept its own time.')
    expect(v.primary).toEqual({ label: 'Back to cooking', solid: true, action: { kind: 'resume' } })
  })
})

// ---------------------------------------------------------------------------
// maggi-2min — wait_floor (no whisper, no link — the design's floor case),
// sheet_short (m:ss), return_expired
// ---------------------------------------------------------------------------

describe('maggi-2min', () => {
  const MAGGI = maggi2min as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(MAGGI)
  const ingredients = ingredientsById(MAGGI.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: MAGGI.graph.title, leaving: false })
  }

  it('wait_floor: nothing else is running, so whisper and link are both absent — four elements is the floor', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))

    const v = view(se, T0 + MIN) // 1 min into a 3-min boil, not yet expired
    expect(v.screenId).toBe('wait')
    expect(v.label).toBe('Boil water')
    expect(v.whisperText).toBeNull()
    expect(v.showLink).toBe(false)
    expect(v.note).toBeNull()
    expect(v.primary).toEqual({ label: "It's done", solid: false, action: { kind: 'markDone', nodeId: 'boil_water' } })
  })

  it('sheet_short: a short timer renders as m:ss, not a tilde estimate', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))

    const sheet = buildSheetView(model, se, T0 + MIN) // 1 min in, 2 min left of a 3-min boil
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0].time).toBe('2:00')
    expect(sheet.rows[0].time).toMatch(/^\d+:\d{2}$/)
  })

  it('return_expired: reopening after the boil finished while away shows the handover-pending copy', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))
    se = must(engine.leave(se, model, T0 + MIN))

    const v = view(se, T0 + 8 * MIN) // boil ended at +3; 5 min ago now, 7 min since leaving
    expect(v.screenId).toBe('returning')
    expect(v.title).toBe('You left about seven minutes ago.')
    expect(v.instr).toBe('Something is ready and waiting for you.')
  })
})

// ---------------------------------------------------------------------------
// homemade-donuts — long_wait (wall-clock expectation), handover_ready
// (consumer_ready, distinct from handover_late's overrun wording), sheet with two
// concurrent hands-off nodes (multi-row + dot-priority reordering)
// ---------------------------------------------------------------------------

describe('homemade-donuts', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(DONUTS)
  const ingredients = ingredientsById(DONUTS.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: DONUTS.graph.title, leaving: false })
  }

  /** Rise started, tray greased — the state both `long_wait` and `handover_ready`
   * branch from. */
  function riseRunning(): CookingSession {
    let se = must(engine.start(null, model, 'server:donuts', T0))
    se = must(engine.markDone(se, model, 'bloom_yeast', T0 + 4 * MIN))
    se = must(engine.markDone(se, model, 'mix_dough', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'knead_dough', T0 + 18 * MIN))
    se = must(engine.startNode(se, model, 'first_rise', T0 + 18 * MIN)) // 60-min typical -> ends +78
    se = must(engine.markDone(se, model, 'grease_pan', T0 + 21 * MIN))
    return se
  }

  it('long_wait: idle stretch clears the 45-min threshold and states a wall-clock end', () => {
    // `long_wait` requires `current() === null` — but `make_glaze` has no dependencies
    // of its own (`dependsOn: []`), so it is executable, and therefore `current`, from
    // the very start of the recipe, regardless of schedule position. This is the exact
    // reachability gap the M3.4 design handoff records at §8.14/§8.15: "only reachable
    // by completing make_glaze during the rise, which max_lead_min=15 says is the wrong
    // moment... the graph cannot express 'needed later, but not yet'." Driving through
    // it (not around it) with a real `markDone` is the same route the design's own
    // prototype scenario takes (`[...D_RISE, ['adv', 5], ['markDone', 'make_glaze']]`) —
    // this is not new scheduling semantics, it's the existing, documented path.
    let se = riseRunning()
    se = must(engine.markDone(se, model, 'make_glaze', T0 + 26 * MIN))
    const v = view(se, T0 + 28 * MIN) // 10 min into the rise, 50 min left -> long_wait, not sitting_break
    expect(v.screenId).toBe('long_wait')
    expect(v.label).toBe('First rise')
    expect(v.note).toMatch(/^Ready around \d{1,2}:\d{2} (am|pm)\.$/)
    expect(v.primary).toEqual({ label: "It's done", solid: false, action: { kind: 'markDone', nodeId: 'first_rise' } })
  })

  it('handover_ready: consumer_ready reason gives a solid "On it", not the elapsed wording', () => {
    const se = riseRunning()
    // Rise ends at +78; read 30s past — under the 60s overrun threshold, so the title
    // stays the plain "is done" fact rather than handover_late's "N minutes past."
    const v = view(se, T0 + 78 * MIN + 30_000)
    expect(v.screenId).toBe('handover')
    expect(v.title).toBe('First rise is done.')
    expect(v.instr).toBe(model.nodes.shape_and_cut.instruction)
    expect(v.primary).toEqual({ label: 'On it', solid: true, action: { kind: 'acknowledge' } })
  })

  /** Both fry-adjacent hands-off nodes running concurrently, neither yet expired. */
  function twoPansRunning(): { se: CookingSession; now: number } {
    let se = riseRunning()
    se = must(engine.acknowledge(se, model, T0 + 79 * MIN)) // marks first_rise done (handover pending)
    se = must(engine.markDone(se, model, 'shape_and_cut', T0 + 89 * MIN))
    se = must(engine.startNode(se, model, 'heat_oil', T0 + 89 * MIN)) // 12-min typical -> ends +101
    se = must(engine.startNode(se, model, 'proof_donuts', T0 + 89 * MIN)) // 25-min typical -> ends +114
    return { se, now: T0 + 91 * MIN }
  }

  it('sheet: two concurrent hands-off nodes render independently — m:ss for the short one, a tilde for the wide-range one', () => {
    const { se, now } = twoPansRunning()
    const sheet = buildSheetView(model, se, now)
    expect(sheet.rows).toHaveLength(2)
    const heatOil = sheet.rows.find((r) => r.nodeId === 'heat_oil')!
    const proofDonuts = sheet.rows.find((r) => r.nodeId === 'proof_donuts')!
    expect(heatOil.time).toBe('10:00') // 9-16 min range (<=15 spread) -> m:ss
    expect(proofDonuts.time).toBe('~23m') // 20-40 min range (>15 spread) -> tilde
    expect(heatOil.dot).toBe(false)
    expect(proofDonuts.dot).toBe(false)
    expect(sheet.note).toBe('Nothing here needs you yet.')
  })

  it('sheet: reorders the node whose own expiry will need the cook ahead of the merely-sooner-ending one, with a dot', () => {
    const { se } = twoPansRunning()
    // heat_oil's own timer has now genuinely elapsed (endsAt +101); proof_donuts has
    // not (+114). Once heat_oil is done/expired, fry_donuts's other dependency is
    // satisfied under proof_donuts's own "if it expired now" reading, so proof_donuts
    // — not heat_oil — is the one whose completion would actually need the cook next.
    const sheet = buildSheetView(model, se, T0 + 102 * MIN)
    expect(sheet.rows.map((r) => r.nodeId)).toEqual(['proof_donuts', 'heat_oil'])
    expect(sheet.rows[0].dot).toBe(true)
    expect(sheet.rows[1].dot).toBe(false)
    // heat_oil's own timer is already past zero — sheetTime reports it plainly, not as
    // a negative countdown.
    expect(sheet.rows[1].time).toBe('done')
    expect(sheet.note).toBe('The marked one will want you first.')
  })
})

// ---------------------------------------------------------------------------
// synthetic-two-windows ("bowl") — wait_two_pans: two hands-off nodes running,
// neither one's own expiry would unblock their shared consumer, so there is
// genuinely nothing to name — no primary, no whisper.
// ---------------------------------------------------------------------------

describe('synthetic-two-windows (bowl)', () => {
  const BOWL = syntheticTwoWindows as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(BOWL)
  const ingredients = ingredientsById(BOWL.graph.ingredients)

  it('wait_two_pans: waitSubject is null, so the screen states the fact and offers nothing', () => {
    let se = must(engine.start(null, model, 'server:bowl', T0))
    se = must(engine.markDone(se, model, 'chop_vegetables', T0 + 5 * MIN))
    se = must(engine.markDone(se, model, 'toast_whole_spices', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'simmer_stew', T0 + 8 * MIN)) // 25-min typical -> ends +33
    se = must(engine.startNode(se, model, 'soak_dried_beans', T0 + 8 * MIN)) // 20-min typical -> ends +28
    se = must(engine.markDone(se, model, 'dice_potatoes', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'crush_spice_blend', T0 + 15 * MIN))
    se = must(engine.markDone(se, model, 'mince_garlic_ginger', T0 + 18 * MIN))
    se = must(engine.markDone(se, model, 'rinse_rice', T0 + 21 * MIN))

    const v = buildCookingView(model, se, T0 + 21 * MIN, ingredients, {
      recipeTitle: BOWL.graph.title,
      leaving: false,
    })
    expect(v.screenId).toBe('wait')
    expect(v.title).toBe('Two pans are running.')
    expect(v.instr).toBe('Nothing needs you until they are all done.')
    expect(v.primary).toBeNull()
    expect(v.whisperText).toBeNull()
    expect(v.showLink).toBe(true) // the sheet still lists both — just no single subject to judge
  })
})

// ---------------------------------------------------------------------------
// strawberry-shortcake — task_overlap: a hands-on task is current while two
// hands-off nodes run; the whisper names exactly one of them, never both.
// ---------------------------------------------------------------------------

describe('strawberry-shortcake', () => {
  const SHORTCAKE = strawberryShortcake as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(SHORTCAKE)
  const ingredients = ingredientsById(SHORTCAKE.graph.ingredients)

  it('task_overlap: whisper identifies the one host that will need the cook next, not the other running timer', () => {
    let se = must(engine.start(null, model, 'server:shortcake', T0))
    se = must(engine.markDone(se, model, 'mix_dough', T0 + 6 * MIN))
    se = must(engine.startNode(se, model, 'bake_shortcakes', T0 + 6 * MIN)) // 18-min typical -> ends +24
    se = must(engine.markDone(se, model, 'hull_and_slice_berries', T0 + 11 * MIN))
    se = must(engine.startNode(se, model, 'macerate_berries', T0 + 11 * MIN)) // 20-min typical -> ends +31

    const v = buildCookingView(model, se, T0 + 11 * MIN, ingredients, {
      recipeTitle: SHORTCAKE.graph.title,
      leaving: false,
    })
    // cool_shortcakes (next in schedule order) isn't executable yet (bake_shortcakes
    // not done), so current() skips it and lands on whip_cream, which has no
    // dependencies of its own.
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Whip cream')
    expect(v.showLink).toBe(true)
    // bake_shortcakes' completion is what unblocks cool_shortcakes; macerate_berries'
    // completion doesn't yet unblock anything (assemble_shortcakes still needs
    // cool_shortcakes/slice_garnish_berries too) — so the whisper names bake_shortcakes
    // and never mentions macerate_berries.
    expect(v.whisperText).toContain('Bake shortcakes')
    expect(v.whisperText).not.toContain('Macerate berries')
  })
})

// ---------------------------------------------------------------------------
// synthetic-two-sittings ("rajma") — sitting_break_soak (idle >= 120 min inside the
// first sitting) and sitting_resume (reopened after crossing into the second sitting)
// ---------------------------------------------------------------------------

describe('synthetic-two-sittings (rajma)', () => {
  const RAJMA = syntheticTwoSittings as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(RAJMA)
  const ingredients = ingredientsById(RAJMA.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: RAJMA.graph.title, leaving: false })
  }

  it('sitting_break_soak: the overnight soak clears the session-break threshold with nothing to tap', () => {
    let se = must(engine.start(null, model, 'server:rajma', T0))
    se = must(engine.markDone(se, model, 'rinse_beans', T0 + 3 * MIN))
    se = must(engine.startNode(se, model, 'soak_beans', T0 + 3 * MIN)) // 480-min typical -> ends +483

    const v = view(se, T0 + 5 * MIN) // idle to next-required is ~478 min, well over 120
    expect(v.screenId).toBe('sitting_break')
    expect(v.instr).toBe(model.nodes.soak_beans.instruction)
    expect(v.note).toBe('Nothing here needs you before then.')
    expect(v.title).toMatch(/^Nothing until \d{1,2}:\d{2} (am|pm)\.$/)
    expect(v.primary).toBeNull()
  })

  it('sitting_resume: reopened after crossing the session-break boundary', () => {
    let se = must(engine.start(null, model, 'server:rajma', T0))
    se = must(engine.markDone(se, model, 'rinse_beans', T0 + 3 * MIN))
    se = must(engine.startNode(se, model, 'soak_beans', T0 + 3 * MIN)) // ends +483
    se = must(engine.leave(se, model, T0 + 5 * MIN))

    const v = view(se, T0 + 490 * MIN) // 7 min past the soak's own expiry
    expect(v.screenId).toBe('sitting_resume')
    expect(v.title).toBe('Ready when you are.')
    expect(v.instr).toBe(model.nodes.saute_and_add_beans.instruction)
    expect(v.primary).toEqual({ label: 'Back to cooking', solid: true, action: { kind: 'resume' } })
  })

  it('sheet_long: an 8-hour soak renders as a tilde estimate, not m:ss', () => {
    let se = must(engine.start(null, model, 'server:rajma', T0))
    se = must(engine.markDone(se, model, 'rinse_beans', T0 + 3 * MIN))
    se = must(engine.startNode(se, model, 'soak_beans', T0 + 3 * MIN))

    const sheet = buildSheetView(model, se, T0 + 33 * MIN) // 30 min into the soak
    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0].time).toBe('~450m')
    expect(sheet.rows[0].time).toMatch(/^~\d+m$/)
  })
})

// ---------------------------------------------------------------------------
// pizza-dough — sitting_break (the non-soak case: a room-temperature rise, not an
// overnight soak, still classifies the same way)
// ---------------------------------------------------------------------------

describe('pizza-dough', () => {
  const PIZZA = pizzaDough as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(PIZZA)
  const ingredients = ingredientsById(PIZZA.graph.ingredients)

  it('sitting_break: a 270-min room-temperature rise reads the same as rajma’s overnight soak, with its own copy', () => {
    let se = must(engine.start(null, model, 'server:pizza', T0))
    se = must(engine.startNode(se, model, 'step_in_a_small_bowl_stir_together', T0)) // 5-min typical -> ends +5
    se = must(engine.acknowledge(se, model, T0 + 5 * MIN)) // marks it done; unblocks step_measure...
    se = must(engine.markDone(se, model, 'step_measure_3_1_3_cups_flour', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'step_knead_by_hand_2_minutes_dough', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'step_cover_the_bowl_with_plastic_wrap', T0 + 10 * MIN)) // 270-min -> ends +280

    const v = buildCookingView(model, se, T0 + 12 * MIN, ingredients, {
      recipeTitle: PIZZA.graph.title,
      leaving: false,
    })
    expect(v.screenId).toBe('sitting_break')
    expect(v.instr).toBe(model.nodes.step_cover_the_bowl_with_plastic_wrap.instruction)
    expect(v.instr).toContain('Cover the bowl with plastic wrap') // pizza's own copy, not rajma's
    expect(v.title).toMatch(/^Nothing until /)
  })
})

// ---------------------------------------------------------------------------
// conflict — engine/store layer only. `CookingModeScreen` short-circuits to a
// dedicated `ConflictScreen` before `buildCookingView` is ever reached (see
// `CookingModeScreen.tsx`), so there is no `(model, session)` pair for `viewModel.ts`
// to build a view from; the UI-layer contract under test here is `SessionStore.open`,
// the exact call `CookingModeScreen`/`useSession` make. Component-level rendering of
// `ConflictScreen` is not covered by an automated test: this repo has no
// `@testing-library/react`/`jsdom` set up (`vite.config.ts` runs tests with
// `environment: 'node'`), and per the M3.4 checkpoint instructions that
// infrastructure is not to be added solely for this. That render-layer gap is
// unchanged from Checkpoint 1's audit and remains manually verified in a live browser
// only.
// ---------------------------------------------------------------------------

describe('conflict (engine/store layer)', () => {
  const KADAI = kadaiPaneer as RecipePlanResponse
  const BIRYANI = chickenBiryani as RecipePlanResponse
  const T0 = 1_700_000_000_000

  class MemoryStorage implements StorageLike {
    private data = new Map<string, string>()
    getItem(key: string): string | null {
      return this.data.has(key) ? (this.data.get(key) ?? null) : null
    }
    setItem(key: string, value: string): void {
      this.data.set(key, value)
    }
    removeItem(key: string): void {
      this.data.delete(key)
    }
  }

  it('open() reports conflict for a different plan, and leaves the stored session byte-for-byte unchanged', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, () => T0)

    const started = store.dispatch({ type: 'start', model: kadaiModel, planKey: 'server:kadai', now: T0 })
    if (!started.ok) throw new Error('unexpected rejection')
    const before = store.getState()

    const result = store.open(biryaniModel, 'server:biryani', T0 + 5 * MIN)

    expect(result).toEqual({ status: 'conflict' })
    expect(store.getState()).toEqual(before) // no mutation, no replacement, no new session
    expect(store.getState()).not.toBeNull()
    expect(store.getState()?.planKey).toBe('server:kadai') // the original session is still the one stored
  })
})
