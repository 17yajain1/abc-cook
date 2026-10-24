import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { handsOffLine, timerLength } from './copy'
import type { StripView } from './timers'
import { buildConflictView, buildCookingView, conflictTimer, doneLine, recipeThumbnail, type ScreenId } from './viewModel'
import { ingredientsById } from './quantity'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import kadhiPakora from '@/__fixtures__/kadhi-pakora.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'
import { ADD_TIME_MS } from '@/cooking/constants'
import { createSessionStore, type StorageLike } from '@/cooking/store'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingModel, CookingSession, Rejected, SessionConflict } from '@/cooking/types'
import type { ServingsChoice } from '@/lib/servings'

/**
 * Cooking Mode screen/copy-layer coverage, driven exclusively through real
 * `engine.ts` actions and read through the real `@/cooking/select` functions (via
 * `viewModel.ts`) — every `now` here is an explicit literal passed to the engine/view
 * builders, never a real timer, `setTimeout`, or `Date.now()`. This exercises
 * `resolveScreen`'s composition (lifecycle -> viewed step -> current -> the waiting
 * screen) and the copy each screen derives from it, not the selectors themselves —
 * those are proved by `select.test.ts` / `engine.test.ts` already.
 *
 * PR 2 CP4: the entry, handover, leaving, returning and sitting_resume screens are gone,
 * and so is the What's cooking sheet. A timer's end is a banner (`strips`); with nothing to
 * do, the waiting screen (V2Wait) shows the step whose timer is running.
 */

const MIN = 60_000

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

const stripTexts = (v: { strips: StripView[] }) =>
  v.strips.map((s) => (s.kind === 'timer' ? `${s.name}: ${s.left}` : s.kind === 'more' ? s.text : `${s.title} / ${s.line}`))

// The waiting screen's ready line, wake lock held / released.
const RING = /^Ready around .+\. We'll ring when it's done\.$/
const ALARM = /^Ready around .+\. Set an alarm too; we can't ring once your phone locks\.$/

// ---------------------------------------------------------------------------
// kadai-paneer — task, handsoff_pending, task_window, the waiting screen, done, stale
// ---------------------------------------------------------------------------

describe('kadai-paneer', () => {
  const KADAI = kadaiPaneer as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(KADAI)
  const ingredients = ingredientsById(KADAI.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: KADAI.graph.title })
  }

  /** The base running (ends +22) with every window task done: nothing left for the cook. */
  function baseWaiting(): CookingSession {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'chop_capsicum', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'cube_paneer', T0 + 14 * MIN))
    return must(engine.markDone(se, model, 'make_kadai_masala', T0 + 16 * MIN))
  }

  it('task: shows the hands-on task screen for the first node', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const v = view(se, T0)
    expect(v.screenId).toBe('task')
    expect(v.layout).toBe('step')
    expect(v.label).toBe('Chop onion')
    // F2: the step screen's amounts move from the quantity line to ingredient chips —
    // the same structured phrase, one chip per ingredient; the quantity line is gone.
    expect(v.chips).toEqual(['2 medium onion'])
    expect(v.qty).toBeNull()
    expect(v.primary).toEqual({ label: 'Done', solid: true, action: { kind: 'markDone', nodeId: 'chop_onion' } })
    // P1 #6 §C1/§C2: "Step 1 of 10" and a preview of what Done would unblock next.
    expect(v.step).toBe('Step 1 of 10')
    expect(v.upNext?.name).toBe('Chop tomato')
  })

  it('handsoff_pending: shows the hands-off-pending screen once every hands-on prerequisite is done', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))

    const v = view(se, T0 + 10 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(v.label).toBe('Cook tomato base')
    // CP3: the timer start is named from the duration (FGC-37).
    expect(v.primary).toEqual({
      label: 'Start 12-min timer',
      solid: true,
      action: { kind: 'startNode', nodeId: 'cook_tomato_base' },
    })
    // Three hands-on steps done -> Step 4 of 10. The preview simulates the timer start
    // and finds the first window prep task it unblocks.
    expect(v.step).toBe('Step 4 of 10')
    expect(v.upNext?.name).toBe('Cube capsicum')
    // F2 covers the pending hands-off start screen too: cook_tomato_base consumes ing_salt
    // ("to taste") plus two comp_* ids, which have no ingredient row and no chip.
    expect(v.chips).toEqual(['salt to taste'])
    expect(v.qty).toBeNull()
  })

  it('task_window: shows a task inside the wait window with a rail naming the host', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))

    const v = view(se, T0 + 10 * MIN + 1000)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Cube capsicum')
    expect(v.strips).toMatchObject([{ kind: 'timer', name: 'Cook tomato base' }])
    expect(v.step).toBe('Step 5 of 10')
    expect(v.upNext?.name).toBe('Cube paneer')
    expect(v.chips).toEqual(['1 large capsicum'])
  })

  it('task_window: the last prep in a window previews the step blocked behind the wait, not a node the wait subject blocks', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'chop_capsicum', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'cube_paneer', T0 + 14 * MIN))

    // make_kadai_masala is now current; cook_tomato_base is still running (not done),
    // so marking it done doesn't unblock add_veggies yet — the preview falls back to
    // the first pending/deferred node in order rather than reporting no preview at all.
    const v = view(se, T0 + 15 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Make kadai masala')
    expect(v.upNext?.name).toBe('Add veggies')
  })

  it('finish: the last step has no preview', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) {
      se = must(engine.markDone(se, model, id, T0 + 10 * MIN))
    }
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) {
      se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    }
    se = must(engine.markDone(se, model, 'cook_tomato_base', T0 + 22 * MIN))
    se = must(engine.markDone(se, model, 'add_veggies', T0 + 27 * MIN))
    se = must(engine.markDone(se, model, 'add_paneer', T0 + 32 * MIN))

    const v = view(se, T0 + 34 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Finish')
    expect(v.step).toBe('Step 10 of 10')
    expect(v.upNext).toBeNull()
  })

  it('waiting (CP4, V2Wait): nothing left for the cook, so the running base gets the waiting screen', () => {
    // Viewed at exactly +16 min — the same instant as the last markDone — Undo is still
    // within its 10 s window.
    const atTransition = view(baseWaiting(), T0 + 16 * MIN)
    expect(atTransition.screenId).toBe('wait')
    expect(atTransition.layout).toBe('waiting')
    expect(atTransition.label).toBe('Cook tomato base')
    expect(atTransition.nodeId).toBe('cook_tomato_base')
    expect(atTransition.step).toBe('Step 4 of 10')
    expect(atTransition.waiting).toMatchObject({ big: '6', unit: 'min left', ended: false })
    expect(atTransition.waiting!.line).toMatch(RING)
    expect(atTransition.waiting!.add).toEqual({
      label: 'Add 5 min',
      solid: false,
      action: { kind: 'extend', nodeId: 'cook_tomato_base', ms: ADD_TIME_MS },
    })
    // The base hosts the window: every task is done.
    expect(atTransition.waiting!.meanwhile.map((r) => [r.nodeId, r.right])).toEqual([
      ['chop_capsicum', 'Done'],
      ['cube_paneer', 'Done'],
      ['make_kadai_masala', 'Done'],
    ])
    expect(atTransition.upNext).toMatchObject({ label: "When it's done", name: 'Add veggies' })
    expect(atTransition.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'cook_tomato_base' } })
    // Its own timer has no rail (no duplicate); nothing else runs.
    expect(atTransition.strips).toEqual([])
    // Undo names what it undoes, as on the step pages (item 12).
    expect(atTransition.secondary).toEqual({ label: 'Undo Done on Make kadai masala', solid: false, action: { kind: 'undo' } })
    // No step text, chips or You'll need on the waiting screen.
    expect([atTransition.chips, atTransition.need, atTransition.title]).toEqual([[], [], ''])

    expect(view(baseWaiting(), T0 + 16 * MIN + 10_000).secondary).toBeNull()
  })

  it('waiting: "Add 5 min" adds five minutes to the time left', () => {
    let se = baseWaiting()
    expect(view(se, T0 + 16 * MIN).waiting?.big).toBe('6')
    se = must(engine.extend(se, model, 'cook_tomato_base', T0 + 16 * MIN, ADD_TIME_MS))
    expect(view(se, T0 + 16 * MIN).waiting?.big).toBe('11')
  })

  it('waiting, its timer ended (no handover takeover): "Time\'s up", when it ended, the bar full, Add 5 min and It\'s done', () => {
    const v = view(baseWaiting(), T0 + 23 * MIN) // ends at +22, so this is 1 min past
    expect(v.screenId).toBe('wait')
    expect(v.label).toBe('Cook tomato base')
    expect(v.waiting).toMatchObject({ big: "Time's up", unit: null, ended: true, line: 'Timer ended 1 min ago', fraction: 1 })
    expect(v.waiting?.add.action).toEqual({ kind: 'extend', nodeId: 'cook_tomato_base', ms: ADD_TIME_MS })
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'cook_tomato_base' } })
    // Its own banner hides, as its rail does: one control per job on the screen.
    expect(v.strips).toEqual([])
    expect(v.chips).toEqual([])
  })

  it('done (V2Done): the title, one line from the session, Back to the steps, "Finished cooking", Undo for 10 s', () => {
    let se = baseWaiting()
    se = must(engine.markDone(se, model, 'cook_tomato_base', T0 + 22 * MIN))
    se = must(engine.markDone(se, model, 'add_veggies', T0 + 27 * MIN))
    se = must(engine.markDone(se, model, 'add_paneer', T0 + 32 * MIN))
    se = must(engine.markDone(se, model, 'finish', T0 + 34 * MIN))

    const v = view(se, T0 + 34 * MIN)
    expect(v.screenId).toBe('done')
    expect(v.layout).toBe('done')
    expect(v.title).toBe('Kadai Paneer is done.')
    expect(v.done).toEqual({ thumbnail: null, alt: "Kadai Paneer, from the recipe's video", line: 'All 10 steps, in 34 min.' })
    expect([v.instr, v.note, v.qty, v.chips, v.strips, v.step, v.upNext]).toEqual([null, null, null, [], [], null, null])
    expect(v.topRecipe).toBe('')
    expect(v.showTopRight).toBe(false)
    expect(v.back).toEqual({ label: 'Back', solid: false, action: { kind: 'review' } })
    expect(v.primary).toEqual({ label: 'Finished cooking', solid: true, action: { kind: 'finish' } })
    // P1 #6 §C3: the done screen is itself the undo buffer for an accidental final Done.
    expect(v.secondary).toEqual({ label: 'Undo', solid: false, action: { kind: 'undo' } })
    expect(view(se, T0 + 34 * MIN + 10_000).secondary).toBeNull()
    // M5: completion counting is wired behind this `finish` action, so the screen's one
    // primary must stay exactly this — before and after the undo window — with no new action.
    expect(view(se, T0 + 34 * MIN + 10_000).primary).toEqual(v.primary)

    // Undo from the done screen returns to the finish step, restoring its step count.
    const undone = must(engine.undo(se, model, T0 + 34 * MIN + 1000))
    const undoneView = view(undone, T0 + 34 * MIN + 1000)
    expect(undoneView.screenId).toBe('task')
    expect(undoneView.label).toBe('Finish')
    expect(undoneView.step).toBe('Step 10 of 10')
  })

  it('stale (CP4): "You were last here …", Carry on / Start again', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const v = view(se, T0 + 361 * MIN) // staleThresholdMs(34) = 6h floor
    expect(v.screenId).toBe('stale')
    expect(v.layout).toBe('message')
    expect(v.title).toBe('You were last here 6 hr 1 min ago.')
    // The CP4 form, with a breakable space before "ago.", is gone.
    expect(v.title).not.toBe('You were last here 6 hr 1 min ago.')
    // CP4.1: the last unit and "ago." stay together too (a no-break space).
    expect(v.title.endsWith('min ago.')).toBe(true)
    // CP4.1: Leave in its top bar, as on every cooking screen.
    expect(v.showTopRight).toBe(true)
    expect(v.instr).toBe('Carry on where you left off, or start again.')
    expect(v.primary).toEqual({ label: 'Carry on', solid: true, action: { kind: 'touch' } })
    expect(v.secondary).toEqual({ label: 'Start again', solid: false, action: { kind: 'startAgain' } })
  })

  it('stale is timed from the last action (CP4.0), not from the start', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 300 * MIN))
    expect(view(se, T0 + 361 * MIN).screenId).toBe('task')
    expect(view(se, T0 + 300 * MIN + 7 * 60 * MIN).title).toBe('You were last here 7 hr ago.')
    expect(view(se, T0 + 300 * MIN + 7 * 60 * MIN).title).not.toBe('You were last here 7 hr ago.')
  })

  it('a cook coming back after leaving gets the step they left (leftAt is ignored; no returning screen)', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.leave(se, model, T0 + 5 * MIN))
    const v = view(se, T0 + 9 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Chop tomato')
  })
})

// ---------------------------------------------------------------------------
// P1 #6 orientation/recovery — the undo link across a wider spread of fixtures.
// ---------------------------------------------------------------------------

describe('undo link — P1 #6 §C3', () => {
  const KADAI = kadaiPaneer as RecipePlanResponse
  const BIRYANI = chickenBiryani as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const kadaiModel = deriveCookingModel(KADAI)
  const kadaiIngredients = ingredientsById(KADAI.graph.ingredients)

  it('shows at +0 s and +9.9 s, gone at +10 s, and names the started step right after a startNode (CP2a)', () => {
    let se = must(engine.start(null, kadaiModel, 'server:kadai', T0))
    se = must(engine.markDone(se, kadaiModel, 'chop_onion', T0 + 1 * MIN))
    const view = (now: number) => buildCookingView(kadaiModel, se, now, kadaiIngredients, { recipeTitle: KADAI.graph.title })

    // CP3: the page now shows chop_tomato, not the acted-on step, so the link names it.
    expect(view(T0 + 1 * MIN).secondary).toEqual({
      label: 'Undo Done on Chop onion',
      solid: false,
      action: { kind: 'undo' },
    })
    expect(view(T0 + 1 * MIN + 9_900).secondary).toEqual({
      label: 'Undo Done on Chop onion',
      solid: false,
      action: { kind: 'undo' },
    })
    // Past the window, the undo override lifts; CP3 removed Skip, so nothing replaces it.
    expect(view(T0 + 1 * MIN + 10_000).secondary).toBeNull()

    // The timer start on the next hands-off step is itself undoable (PR 2 CP2a, owner
    // option A): the link names the started step for 10 s, then nothing.
    se = must(engine.markDone(se, kadaiModel, 'chop_tomato', T0 + 2 * MIN))
    se = must(engine.markDone(se, kadaiModel, 'saute_onion', T0 + 2 * MIN))
    se = must(engine.startNode(se, kadaiModel, 'cook_tomato_base', T0 + 2 * MIN))
    expect(view(T0 + 2 * MIN).secondary).toEqual({
      label: 'Undo timer start on Cook tomato base',
      solid: false,
      action: { kind: 'undo' },
    })
    expect(view(T0 + 2 * MIN + 10_000).secondary).toBeNull()
  })

  it('two timers ending at once are two banners over the step page; after a multi-producer acknowledge, Undo names the first producer', () => {
    const model = deriveCookingModel(BIRYANI)
    const biryaniIngredients = ingredientsById(BIRYANI.graph.ingredients)
    const view = (session: CookingSession, now: number) =>
      buildCookingView(model, session, now, biryaniIngredients, { recipeTitle: BIRYANI.graph.title })

    let se = must(engine.start(null, model, 'server:biryani', T0))
    se = must(engine.startNode(se, model, 'boil_spiced_water', T0))
    se = must(engine.startNode(se, model, 'soak_rice', T0))
    // boil_spiced_water ends +6, soak_rice ends +20 — at +20 both have ended.
    const beforeAck = view(se, T0 + 20 * MIN)
    expect(beforeAck.layout).toBe('step')
    expect(stripTexts(beforeAck)).toEqual([
      'Boil spiced water is ready / Timer ended 14 min ago',
      'Soak rice is ready / Timer ended just now',
    ])

    se = must(engine.acknowledge(se, model, T0 + 20 * MIN))
    const afterAck = view(se, T0 + 20 * MIN)
    expect(afterAck.secondary).toEqual({
      label: 'Undo Done on Boil spiced water',
      solid: false,
      action: { kind: 'undo' },
    })
  })
})

// ---------------------------------------------------------------------------
// maggi-2min — the waiting screen's floor (one timer, nothing else), under a minute,
// coming back after the timer ended
// ---------------------------------------------------------------------------

describe('maggi-2min', () => {
  const MAGGI = maggi2min as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(MAGGI)
  const ingredients = ingredientsById(MAGGI.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: MAGGI.graph.title })
  }

  it('waiting floor: one timer, nothing else running, no Meanwhile block, no strips', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))

    const v = view(se, T0 + MIN) // 1 min into a 3-min boil, not yet expired
    expect(v.screenId).toBe('wait')
    expect(v.label).toBe('Boil water')
    expect(v.strips).toEqual([])
    expect(v.waiting).toMatchObject({ big: '2', unit: 'min left', meanwhile: [] })
    expect(v.waiting!.line).toMatch(RING)
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'boil_water' } })
  })

  it('under a minute left: whole minutes, rounded up, never m:ss', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))

    const v = view(se, T0 + 3 * MIN - 20_000) // 20s left of the 3-min boil
    expect(v.waiting).toMatchObject({ big: '1', unit: 'min left' })
    expect(JSON.stringify(v)).not.toMatch(/\d:\d\d\b(?!\s?(am|pm|AM|PM))/)
  })

  it('back after the boil ended while away: its waiting screen says when it ended', () => {
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))
    se = must(engine.leave(se, model, T0 + MIN))

    const v = view(se, T0 + 8 * MIN) // boil ended at +3
    expect(v.screenId).toBe('wait')
    expect(v.waiting).toMatchObject({ big: "Time's up", line: 'Timer ended 5 min ago' })
  })
})

// ---------------------------------------------------------------------------
// homemade-donuts — long_wait (the alarm line), a timer end over a step page
// ---------------------------------------------------------------------------

describe('homemade-donuts', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(DONUTS)
  const ingredients = ingredientsById(DONUTS.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: DONUTS.graph.title })
  }

  /** Rise started, tray greased. */
  function riseRunning(): CookingSession {
    let se = must(engine.start(null, model, 'server:donuts', T0))
    se = must(engine.markDone(se, model, 'bloom_yeast', T0 + 4 * MIN))
    se = must(engine.markDone(se, model, 'mix_dough', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'knead_dough', T0 + 18 * MIN))
    se = must(engine.startNode(se, model, 'first_rise', T0 + 18 * MIN)) // 60-min typical -> ends +78
    return must(engine.markDone(se, model, 'grease_pan', T0 + 21 * MIN))
  }

  it('long_wait: the wake lock is released, so the ready line says to set an alarm, never "We\'ll ring"', () => {
    // `make_glaze` has no dependencies, so it is current until done (the M3.4 handoff's
    // §8.14/§8.15 reachability note); done here, nothing is left for the cook.
    let se = riseRunning()
    se = must(engine.markDone(se, model, 'make_glaze', T0 + 26 * MIN))
    const v = view(se, T0 + 28 * MIN) // 50 min left -> long_wait, not sitting_break
    expect(v.screenId).toBe('long_wait')
    expect(v.label).toBe('First rise')
    expect(v.waiting).toMatchObject({ big: '50', unit: 'min left' })
    expect(v.waiting!.line).toMatch(ALARM)
    expect(v.waiting!.meanwhile).toMatchObject([{ nodeId: 'grease_pan', state: 'done', right: 'Done' }])
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'first_rise' } })
  })

  it('a timer that ends while a step is still to do is a banner over that step, not a takeover', () => {
    const v = view(riseRunning(), T0 + 78 * MIN + 30_000)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Make glaze')
    expect(v.strips).toEqual([
      {
        kind: 'banner',
        nodeId: 'first_rise',
        title: 'First rise is ready',
        line: 'Timer ended just now',
        add: { label: '+5 min', action: { kind: 'extend', nodeId: 'first_rise', ms: ADD_TIME_MS } },
        done: { label: 'Done', action: { kind: 'markDone', nodeId: 'first_rise' } },
      },
    ])
  })
})

// ---------------------------------------------------------------------------
// synthetic-two-windows ("bowl") — two pans, neither one the wait subject
// ---------------------------------------------------------------------------

describe('synthetic-two-windows (bowl)', () => {
  const BOWL = syntheticTwoWindows as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(BOWL)
  const ingredients = ingredientsById(BOWL.graph.ingredients)

  it('two pans, no wait subject: the soonest running timer gets the waiting screen, the other its rail', () => {
    let se = must(engine.start(null, model, 'server:bowl', T0))
    se = must(engine.markDone(se, model, 'chop_vegetables', T0 + 5 * MIN))
    se = must(engine.markDone(se, model, 'toast_whole_spices', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'simmer_stew', T0 + 8 * MIN)) // 25-min typical -> ends +33
    se = must(engine.startNode(se, model, 'soak_dried_beans', T0 + 8 * MIN)) // 20-min typical -> ends +28
    se = must(engine.markDone(se, model, 'dice_potatoes', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'crush_spice_blend', T0 + 15 * MIN))
    se = must(engine.markDone(se, model, 'mince_garlic_ginger', T0 + 18 * MIN))
    se = must(engine.markDone(se, model, 'rinse_rice', T0 + 21 * MIN))

    const v = buildCookingView(model, se, T0 + 21 * MIN, ingredients, { recipeTitle: BOWL.graph.title })
    expect(v.screenId).toBe('wait')
    expect(v.nodeId).toBe('soak_dried_beans')
    expect(v.waiting).toMatchObject({ big: '7', unit: 'min left' })
    expect(stripTexts(v)).toEqual(['Simmer stew: 12 min left'])
  })
})

// ---------------------------------------------------------------------------
// strawberry-shortcake — task_overlap: a hands-on task is current while two
// hands-off nodes run; both get a rail.
// ---------------------------------------------------------------------------

describe('strawberry-shortcake', () => {
  const SHORTCAKE = strawberryShortcake as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(SHORTCAKE)
  const ingredients = ingredientsById(SHORTCAKE.graph.ingredients)

  it('task_overlap: both running timers get a rail, soonest to finish on top', () => {
    let se = must(engine.start(null, model, 'server:shortcake', T0))
    se = must(engine.markDone(se, model, 'mix_dough', T0 + 6 * MIN))
    se = must(engine.startNode(se, model, 'bake_shortcakes', T0 + 6 * MIN)) // 18-min typical -> ends +24
    se = must(engine.markDone(se, model, 'hull_and_slice_berries', T0 + 11 * MIN))
    se = must(engine.startNode(se, model, 'macerate_berries', T0 + 11 * MIN)) // 20-min typical -> ends +31

    const v = buildCookingView(model, se, T0 + 11 * MIN, ingredients, { recipeTitle: SHORTCAKE.graph.title })
    // cool_shortcakes (next in schedule order) isn't executable yet (bake_shortcakes
    // not done), so current() skips it and lands on whip_cream, which has no
    // dependencies of its own.
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Whip cream')
    expect(stripTexts(v)).toEqual(['Bake shortcakes: 13 min left', 'Macerate berries: 20 min left'])
  })
})

// ---------------------------------------------------------------------------
// PR 2 CP3 rails and CP4 banners on the step and waiting screens.
// ---------------------------------------------------------------------------

describe('rails and banners (CP3, CP4)', () => {
  const SHORTCAKE = strawberryShortcake as RecipePlanResponse
  const KADAI = kadaiPaneer as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const shortcake: CookingModel = deriveCookingModel(SHORTCAKE)
  const kadai: CookingModel = deriveCookingModel(KADAI)
  const shortcakeIngredients = ingredientsById(SHORTCAKE.graph.ingredients)
  const kadaiIngredients = ingredientsById(KADAI.graph.ingredients)

  function shortcakeView(session: CookingSession, now: number) {
    return buildCookingView(shortcake, session, now, shortcakeIngredients, { recipeTitle: SHORTCAKE.graph.title })
  }

  /** bake_shortcakes running (ends +24), hull_and_slice_berries current. */
  function bakeRunning(): CookingSession {
    let se = must(engine.start(null, shortcake, 'server:shortcake', T0))
    se = must(engine.markDone(se, shortcake, 'mix_dough', T0 + 6 * MIN))
    return must(engine.startNode(se, shortcake, 'bake_shortcakes', T0 + 6 * MIN))
  }

  /** Bake done at +24 and cool_shortcakes started (ends +34); macerate_berries
   * (ends +31) runs on with whip_cream current. */
  function coolingWithMacerateRunning(): CookingSession {
    let se = bakeRunning()
    se = must(engine.markDone(se, shortcake, 'hull_and_slice_berries', T0 + 11 * MIN))
    se = must(engine.startNode(se, shortcake, 'macerate_berries', T0 + 11 * MIN))
    se = must(engine.markDone(se, shortcake, 'bake_shortcakes', T0 + 24 * MIN))
    return must(engine.startNode(se, shortcake, 'cool_shortcakes', T0 + 24 * MIN))
  }

  it('exactly one other node running: one rail', () => {
    const v = shortcakeView(bakeRunning(), T0 + 6 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Hull and slice berries')
    expect(stripTexts(v)).toEqual(['Bake shortcakes: 18 min left'])
  })

  it('handsoff_pending: the rail names the running node while the pending one waits to be started', () => {
    const se = must(engine.markDone(bakeRunning(), shortcake, 'hull_and_slice_berries', T0 + 11 * MIN))
    const v = shortcakeView(se, T0 + 11 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(v.label).toBe('Macerate berries')
    expect(stripTexts(v)).toEqual(['Bake shortcakes: 13 min left'])
  })

  it('an expired timer nothing needs yet is a banner (CP4), the other timer its rail', () => {
    // macerate_berries ended at +31 and nothing requires it yet; cool_shortcakes ends +34.
    const v = shortcakeView(coolingWithMacerateRunning(), T0 + 32 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Whip cream')
    expect(stripTexts(v)).toEqual(['Macerate berries is ready / Timer ended 1 min ago', 'Cool shortcakes: 2 min left'])
  })

  it('periodic host: a rail like any other timer', () => {
    let se = must(engine.start(null, kadai, 'server:kadai', T0))
    se = must(engine.markDone(se, kadai, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, kadai, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, kadai, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.startNode(se, kadai, 'cook_tomato_base', T0 + 10 * MIN)) // periodic, 12-min typical

    const v = buildCookingView(kadai, se, T0 + 10 * MIN + 1000, kadaiIngredients, { recipeTitle: KADAI.graph.title })
    expect(v.screenId).toBe('task')
    expect(stripTexts(v)).toEqual(['Cook tomato base: 12 min left'])
  })

  it('waiting screen: its own timer has no strip; another timer\'s end is still a banner', () => {
    let se = coolingWithMacerateRunning()
    se = must(engine.markDone(se, shortcake, 'whip_cream', T0 + 28 * MIN))
    se = must(engine.markDone(se, shortcake, 'slice_garnish_berries', T0 + 30 * MIN))
    // cool_shortcakes (ends +34) is the wait subject; macerate_berries expired at +31.
    const v = shortcakeView(se, T0 + 32 * MIN)
    expect(v.screenId).toBe('wait')
    expect(v.label).toBe('Cool shortcakes')
    expect(stripTexts(v)).toEqual(['Macerate berries is ready / Timer ended 1 min ago'])
  })

  it('the done and stale screens carry no strips', () => {
    let se = must(engine.start(null, kadai, 'server:kadai', T0))
    se = must(engine.startNode(se, kadai, 'cook_tomato_base', T0))
    se = must(engine.markDone(se, kadai, 'finish', T0 + MIN))
    const doneView = buildCookingView(kadai, se, T0 + MIN, kadaiIngredients, { recipeTitle: KADAI.graph.title })
    expect(doneView.screenId).toBe('done')
    expect(doneView.strips).toEqual([])

    const stale = must(engine.startNode(must(engine.start(null, kadai, 'server:kadai', T0)), kadai, 'cook_tomato_base', T0))
    const staleView = buildCookingView(kadai, stale, T0 + 3 * 24 * 60 * MIN, kadaiIngredients, { recipeTitle: KADAI.graph.title })
    expect(staleView.screenId).toBe('stale')
    expect(staleView.strips).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// synthetic-two-sittings ("rajma") — sitting_break (the alarm line), coming back after
// the overnight soak ended
// ---------------------------------------------------------------------------

describe('synthetic-two-sittings (rajma)', () => {
  const RAJMA = syntheticTwoSittings as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(RAJMA)
  const ingredients = ingredientsById(RAJMA.graph.ingredients)

  function view(session: CookingSession, now: number) {
    return buildCookingView(model, session, now, ingredients, { recipeTitle: RAJMA.graph.title })
  }

  function soaking(): CookingSession {
    let se = must(engine.start(null, model, 'server:rajma', T0))
    se = must(engine.markDone(se, model, 'rinse_beans', T0 + 3 * MIN))
    return must(engine.startNode(se, model, 'soak_beans', T0 + 3 * MIN)) // 480-min typical -> ends +483
  }

  it('sitting_break: the overnight soak, hours and minutes left, the alarm line', () => {
    const v = view(soaking(), T0 + 5 * MIN)
    expect(v.screenId).toBe('sitting_break')
    expect(v.layout).toBe('waiting')
    expect(v.label).toBe(model.nodes.soak_beans.label)
    expect(v.waiting).toMatchObject({ big: '7 hr 58 min', unit: 'left' })
    expect(v.waiting!.line).toMatch(ALARM)
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'soak_beans' } })
  })

  it('back after the soak ended (no sitting_resume screen): its waiting screen says when it ended', () => {
    const se = must(engine.leave(soaking(), model, T0 + 5 * MIN))
    const v = view(se, T0 + 490 * MIN) // 7 min past the soak's own end
    expect(v.layout).toBe('waiting')
    expect(v.nodeId).toBe('soak_beans')
    expect(v.waiting).toMatchObject({ ended: true, line: 'Timer ended 7 min ago' })
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'saute_and_add_beans' })
  })
})

// ---------------------------------------------------------------------------
// pizza-dough — a hands-off step with no doneness cue; a 270-min rise
// ---------------------------------------------------------------------------

describe('pizza-dough', () => {
  const PIZZA = pizzaDough as RecipePlanResponse
  const T0 = 1_700_000_000_000
  const model: CookingModel = deriveCookingModel(PIZZA)
  const ingredients = ingredientsById(PIZZA.graph.ingredients)
  const bloom = 'step_in_a_small_bowl_stir_together'

  it('waiting: a hands-off node with no doneness cue still gets the time left and "It\'s done"', () => {
    const se = must(engine.startNode(must(engine.start(null, model, 'server:pizza', T0)), model, bloom, T0))
    const v = buildCookingView(model, se, T0 + 1 * MIN, ingredients, { recipeTitle: PIZZA.graph.title })
    expect(v.screenId).toBe('wait')
    expect(v.label).toBe(model.nodes[bloom].label)
    expect(v.cue).toBeNull()
    expect(v.waiting).toMatchObject({ big: '4', unit: 'min left' }) // ends at +5, viewed at +1
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: bloom } })
  })

  it('sitting_break: a 270-min room-temperature rise', () => {
    let se = must(engine.start(null, model, 'server:pizza', T0))
    se = must(engine.startNode(se, model, bloom, T0)) // 5-min typical -> ends +5
    se = must(engine.markDone(se, model, bloom, T0 + 5 * MIN))
    se = must(engine.markDone(se, model, 'step_measure_3_1_3_cups_flour', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'step_knead_by_hand_2_minutes_dough', T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'step_cover_the_bowl_with_plastic_wrap', T0 + 10 * MIN)) // 270-min -> ends +280

    const v = buildCookingView(model, se, T0 + 12 * MIN, ingredients, { recipeTitle: PIZZA.graph.title })
    expect(v.screenId).toBe('sitting_break')
    expect(v.label).toBe(model.nodes.step_cover_the_bowl_with_plastic_wrap.label)
    expect(v.waiting!.line).toMatch(ALARM)
  })
})

// ---------------------------------------------------------------------------
// conflict — engine/store layer. `CookingModeScreen` renders `ConflictScreen` from
// `OpenResult.conflict`, before `buildCookingView` is ever reached; the UI-layer contract
// under test here is `SessionStore.open`, the exact call `CookingModeScreen`/`useSession`
// make.
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

    expect(result).toEqual({
      status: 'conflict',
      conflict: { planKey: 'server:kadai', title: null, state: 'active' },
    })
    expect(store.getState()).toEqual(before) // no mutation, no replacement, no new session
    expect(store.getState()?.planKey).toBe('server:kadai') // the original session is still the one stored
  })
})

describe('buildConflictView (V2Conflict, PR 2 CP4)', () => {
  const T0 = 1_700_000_000_000
  const opts = (timer: { stepName: string | null; endsAt: number } | null = null) => ({ recipeTitle: 'Kurkuri Bhindi', timer, now: T0 })
  const view = (conflict: SessionConflict, canGoTo: (planKey: string) => boolean = () => true, timer: Parameters<typeof opts>[0] = null) =>
    buildConflictView(conflict, canGoTo, opts(timer))
  const KADAI: SessionConflict = { planKey: 'library:kadai-id', title: 'Kadai Paneer', state: 'active' }

  it('heading by state, through sentence(); a title ending in "." never doubles it', () => {
    expect(view(KADAI).heading).toBe("You're still cooking Kadai Paneer.")
    expect(view({ ...KADAI, state: 'unknown' }).heading).toBe("You're still cooking Kadai Paneer.")
    expect(view({ ...KADAI, state: 'stale' }).heading).toBe('You left Kadai Paneer a while ago.')
    expect(view({ ...KADAI, state: 'finished' }).heading).toBe('You finished Kadai Paneer.')
    expect(view({ ...KADAI, title: 'Pizza dough.' }).heading).toBe("You're still cooking Pizza dough.")
    expect(view({ ...KADAI, title: null }).heading).toBe("You're still cooking another recipe.")
  })

  it('the line names the soonest timer, with the step name\'s own casing, then "Pick one cook to carry on with."', () => {
    expect(view(KADAI, () => true, { stepName: 'Tomato base', endsAt: T0 + 6 * MIN }).line).toBe(
      'Tomato base has 6 min left on its timer. Pick one cook to carry on with.',
    )
    expect(view(KADAI, () => true, { stepName: 'Tomato base', endsAt: T0 - 4 * MIN }).line).toBe(
      "Tomato base's timer ended 4 min ago. Pick one cook to carry on with.",
    )
    expect(view(KADAI, () => true, { stepName: null, endsAt: T0 + 6 * MIN }).line).toBe('A timer has 6 min left. Pick one cook to carry on with.')
    expect(view(KADAI).line).toBe('Pick one cook to carry on with.')
  })

  it('two choices: "Back to ‹A›" (primary) and "End it and cook ‹B›"', () => {
    expect(view(KADAI).actions).toEqual([
      { kind: 'goTo', label: 'Back to Kadai Paneer' },
      { kind: 'endAndStart', label: 'End it and cook Kurkuri Bhindi' },
    ])
  })

  it('CP-C order: stale and finished lead with "End it"; active and unknown with "Back to"', () => {
    for (const state of ['stale', 'finished'] as const) {
      expect(view({ ...KADAI, state }).actions.map((a) => a.kind)).toEqual(['endAndStart', 'goTo'])
    }
    for (const state of ['active', 'unknown'] as const) {
      expect(view({ ...KADAI, state }).actions.map((a) => a.kind)).toEqual(['goTo', 'endAndStart'])
    }
  })

  it('cannot go to it (an import: key, a deleted entry): "End it and cook ‹B›" and "Back", for every state', () => {
    for (const state of ['active', 'unknown', 'stale', 'finished'] as const) {
      expect(view({ ...KADAI, state }, () => false).actions).toEqual([
        { kind: 'endAndStart', label: 'End it and cook Kurkuri Bhindi' },
        { kind: 'close', label: 'Back' },
      ])
    }
    // The default predicate is the prefix rule: an import: key is never a destination.
    expect(buildConflictView({ ...KADAI, planKey: 'import:abc' }, undefined, opts()).actions.map((a) => a.kind)).toEqual([
      'endAndStart',
      'close',
    ])
  })

  it('a legacy conflict with no title: "Back to that recipe"', () => {
    expect(view({ ...KADAI, title: null }).actions[0].label).toBe('Back to that recipe')
  })
})

describe('conflictTimer (PR 2 CP4)', () => {
  const T0 = 1_700_000_000_000
  const BIRYANI = chickenBiryani as RecipePlanResponse
  const model = deriveCookingModel(BIRYANI)

  it('the soonest running timer of the stored session, named by the given lookup', () => {
    let se = must(engine.start(null, model, 'library:b', T0))
    se = must(engine.startNode(se, model, 'soak_rice', T0)) // ends +20
    se = must(engine.startNode(se, model, 'boil_spiced_water', T0)) // ends +6
    expect(conflictTimer(se, (id) => model.nodes[id].label)).toEqual({ stepName: 'Boil spiced water', endsAt: T0 + 6 * MIN })
    expect(conflictTimer(se, () => null)).toEqual({ stepName: null, endsAt: T0 + 6 * MIN })
  })

  it('no timer running, or no session: none', () => {
    expect(conflictTimer(must(engine.start(null, model, 'library:b', T0)), () => 'x')).toBeNull()
    expect(conflictTimer(null, () => 'x')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// PR 2 CP1 — out-of-order states give sane screens, and the undo link is offered for the
// new transitions only inside UNDO_WINDOW_MS.
// ---------------------------------------------------------------------------

describe('CP1 — screens tolerate out-of-order states', () => {
  const T0 = 1_700_000_000_000

  it('kadai: a consumer done first leaves a task screen on the next unpassed step', () => {
    const KADAI = kadaiPaneer as RecipePlanResponse
    const model = deriveCookingModel(KADAI)
    const ingredients = ingredientsById(KADAI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0))
    se = must(engine.markDone(se, model, 'chop_tomato', T0))
    se = must(engine.markDone(se, model, 'saute_onion', T0))
    se = must(engine.markDone(se, model, 'cook_tomato_base', T0 + MIN))
    se = must(engine.markDone(se, model, 'add_veggies', T0 + 2 * MIN))

    const v = buildCookingView(model, se, T0 + 2 * MIN, ingredients, { recipeTitle: KADAI.graph.title })
    expect(v.screenId).toBe('task')
    expect(v.label).toBe(model.nodes.cube_paneer.label)
    expect(v.primary?.action).toEqual({ kind: 'markDone', nodeId: 'cube_paneer' })
  })

  it('biryani: a timer whose consumer is done ends as a banner, never a takeover', () => {
    const BIRYANI = chickenBiryani as RecipePlanResponse
    const model = deriveCookingModel(BIRYANI)
    const ingredients = ingredientsById(BIRYANI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:biryani', T0))
    se = must(engine.startNode(se, model, 'soak_rice', T0))
    se = must(engine.markDone(se, model, 'parboil_rice', T0 + MIN))

    const v = buildCookingView(model, se, T0 + 30 * MIN, ingredients, { recipeTitle: BIRYANI.graph.title })
    expect(v.screenId).toBe('task')
    expect(v.strips).toMatchObject([{ kind: 'banner', nodeId: 'soak_rice', line: 'Timer ended 10 min ago' }])
  })

  it('maggi: a stopped timer is back on the hands-off screen with its timer start', () => {
    const MAGGI = maggi2min as RecipePlanResponse
    const model = deriveCookingModel(MAGGI)
    const ingredients = ingredientsById(MAGGI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))
    se = must(engine.stopNode(se, model, 'boil_water', T0 + MIN))

    const v = buildCookingView(model, se, T0 + MIN, ingredients, { recipeTitle: MAGGI.graph.title })
    expect(v.screenId).toBe('handsoff_pending')
    expect(v.primary).toEqual({ label: 'Start 3-min timer', solid: true, action: { kind: 'startNode', nodeId: 'boil_water' } })
    expect(v.step).toBe(`Step 1 of ${model.order.length}`)
  })

  it('every fixture, any state the random replay reaches: only the CP4 screens, never a removed one', () => {
    const allowed: ScreenId[] = ['task', 'handsoff_pending', 'step_running', 'step_done', 'wait', 'long_wait', 'sitting_break', 'stale', 'done']
    const KADAI = kadaiPaneer as RecipePlanResponse
    const model = deriveCookingModel(KADAI)
    const ingredients = ingredientsById(KADAI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:kadai', T0))
    let now = T0
    for (const id of model.order) {
      for (const at of [now, now + 30 * MIN]) {
        expect(allowed).toContain(buildCookingView(model, se, at, ingredients, { recipeTitle: 'k' }).screenId)
      }
      se = model.nodes[id].occupiesCook ? must(engine.markDone(se, model, id, now)) : must(engine.startNode(se, model, id, now))
      now += 5 * MIN
    }
  })
})

describe('CP1 — undo link after the new transitions, only inside UNDO_WINDOW_MS', () => {
  const T0 = 1_700_000_000_000

  it('after an out-of-order Done', () => {
    const KADAI = kadaiPaneer as RecipePlanResponse
    const model = deriveCookingModel(KADAI)
    const ingredients = ingredientsById(KADAI.graph.ingredients)
    const se = must(engine.markDone(must(engine.start(null, model, 'server:kadai', T0)), model, 'add_paneer', T0 + MIN))
    const view = (now: number) => buildCookingView(model, se, now, ingredients, { recipeTitle: KADAI.graph.title })

    // CP3: the page shows the suggestion (Chop onion), so the link names the step it undoes.
    const undoLink = { label: 'Undo Done on Add paneer', solid: false, action: { kind: 'undo' } }
    expect(view(T0 + MIN).secondary).toEqual(undoLink)
    expect(view(T0 + MIN + 9_999).secondary).toEqual(undoLink)
    expect(view(T0 + MIN + 10_000).secondary?.action.kind).not.toBe('undo')
  })

  it('after a no-timer Done', () => {
    const MAGGI = maggi2min as RecipePlanResponse
    const model = deriveCookingModel(MAGGI)
    const ingredients = ingredientsById(MAGGI.graph.ingredients)
    const se = must(engine.markDone(must(engine.start(null, model, 'server:maggi', T0)), model, 'boil_water', T0))
    const view = (now: number) => buildCookingView(model, se, now, ingredients, { recipeTitle: MAGGI.graph.title })

    expect(view(T0).secondary).toEqual({ label: 'Undo Done on Boil water', solid: false, action: { kind: 'undo' } })
    expect(view(T0 + 10_000).secondary?.action.kind).not.toBe('undo')
  })

  it('after an early finish: the done screen offers it, and undo brings the timers back', () => {
    const BIRYANI = chickenBiryani as RecipePlanResponse
    const model = deriveCookingModel(BIRYANI)
    const ingredients = ingredientsById(BIRYANI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:biryani', T0))
    se = must(engine.startNode(se, model, 'soak_rice', T0))
    const timer = se.nodes.soak_rice
    se = must(engine.markDone(se, model, 'rest_and_serve', T0 + MIN))
    const view = (s: CookingSession, now: number) => buildCookingView(model, s, now, ingredients, { recipeTitle: BIRYANI.graph.title })

    expect(view(se, T0 + MIN).screenId).toBe('done')
    expect(view(se, T0 + MIN).secondary).toEqual({ label: 'Undo', solid: false, action: { kind: 'undo' } })
    expect(view(se, T0 + MIN + 10_000).secondary).toBeNull()

    const undone = must(engine.undo(se, model, T0 + MIN + 5_000))
    expect(undone.nodes.soak_rice).toEqual(timer)
    expect(view(undone, T0 + MIN + 5_000).screenId).not.toBe('done')
  })

  it('after an early finish by acknowledging the finish step: same done screen, same undo', () => {
    const PIZZA = pizzaDough as RecipePlanResponse
    const model = deriveCookingModel(PIZZA)
    const ingredients = ingredientsById(PIZZA.graph.ingredients)
    const sink = 'step_transfer_the_pizza_to_a_cutting'
    let se = must(engine.start(null, model, 'server:pizza', T0))
    se = must(engine.startNode(se, model, 'step_cover_and_refrigerate_overnight_18_hours', T0))
    const timer = se.nodes.step_cover_and_refrigerate_overnight_18_hours
    se = must(engine.startNode(se, model, sink, T0))
    const at = T0 + model.nodes[sink].durationTypical * MIN
    se = must(engine.acknowledge(se, model, at))
    const view = (s: CookingSession, now: number) => buildCookingView(model, s, now, ingredients, { recipeTitle: PIZZA.graph.title })

    expect(se.nodes.step_cover_and_refrigerate_overnight_18_hours).toEqual({ state: 'pending' })
    expect(view(se, at).screenId).toBe('done')
    expect(view(se, at).secondary).toEqual({ label: 'Undo', solid: false, action: { kind: 'undo' } })
    expect(view(se, at + 10_000).secondary).toBeNull()

    const undone = must(engine.undo(se, model, at + 5_000))
    expect(undone.nodes.step_cover_and_refrigerate_overnight_18_hours).toEqual(timer)
    expect(view(undone, at + 5_000).screenId).not.toBe('done')
  })

  it('after stopNode', () => {
    const MAGGI = maggi2min as RecipePlanResponse
    const model = deriveCookingModel(MAGGI)
    const ingredients = ingredientsById(MAGGI.graph.ingredients)
    let se = must(engine.start(null, model, 'server:maggi', T0))
    se = must(engine.startNode(se, model, 'boil_water', T0))
    const timer = se.nodes.boil_water
    se = must(engine.stopNode(se, model, 'boil_water', T0 + MIN))
    const view = (now: number) => buildCookingView(model, se, now, ingredients, { recipeTitle: MAGGI.graph.title })

    expect(view(T0 + MIN).secondary?.action).toEqual({ kind: 'undo' })
    expect(view(T0 + MIN + 10_000).secondary).toBeNull()
    expect(must(engine.undo(se, model, T0 + MIN)).nodes.boil_water).toEqual(timer)
  })
})

// ---------------------------------------------------------------------------
// PR 2 CP3 — step screens: rail, hands-off, cue, You'll need, bolding, no Skip, Undo label
// ---------------------------------------------------------------------------

describe('PR 2 CP3 step screens', () => {
  const T0 = 1_700_000_000_000
  const ALL_FIXTURES = {
    ...import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }),
    ...import.meta.glob('../__fixtures__/fgc58/*.plan-response.json', { eager: true, import: 'default' }),
  } as Record<string, RecipePlanResponse>

  function fixture(raw: unknown) {
    const payload = raw as RecipePlanResponse
    const model = deriveCookingModel(payload)
    const ingredients = ingredientsById(payload.graph.ingredients)
    const view = (se: CookingSession, now: number, choice: ServingsChoice | null = null) =>
      buildCookingView(model, se, now, ingredients, { recipeTitle: payload.graph.title, choice })
    const fresh = () => must(engine.start(null, model, `server:${model.graphId}`, T0))
    const done = (se: CookingSession, ids: string[], now: number) =>
      ids.reduce((s, id) => must(engine.markDone(s, model, id, now)), se)
    return { payload, model, ingredients, view, fresh, done }
  }
  const DONUTS = fixture(homemadeDonuts)
  const KADAI = fixture(kadaiPaneer)
  const KADHI = fixture(kadhiPakora)
  const FIRST_THREE = ['bloom_yeast', 'mix_dough', 'knead_dough']

  describe('timer rail', () => {
    it('a step page while a timer runs: one rail', () => {
      let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)
      se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0))
      const v = DONUTS.view(se, T0 + 8 * MIN)
      expect(v.screenId).toBe('task')
      expect(v.strips).toEqual([
        { kind: 'timer', nodeId: 'first_rise', name: 'First rise', left: '52 min left', aria: 'First rise, 52 min left. Open timer' },
      ])
    })

    it('a periodic timer gets a rail too (Kadai base)', () => {
      let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
      const v = KADAI.view(se, T0 + MIN)
      expect(v.strips.map((r) => r.kind === 'timer' && r.nodeId)).toEqual(['cook_tomato_base'])
    })

    it('no timer, no rail; the waiting screen leaves its own timer off', () => {
      expect(DONUTS.view(DONUTS.fresh(), T0).strips).toEqual([])
      let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
      se = KADAI.done(se, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
      const wait = KADAI.view(se, T0 + 2 * MIN)
      expect(wait.screenId).toBe('wait')
      expect(wait.strips).toEqual([])
    })
  })

  describe('hands-off step', () => {
    const pending = () => DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)

    it('tag, "About 1 hr" line, "Start 1-hr timer" primary and a quiet Mark as done', () => {
      const v = DONUTS.view(pending(), T0 + MIN)
      expect(v.screenId).toBe('handsoff_pending')
      expect(v.handsOff).toEqual({
        tag: 'Hands-off',
        line: 'About 1 hr. Start a timer, or just move on.',
        markDone: { label: 'Mark as done', solid: false, action: { kind: 'markDone', nodeId: 'first_rise' } },
      })
      expect(v.primary).toEqual({ label: 'Start 1-hr timer', solid: true, action: { kind: 'startNode', nodeId: 'first_rise' } })
    })

    it('viewed: the start still moves the cook on (clearView)', () => {
      const se = must(engine.view(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(se, T0).primary?.action).toEqual({ kind: 'startNode', nodeId: 'first_rise', clearView: true })
    })

    it('low attention: "Low attention" tag and "Check on it now and then." (CP3.1; Kadai base, 12 min)', () => {
      const se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      const v = KADAI.view(se, T0)
      expect(v.handsOff).toEqual({
        tag: 'Low attention',
        line: 'About 12 min. Check on it now and then.',
        markDone: { label: 'Mark as done', solid: false, action: { kind: 'markDone', nodeId: 'cook_tomato_base' } },
      })
      expect(v.primary?.label).toBe('Start 12-min timer')
    })

    it('every Low attention step says "Check on it", every Hands-off step "just move on" (both tags, every fixture)', () => {
      const seen = new Set<string>()
      for (const payload of Object.values(ALL_FIXTURES)) {
        const f = fixture(payload)
        for (const id of f.model.order) {
          const info = f.model.nodes[id]
          if (info.occupiesCook || timerLength(info.durationTypical) == null) continue
          const h = f.view(must(engine.view(f.fresh(), f.model, id, T0)), T0).handsOff!
          seen.add(h.tag)
          expect(h.line, `${f.model.graphId} ${id}`).toMatch(
            h.tag === 'Low attention' ? /\. Check on it now and then\.$/ : /\. Start a timer, or just move on\.$/,
          )
        }
      }
      expect(seen).toEqual(new Set(['Hands-off', 'Low attention']))
    })

    it('every hands-off node in every fixture: "Start ‹len› timer" from its duration, "I\'ve started it" only without one', () => {
      let checked = 0
      for (const [path, payload] of Object.entries(ALL_FIXTURES)) {
        const f = fixture(payload)
        for (const id of f.model.order) {
          const info = f.model.nodes[id]
          if (info.occupiesCook) continue
          const se = must(engine.view(f.fresh(), f.model, id, T0))
          const v = f.view(se, T0)
          expect(v.screenId, `${path} ${id}`).toBe('handsoff_pending')
          const len = timerLength(info.durationTypical)
          expect(v.primary?.label, `${path} ${id}`).toBe(len == null ? "I've started it" : `Start ${len} timer`)
          expect(v.handsOff?.line ?? null, `${path} ${id}`).toBe(handsOffLine(info.durationTypical, info.attention))
          checked++
        }
      }
      expect(checked).toBeGreaterThan(20)
    })

    it('a step without a duration: "I\'ve started it", the tag and no line', () => {
      const model = { ...DONUTS.model, nodes: { ...DONUTS.model.nodes, first_rise: { ...DONUTS.model.nodes.first_rise, durationTypical: 0.4 } } }
      const v = buildCookingView(model, pending(), T0, DONUTS.ingredients, { recipeTitle: 'Donuts' })
      expect(v.primary).toEqual({ label: "I've started it", solid: true, action: { kind: 'startNode', nodeId: 'first_rise' } })
      expect(v.handsOff).toMatchObject({ tag: 'Hands-off', line: null })
    })

    it('no hands-off block on a hands-on step, a running step or a done step', () => {
      let se = pending()
      expect(DONUTS.view(DONUTS.fresh(), T0).handsOff).toBeNull()
      se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0))
      se = must(engine.view(se, DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(se, T0).screenId).toBe('step_running')
      expect(DONUTS.view(se, T0).handsOff).toBeNull()
      se = must(engine.view(se, DONUTS.model, 'bloom_yeast', T0))
      expect(DONUTS.view(se, T0).handsOff).toBeNull()
    })

    it('Mark as done is never forced: Up next still moves on without a timer', () => {
      const v = DONUTS.view(pending(), T0)
      expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'grease_pan' })
    })
  })

  describe('cue', () => {
    it('shown as stored when the text does not say it (Donuts first rise), on the pending, waiting and suggested pages', () => {
      let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)
      expect(DONUTS.view(se, T0).cue).toBe('doubled in bulk, holds a dimple when poked')
      se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0))
      se = must(engine.view(se, DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(se, T0).screenId).toBe('step_running')
      expect(DONUTS.view(se, T0).cue).toBe('doubled in bulk, holds a dimple when poked')
      expect(DONUTS.view(DONUTS.fresh(), T0).cue).toBe('a thick foamy head on the milk')
    })

    it('not on a done step; not when the step text already says it; never in note', () => {
      let se = DONUTS.done(DONUTS.fresh(), ['bloom_yeast'], T0)
      se = must(engine.view(se, DONUTS.model, 'bloom_yeast', T0))
      expect(DONUTS.view(se, T0).screenId).toBe('step_done')
      expect(DONUTS.view(se, T0).cue).toBeNull()
      const k = must(engine.view(KADHI.fresh(), KADHI.model, 'step_heat_the_oil_hotter_and_fry', T0))
      expect(KADHI.model.nodes.step_heat_the_oil_hotter_and_fry.donenessCue).toBe('light brown on the outside')
      expect(KADHI.view(k, T0).cue).toBeNull()
      expect(DONUTS.view(DONUTS.fresh(), T0).note).toBeNull()
    })

    it('a non-Latin cue is hidden, as on the recipe page (displayCue)', () => {
      const model = { ...DONUTS.model, nodes: { ...DONUTS.model.nodes, bloom_yeast: { ...DONUTS.model.nodes.bloom_yeast, donenessCue: 'हल्का झाग' } } }
      const v = buildCookingView(model, DONUTS.fresh(), T0, DONUTS.ingredients, { recipeTitle: 'Donuts' })
      expect(v.cue).toBeNull()
    })

    it('never ends in a doubled full stop (shown as stored, nothing appended)', () => {
      for (const payload of Object.values(ALL_FIXTURES)) {
        const f = fixture(payload)
        for (const id of f.model.order) {
          const cue = f.view(must(engine.view(f.fresh(), f.model, id, T0)), T0).cue
          if (cue != null) expect(cue).not.toMatch(/\.\.$/)
        }
      }
    })
  })

  describe("You'll need, bolding", () => {
    it('one row per ingredient, name as written and amount (Kadhi step 1: eleven rows)', () => {
      const v = KADHI.view(KADHI.fresh(), T0)
      expect(v.need).toHaveLength(11)
      expect(v.need[0]).toEqual({ name: 'Curd', amount: '1 ½ cups', unscaled: false })
      expect(v.need.find((r) => r.name === 'Salt')).toEqual({ name: 'Salt', amount: 'to taste', unscaled: false })
    })

    it('scaled to the session\'s servings; an unscaled amount carries the R4 accessible label', () => {
      const choice: ServingsChoice = { mode: 'servings', chosen: 8, original: 4 }
      const v = KADHI.view(KADHI.fresh(), T0, choice)
      expect(v.need[0]).toEqual({ name: 'Curd', amount: '3 cups', unscaled: false })
      const model = KADHI.model
      const ing = new Map(KADHI.ingredients)
      ing.set('ing_curd', { ...ing.get('ing_curd')!, qty_amount: null, qty_text: '1 (400 g) tub', unit: null })
      const w = buildCookingView(model, KADHI.fresh(), T0, ing, { recipeTitle: 'Kadhi', choice })
      expect(w.need[0]).toEqual({ name: 'Curd', amount: '1 (400 g) tub', unscaled: true, label: 'Curd, 1 (400 g) tub — amount for 4 servings' })
    })

    it('consumed + factor feed EmphasisText: the node\'s ing_* ingredients, as the recipe page passes them', () => {
      const v = KADAI.view(must(engine.markDone(KADAI.fresh(), KADAI.model, 'chop_onion', T0)), T0)
      const expected = KADAI.model.nodes.chop_tomato.consumes
        .filter((id) => id.startsWith('ing_'))
        .map((id) => KADAI.ingredients.get(id)!)
      expect(v.consumed).toEqual(
        expected.map((i) => ({ name: i.name, qty: i.qty, qty_text: i.qty_text, qty_amount: i.qty_amount, unit: i.unit })),
      )
      expect(v.consumed.length).toBeGreaterThan(0)
      expect(v.factor).toBe(1)
    })

    it('the waiting screen: no rows, nothing consumed (its step is named, not described)', () => {
      let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
      se = KADAI.done(se, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
      const wait = KADAI.view(se, T0 + 2 * MIN)
      expect([wait.need, wait.consumed, wait.nodeId]).toEqual([[], [], 'cook_tomato_base'])
    })
  })

  describe('Skip is gone; Undo never moves the primary', () => {
    it('the suggested hands-on step offers no Skip, even when skipping would be allowed', () => {
      const v = KADAI.view(must(engine.markDone(KADAI.fresh(), KADAI.model, 'chop_onion', T0)), T0 + MIN)
      expect(v.screenId).toBe('task')
      expect(v.secondary).toBeNull()
    })

    it('the waiting screen\'s only secondary is Undo (no "Give it longer", no reserved slot)', () => {
      let w = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      w = must(engine.startNode(w, KADAI.model, 'cook_tomato_base', T0))
      w = KADAI.done(w, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
      expect(KADAI.view(w, T0 + MIN).secondary?.action).toEqual({ kind: 'undo' })
      expect(KADAI.view(w, T0 + 2 * MIN).secondary).toBeNull()
      expect('reserveSecondary' in KADAI.view(w, T0 + 2 * MIN)).toBe(false)
    })

    it('nodeId names the step on the page', () => {
      expect(DONUTS.view(DONUTS.fresh(), T0).nodeId).toBe('bloom_yeast')
    })
  })

  describe('Undo label (owner answer 2)', () => {
    const undo = (label: string) => ({ label, solid: false, action: { kind: 'undo' } })

    it('Done: "Undo" on the acted-on step, "Undo Done on ‹label›" anywhere else', () => {
      let se = must(engine.view(DONUTS.fresh(), DONUTS.model, 'bloom_yeast', T0))
      se = must(engine.markDone(se, DONUTS.model, 'bloom_yeast', T0))
      // Done moved the view on, so the page now shows the suggestion.
      expect(DONUTS.view(se, T0).nodeId).toBe('mix_dough')
      expect(DONUTS.view(se, T0).secondary).toEqual(undo('Undo Done on Bloom yeast'))
      const back = must(engine.view(se, DONUTS.model, 'bloom_yeast', T0))
      expect(DONUTS.view(back, T0).secondary).toEqual(undo('Undo'))
    })

    it('timer start and stop name their kind; on its own waiting screen just "Undo"', () => {
      let se = must(engine.startNode(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(se, T0).secondary).toEqual(undo('Undo timer start on First rise'))
      const waiting = must(engine.view(se, DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(waiting, T0).screenId).toBe('step_running')
      expect(DONUTS.view(waiting, T0).secondary).toEqual(undo('Undo'))
      se = must(engine.stopNode(se, DONUTS.model, 'first_rise', T0 + MIN))
      expect(DONUTS.view(se, T0 + MIN).secondary).toEqual(undo('Undo timer stop on First rise'))
      se = must(engine.view(se, DONUTS.model, 'first_rise', T0 + MIN))
      expect(DONUTS.view(se, T0 + MIN).secondary).toEqual(undo('Undo'))
    })

    it('acknowledge reads as Done on its first producer', () => {
      let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
      se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
      se = KADAI.done(se, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
      se = must(engine.acknowledge(se, KADAI.model, T0 + 13 * MIN))
      const v = KADAI.view(se, T0 + 13 * MIN)
      expect(v.nodeId).not.toBe('cook_tomato_base')
      expect(v.secondary).toEqual(undo('Undo Done on Cook tomato base'))
    })

    it('Undo works from any step page: act on A, view B, Undo on B restores A and the view', () => {
      let se = must(engine.view(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
      const before = se
      se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0))
      se = must(engine.view(se, DONUTS.model, 'make_glaze', T0 + 1_000))
      const v = DONUTS.view(se, T0 + 2_000)
      expect(v.nodeId).toBe('make_glaze')
      expect(v.secondary).toEqual(undo('Undo timer start on First rise'))
      const undone = must(engine.undo(se, DONUTS.model, T0 + 2_000))
      expect(undone.nodes).toEqual(before.nodes)
      expect(undone.viewing).toBe('first_rise')
    })

    it('gone after the 10 s window, as before', () => {
      const se = must(engine.startNode(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
      expect(DONUTS.view(se, T0 + 10_000).secondary).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// PR 2 CP4 — the done screen's line, picture and Back
// ---------------------------------------------------------------------------

describe('PR 2 CP4 done screen', () => {
  const T0 = 1_700_000_000_000
  const KADAI = kadaiPaneer as RecipePlanResponse
  const MAGGI = maggi2min as RecipePlanResponse
  const model = deriveCookingModel(KADAI)
  const ingredients = ingredientsById(KADAI.graph.ingredients)
  const view = (se: CookingSession, now: number, reviewing = false) =>
    buildCookingView(model, se, now, ingredients, { recipeTitle: KADAI.graph.title, reviewing })
  const allDone = (finishAt: number) =>
    model.order.reduce((s, id) => must(engine.markDone(s, model, id, id === 'finish' ? finishAt : T0)), must(engine.start(null, model, 'k', T0)))

  it('every step done: "All N steps, in …" (measured, finishedAt − startedAt)', () => {
    expect(doneLine(model, allDone(T0 + 82 * MIN))).toBe('All 10 steps, in 1 hr 22 min.')
  })

  it('finished early or with steps never marked done: "Done in …", no count, no order', () => {
    const early = must(engine.markDone(must(engine.start(null, model, 'k', T0)), model, 'finish', T0 + 82 * MIN))
    expect(doneLine(model, early)).toBe('Done in 1 hr 22 min.')
  })

  it('under a minute: "in under a minute"', () => {
    expect(doneLine(model, allDone(T0 + 30_000))).toBe('All 10 steps, in under a minute.')
    const early = must(engine.markDone(must(engine.start(null, model, 'k', T0)), model, 'finish', T0 + 30_000))
    expect(doneLine(model, early)).toBe('Done in under a minute.')
  })

  it('a one-step recipe: "1 step, in …"', () => {
    const one = { ...model, order: ['finish'] }
    const se = must(engine.markDone(must(engine.start(null, model, 'k', T0)), model, 'finish', T0 + 12 * MIN))
    expect(doneLine(one, se)).toBe('1 step, in 12 min.')
  })

  it('the picture: the recipe\'s YouTube thumbnail only; anything else has none', () => {
    expect(recipeThumbnail({ ...KADAI.graph.source, kind: 'url', value: 'https://www.youtube.com/watch?v=abc123DEF45' })).toBe(
      'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg',
    )
    expect(recipeThumbnail(KADAI.graph.source)).toBeNull()
    expect(recipeThumbnail(MAGGI.graph.source)).toBeNull()
    expect(view(allDone(T0 + MIN), T0 + MIN).done?.thumbnail).toBeNull()
    const withPicture = buildCookingView(model, allDone(T0 + MIN), T0 + MIN, ingredients, { recipeTitle: 'K', thumbnail: 'https://i.ytimg.com/vi/x/hqdefault.jpg' })
    expect(withPicture.done?.thumbnail).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg')
  })

  it('Back (review) shows the last step: "Finished cooking" its primary; no Up next, Mark as done or strips', () => {
    let se = allDone(T0 + 34 * MIN)
    se = must(engine.view(se, model, 'finish', T0 + 34 * MIN))
    const v = view(se, T0 + 34 * MIN, true)
    expect(v.screenId).toBe('step_done')
    expect(v.label).toBe('Finish')
    expect(v.primary).toEqual({ label: 'Finished cooking', solid: true, action: { kind: 'finish' } })
    expect([v.upNext, v.handsOff, v.strips]).toEqual([null, null, []])
    expect(v.back?.action).toEqual({ kind: 'view', nodeId: 'add_paneer' })
    // Back and All steps still move between steps.
    const earlier = view(must(engine.view(se, model, 'add_paneer', T0 + 35 * MIN)), T0 + 35 * MIN, true)
    expect(earlier.label).toBe('Add paneer')
    expect(earlier.primary?.action).toEqual({ kind: 'finish' })
  })

  it('without reviewing (a reload, or finishing from a banner on another step), finished is the done screen', () => {
    let se = allDone(T0 + 34 * MIN)
    se = must(engine.view(se, model, 'chop_onion', T0 + 34 * MIN))
    expect(view(se, T0 + 34 * MIN).screenId).toBe('done')
  })

  it('reviewing a session that is not finished changes nothing', () => {
    const se = must(engine.start(null, model, 'k', T0))
    expect(view(se, T0, true).screenId).toBe('task')
    expect(view(se, T0, true).primary?.label).toBe('Done')
  })
})

// ---------------------------------------------------------------------------
// PR 2 CP4 — the waiting screen: when it shows
// ---------------------------------------------------------------------------

describe('PR 2 CP4 waiting screen: when it shows', () => {
  const T0 = 1_700_000_000_000
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const model = deriveCookingModel(DONUTS)
  const ingredients = ingredientsById(DONUTS.graph.ingredients)
  const view = (se: CookingSession, now: number) => buildCookingView(model, se, now, ingredients, { recipeTitle: DONUTS.graph.title })

  it('(a) the viewed step\'s timer is running (Up next, Back, All steps or the timer sheet\'s Go to)', () => {
    let se = must(engine.start(null, model, 'd', T0))
    se = must(engine.startNode(se, model, 'first_rise', T0))
    se = must(engine.startNode(se, model, 'heat_oil', T0))
    se = must(engine.view(se, model, 'first_rise', T0 + 8 * MIN))
    const v = view(se, T0 + 8 * MIN)
    expect(v.screenId).toBe('step_running')
    expect(v.layout).toBe('waiting')
    expect(v.label).toBe('First rise')
    expect(v.waiting).toMatchObject({ big: '52', unit: 'min left' })
    // Its own rail hides; the other timer keeps its rail.
    expect(stripTexts(v)).toEqual(['Heat oil: 4 min left'])
    expect(v.waiting?.meanwhile).toMatchObject([{ nodeId: 'grease_pan', state: 'todo', right: null, action: { kind: 'view', nodeId: 'grease_pan' } }])
  })

  it('(b) a step still to do wins over a running timer; with nothing left, the waiting screen', () => {
    let se = must(engine.start(null, model, 'd', T0))
    se = must(engine.startNode(se, model, 'first_rise', T0))
    expect(view(se, T0).screenId).toBe('task')
    for (const id of ['bloom_yeast', 'mix_dough', 'knead_dough', 'grease_pan', 'make_glaze']) se = must(engine.markDone(se, model, id, T0))
    const v = view(se, T0 + 5 * MIN)
    expect(v.layout).toBe('waiting')
    expect(v.nodeId).toBe('first_rise')
  })
})
