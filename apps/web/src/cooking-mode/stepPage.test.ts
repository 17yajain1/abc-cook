import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { ingredientsById } from './quantity'
import { endCookFoot, meanwhileRows, pageOrder, stepList, waitingNext } from './stepPage'
import { buildCookingView, type CookingView } from './viewModel'
import { shouldHoldWakeLock } from './wakeLock'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingModel, CookingSession, Rejected } from '@/cooking/types'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'

/**
 * PR 2 CP2: the step page's view-model pieces (Up next, ticks, "Step N of M", Back, the
 * viewed step's screen and primary, the Undo label). Driven through the real engine on
 * fixtures; every `now` is a literal.
 */

const T0 = 1_700_000_000_000
const MIN = 60_000

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

function fixture(raw: unknown) {
  const payload = raw as RecipePlanResponse
  const model: CookingModel = deriveCookingModel(payload)
  const ingredients = ingredientsById(payload.graph.ingredients)
  const pageNumbers = stepNumbers(derivePlan(payload).stages)
  const view = (se: CookingSession, now: number, withNumbers = true): CookingView =>
    buildCookingView(model, se, now, ingredients, {
      recipeTitle: payload.graph.title,
      ...(withNumbers ? { pageNumbers } : {}),
    })
  const fresh = () => must(engine.start(null, model, `server:${model.graphId}`, T0))
  const done = (se: CookingSession, ids: string[], now: number) =>
    ids.reduce((s, id) => must(engine.markDone(s, model, id, now)), se)
  return { payload, model, view, fresh, done, pageNumbers }
}

const DONUTS = fixture(homemadeDonuts)
const KADAI = fixture(kadaiPaneer)
const BIRYANI = fixture(chickenBiryani)
const MAGGI = fixture(maggi2min)

const FIRST_THREE = ['bloom_yeast', 'mix_dough', 'knead_dough']

describe('Up next', () => {
  it('normal: a hands-on step shows what its Done leads to (Donuts step 1 -> mix_dough)', () => {
    const v = DONUTS.view(DONUTS.fresh(), T0)
    expect(v.screenId).toBe('task')
    expect(v.upNext).toEqual({
      label: 'Up next',
      stepRef: 'Step 2',
      name: DONUTS.model.nodes.mix_dough.label,
      tag: null,
      text: DONUTS.model.nodes.mix_dough.instruction,
      action: { kind: 'view', nodeId: 'mix_dough' },
    })
  })

  it('hands-off pending: "Meanwhile" and the first not-done task of its window', () => {
    const se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0 + MIN)
    const v = DONUTS.view(se, T0 + 2 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(v.label).toBe(DONUTS.model.nodes.first_rise.label)
    expect(v.upNext?.label).toBe('Meanwhile')
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'grease_pan' })
    expect(v.upNext?.stepRef).toBe('Step 5')
  })

  it('hands-off running and viewed (CP4 waiting screen): "When it\'s done" and its first not-done consumer; the window task moves to Meanwhile', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0 + MIN)
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    se = must(engine.view(se, DONUTS.model, 'first_rise', T0 + 3 * MIN))
    const v = DONUTS.view(se, T0 + 3 * MIN)
    expect(v.screenId).toBe('step_running')
    expect(v.upNext?.label).toBe("When it's done")
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'shape_and_cut' })
    expect(v.waiting?.meanwhile.map((r) => r.nodeId)).toEqual(['grease_pan'])
  })

  it('window task already done: pending uses the normal rule; running still names the consumer', () => {
    const se = DONUTS.done(DONUTS.fresh(), [...FIRST_THREE, 'grease_pan'], T0 + MIN)
    const pending = DONUTS.view(se, T0 + 2 * MIN)
    expect(pending.screenId).toBe('handsoff_pending')
    expect(pending.upNext?.label).toBe('Up next')
    expect(pending.upNext?.action).toEqual({ kind: 'view', nodeId: 'make_glaze' }) // simulated startNode

    let running = must(engine.startNode(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    running = must(engine.view(running, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    const v = DONUTS.view(running, T0 + 2 * MIN)
    expect(v.upNext?.label).toBe("When it's done")
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'shape_and_cut' })
  })

  it('viewed step is not the suggestion: the same simulation on the viewed step', () => {
    const se = must(engine.view(KADAI.fresh(), KADAI.model, 'add_paneer', T0))
    const v = KADAI.view(se, T0)
    expect(v.label).toBe(KADAI.model.nodes.add_paneer.label)
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'chop_onion' })
    expect(v.upNext?.label).toBe('Up next')
  })

  it('done step: the suggestion', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion'], T0)
    se = must(engine.view(se, KADAI.model, 'chop_onion', T0 + MIN))
    const v = KADAI.view(se, T0 + MIN)
    expect(v.screenId).toBe('step_done')
    expect(v.upNext?.label).toBe('Up next')
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'chop_tomato' })
  })

  it('the last step (the sink) has no Up next', () => {
    const se = must(engine.view(KADAI.fresh(), KADAI.model, 'finish', T0))
    expect(KADAI.view(se, T0).upNext).toBeNull()
  })

  it('is never the viewed step, on any step of any of these fixtures', () => {
    for (const f of [DONUTS, KADAI, BIRYANI, MAGGI]) {
      for (const id of f.model.order) {
        const se = must(engine.view(f.fresh(), f.model, id, T0))
        const v = f.view(se, T0)
        expect(v.upNext?.action.nodeId ?? null, `${f.model.graphId} ${id}`).not.toBe(id)
      }
    }
  })

  it('carries the attention tag as a chip ("Hands-off" for an unattended step)', () => {
    const se = DONUTS.done(DONUTS.fresh(), ['bloom_yeast', 'mix_dough'], T0)
    const v = DONUTS.view(se, T0)
    expect(v.label).toBe(DONUTS.model.nodes.knead_dough.label)
    expect(v.upNext?.action).toEqual({ kind: 'view', nodeId: 'first_rise' })
    expect(v.upNext?.tag).toBe('Hands-off')
  })
})

describe('ticks', () => {
  it('one per page step, in page order, done/running/viewed/to-do', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0 + MIN)
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    const v = DONUTS.view(se, T0 + 2 * MIN)
    expect(v.label).toBe(DONUTS.model.nodes.grease_pan.label)
    expect(v.ticks?.map((t) => t.state)).toEqual([
      'done', 'done', 'done', 'running', 'viewed', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo',
    ])
    expect(v.ticks).toHaveLength(DONUTS.pageNumbers.size)
  })

  it('follow page order, not execution order (Biryani)', () => {
    const v = BIRYANI.view(BIRYANI.fresh(), T0)
    const byPage = [...BIRYANI.pageNumbers.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
    expect(v.ticks?.map((t) => t.nodeId)).toEqual(byPage)
    expect(byPage[3]).not.toBe(BIRYANI.model.order[3])
  })

  it('viewed wins over running', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0 + MIN)
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    se = must(engine.view(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    expect(DONUTS.view(se, T0 + 2 * MIN).ticks?.[3]).toEqual({ nodeId: 'first_rise', state: 'viewed' })
  })

  it('CP4: the waiting screen has them too, with Back and "When it\'s done", as a step page does', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
    se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
    se = KADAI.done(se, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
    const v = KADAI.view(se, T0 + 2 * MIN)
    expect(v.screenId).toBe('wait')
    expect(v.ticks?.find((t) => t.state === 'viewed')?.nodeId).toBe('cook_tomato_base')
    expect(v.back?.action.kind).toBe('view')
    expect(v.upNext?.label).toBe("When it's done")
  })

  it('are absent off the step and waiting screens (done)', () => {
    const se = must(engine.markDone(KADAI.fresh(), KADAI.model, 'finish', T0))
    const v = KADAI.view(se, T0)
    expect(v.screenId).toBe('done')
    expect(v.ticks).toBeNull()
    expect(v.upNext).toBeNull()
  })
})

describe('Step N of M', () => {
  it('is the recipe-page number, not the live count (Biryani: page 7 in execution slot 4)', () => {
    expect(BIRYANI.model.order[3]).toBe('fry_birista')
    expect(BIRYANI.pageNumbers.get('fry_birista')).toBe(7)
    const se = must(engine.view(BIRYANI.fresh(), BIRYANI.model, 'fry_birista', T0))
    expect(BIRYANI.view(se, T0).step).toBe('Step 7 of 14')
  })

  it('numbers the suggested step by page too', () => {
    // Done the first two page steps' worth so the current step is several slots in.
    const se = BIRYANI.done(BIRYANI.fresh(), ['boil_spiced_water', 'soak_rice', 'slice_onions', 'chop_mint_coriander'], T0)
    const v = BIRYANI.view(se, T0)
    const id = v.ticks!.find((t) => t.state === 'viewed')!.nodeId
    expect(v.step).toBe(`Step ${BIRYANI.pageNumbers.get(id)} of 14`)
  })

  it('falls back to the execution order without page numbers', () => {
    const se = must(engine.view(BIRYANI.fresh(), BIRYANI.model, 'fry_birista', T0))
    expect(BIRYANI.view(se, T0, false).step).toBe('Step 4 of 14')
  })
})

describe('Back', () => {
  it('is absent on page step 1', () => {
    expect(DONUTS.view(DONUTS.fresh(), T0).back).toBeNull()
  })

  it('targets page step N-1', () => {
    const se = must(engine.view(BIRYANI.fresh(), BIRYANI.model, 'fry_birista', T0))
    const v = BIRYANI.view(se, T0)
    expect(v.back).toEqual({ label: 'Back', solid: false, action: { kind: 'view', nodeId: 'soak_saffron' } })
    expect(BIRYANI.pageNumbers.get('soak_saffron')).toBe(6)
  })
})

describe('Up next and Back are navigation only', () => {
  it('applied through the real engine they change only viewing', () => {
    let se = DONUTS.done(DONUTS.fresh(), ['bloom_yeast'], T0)
    se = must(engine.view(se, DONUTS.model, 'knead_dough', T0))
    const v = DONUTS.view(se, T0 + MIN)
    for (const action of [v.upNext!.action, v.back!.action]) {
      if (action.kind !== 'view') throw new Error(`not a view: ${action.kind}`)
      const after = must(engine.view(se, DONUTS.model, action.nodeId, T0 + MIN))
      expect(after.nodes).toEqual(se.nodes)
      expect(after.lastTransition).toEqual(se.lastTransition)
      expect(after.finishedAt).toBe(se.finishedAt)
      expect(after.viewing).toBe(action.nodeId)
    }
  })
})

describe('the viewed step', () => {
  it('hands-on: Done on the viewed step', () => {
    const se = must(engine.view(KADAI.fresh(), KADAI.model, 'saute_onion', T0))
    const v = KADAI.view(se, T0)
    expect(v.screenId).toBe('task')
    expect(v.primary).toEqual({ label: 'Done', solid: true, action: { kind: 'markDone', nodeId: 'saute_onion' } })
    // Skip is the suggestion's control only.
    expect(v.secondary).toBeNull()
  })

  it('hands-off pending: start the viewed step, then clear the view', () => {
    const se = must(engine.view(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
    const v = DONUTS.view(se, T0)
    expect(v.screenId).toBe('handsoff_pending')
    // CP3: the timer start is named from the duration (FGC-37), on the terracotta pill.
    expect(v.primary).toEqual({
      label: 'Start 1-hr timer',
      solid: true,
      action: { kind: 'startNode', nodeId: 'first_rise', clearView: true },
    })
  })

  it('hands-off pending without a view: no clearView', () => {
    const se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)
    expect(DONUTS.view(se, T0).primary?.action).toEqual({ kind: 'startNode', nodeId: 'first_rise' })
  })

  it('running: "It\'s done" on the viewed step', () => {
    let se = must(engine.startNode(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
    se = must(engine.view(se, DONUTS.model, 'first_rise', T0))
    const v = DONUTS.view(se, T0 + 20_000)
    expect(v.screenId).toBe('step_running')
    expect(v.label).toBe(DONUTS.model.nodes.first_rise.label)
    expect(v.primary).toEqual({ label: "It's done", solid: true, action: { kind: 'markDone', nodeId: 'first_rise' } })
  })

  it('done: a quiet "Done." line and no primary', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion'], T0)
    se = must(engine.view(se, KADAI.model, 'chop_onion', T0 + MIN))
    const v = KADAI.view(se, T0 + MIN)
    expect(v.screenId).toBe('step_done')
    expect(v.stateLine).toBe('Done.')
    expect(v.primary).toBeNull()
  })

  it('wins over a wait screen', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
    se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
    se = KADAI.done(se, ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'], T0 + MIN)
    expect(KADAI.view(se, T0 + 2 * MIN).screenId).toBe('wait')
    se = must(engine.view(se, KADAI.model, 'add_paneer', T0 + 2 * MIN))
    const v = KADAI.view(se, T0 + 2 * MIN)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe(KADAI.model.nodes.add_paneer.label)
  })

  it('a timer end no longer takes over (CP4: a banner); finished beats a view', () => {
    let se = must(engine.startNode(MAGGI.fresh(), MAGGI.model, 'boil_water', T0))
    se = must(engine.view(se, MAGGI.model, 'add_noodles_masala', T0))
    const ended = MAGGI.view(se, T0 + 30 * MIN)
    expect(ended.screenId).toBe('task')
    expect(ended.nodeId).toBe('add_noodles_masala')
    expect(ended.strips.map((s) => s.kind)).toEqual(['banner'])

    let fin = must(engine.view(KADAI.fresh(), KADAI.model, 'chop_onion', T0))
    fin = must(engine.markDone(fin, KADAI.model, 'finish', T0))
    fin = must(engine.view(fin, KADAI.model, 'chop_onion', T0))
    expect(KADAI.view(fin, T0).screenId).toBe('done')
  })

  it('no view: today\'s screens', () => {
    const se = KADAI.fresh()
    const v = KADAI.view(se, T0)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe(KADAI.model.nodes.chop_onion.label)
  })
})

describe('stepList (PR 2 CP3, All steps)', () => {
  const order = pageOrder(DONUTS.model, DONUTS.pageNumbers)
  const n = (id: string) => order.indexOf(id) + 1

  it('every page step in page order, numbered as the page numbers it', () => {
    const rows = stepList(DONUTS.model, DONUTS.fresh(), T0, order, 'bloom_yeast')
    expect(rows.map((r) => r.nodeId)).toEqual(order)
    expect(rows.map((r) => r.n)).toEqual(order.map((_, i) => i + 1))
    expect(rows.map((r) => r.name)).toEqual(order.map((id) => DONUTS.model.nodes[id].label))
  })

  it('mid-cook: done (no right text), running (its time left), viewed ("You are here"), to do', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0)) // 60 min
    const rows = stepList(DONUTS.model, se, T0 + 8 * MIN, order, 'grease_pan')
    const row = (id: string) => rows.find((r) => r.nodeId === id)!
    expect(row('bloom_yeast')).toEqual({ nodeId: 'bloom_yeast', n: n('bloom_yeast'), name: 'Bloom yeast', state: 'done', right: null, action: { kind: 'view', nodeId: 'bloom_yeast' } })
    expect(row('first_rise')).toMatchObject({ state: 'running', right: '52 min left' })
    expect(row('grease_pan')).toMatchObject({ state: 'viewed', right: 'You are here' })
    expect(row('shape_and_cut')).toMatchObject({ state: 'todo', right: null }) // hands-on: no time
  })

  it('a to-do hands-off or low-attention step shows its length; viewed wins over running and done', () => {
    let se = must(engine.startNode(DONUTS.fresh(), DONUTS.model, 'first_rise', T0))
    const rows = stepList(DONUTS.model, se, T0, order, 'first_rise')
    const row = (id: string) => rows.find((r) => r.nodeId === id)!
    expect(row('proof_donuts')).toMatchObject({ state: 'todo', right: '25 min' })
    expect(row('fry_donuts')).toMatchObject({ state: 'todo', right: '14 min' })
    expect(row('first_rise')).toMatchObject({ state: 'viewed', right: 'You are here' })
    se = must(engine.markDone(se, DONUTS.model, 'bloom_yeast', T0))
    expect(stepList(DONUTS.model, se, T0, order, 'bloom_yeast')[n('bloom_yeast') - 1]).toMatchObject({ state: 'viewed' })
  })

  it('a step with a length of an hour or more reads it in hours (Donuts first rise: "1 hr")', () => {
    const rows = stepList(DONUTS.model, DONUTS.fresh(), T0, order, 'bloom_yeast')
    expect(rows.find((r) => r.nodeId === 'first_rise')).toMatchObject({ state: 'todo', right: '1 hr' })
  })
})

describe('waitingNext (PR 2 CP4, "When it\'s done")', () => {
  const order = pageOrder(KADAI.model, KADAI.pageNumbers)

  it('the first not-done consumer, in execution order', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
    se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
    const next = waitingNext(KADAI.model, se, T0, 'cook_tomato_base', order)
    expect(next).toMatchObject({ label: "When it's done", name: KADAI.model.nodes.add_veggies.label, action: { kind: 'view', nodeId: 'add_veggies' } })
  })

  it('every consumer done: the suggestion after a simulated Done', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
    se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
    se = must(engine.markDone(se, KADAI.model, 'add_veggies', T0))
    // chop_capsicum is passed (its only consumer, add_veggies, is done), so the engine
    // suggests cube_paneer.
    expect(waitingNext(KADAI.model, se, T0, 'cook_tomato_base', order)?.action).toEqual({ kind: 'view', nodeId: 'cube_paneer' })
  })

  it('nothing for the finish step', () => {
    const se = must(engine.startNode(MAGGI.fresh(), MAGGI.model, 'boil_water', T0))
    const sink = MAGGI.model.order.find((id) => MAGGI.model.nodes[id].isSink)!
    expect(waitingNext(MAGGI.model, se, T0, sink, MAGGI.model.order)).toBeNull()
  })
})

describe('meanwhileRows (PR 2 CP4, the waiting screen\'s Meanwhile block)', () => {
  const order = pageOrder(KADAI.model, KADAI.pageNumbers)
  const n = (id: string) => order.indexOf(id) + 1

  it('one row per task of the windows this step hosts, by rankInWindow; done / running / to do', () => {
    let se = KADAI.done(KADAI.fresh(), ['chop_onion', 'chop_tomato', 'saute_onion'], T0)
    se = must(engine.startNode(se, KADAI.model, 'cook_tomato_base', T0))
    se = must(engine.markDone(se, KADAI.model, 'chop_capsicum', T0 + MIN))
    const rows = meanwhileRows(KADAI.model, se, T0 + 2 * MIN, 'cook_tomato_base', order)
    const tasks = KADAI.model.order
      .filter((id) => KADAI.model.nodes[id].windowId != null)
      .sort((a, b) => (KADAI.model.nodes[a].rankInWindow ?? 0) - (KADAI.model.nodes[b].rankInWindow ?? 0))
    expect(rows.map((r) => r.nodeId)).toEqual(tasks)
    expect(rows[0]).toEqual({
      nodeId: 'chop_capsicum',
      n: n('chop_capsicum'),
      name: KADAI.model.nodes.chop_capsicum.label,
      state: 'done',
      right: 'Done',
      action: { kind: 'view', nodeId: 'chop_capsicum' },
    })
    expect(rows[1]).toMatchObject({ state: 'todo', right: null })
  })

  it('a running task shows its time left; a step that hosts no window has no rows', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0)
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0))
    const dOrder = pageOrder(DONUTS.model, DONUTS.pageNumbers)
    expect(meanwhileRows(DONUTS.model, se, T0, 'first_rise', dOrder).map((r) => r.nodeId)).toEqual(['grease_pan'])
    expect(meanwhileRows(DONUTS.model, se, T0, 'proof_donuts', dOrder)).toEqual([])
  })
})

describe('endCookFoot (PR 2 CP4, "End this cook" at the foot of All steps)', () => {
  it('ending takes two taps: the first only asks', () => {
    const first = endCookFoot(false)
    expect(first).toEqual({ prompt: null, buttons: [{ label: 'End this cook', confirm: true }] })
    const second = endCookFoot(true)
    expect(second.prompt).toBe('End this cook? Running timers will stop.')
    expect(second.buttons[0]).toEqual({ label: 'End cook', action: { kind: 'endAndExit' } })
  })

  it('"Keep cooking" dispatches nothing; it goes back to the list', () => {
    expect(endCookFoot(true).buttons[1]).toEqual({ label: 'Keep cooking', confirm: false })
    expect(endCookFoot(true).buttons.filter((b) => 'action' in b)).toHaveLength(1)
  })
})

describe('Undo and the wake lock', () => {
  it('the undo link shows within the window; off the acted-on step it names what it undoes (CP3)', () => {
    const se = KADAI.done(KADAI.fresh(), ['chop_onion'], T0)
    expect(KADAI.view(se, T0 + 9_000).secondary).toEqual({ label: 'Undo Done on Chop onion', solid: false, action: { kind: 'undo' } })
    expect(KADAI.view(se, T0 + 10_000).secondary).toBeNull()
  })

  it('the wake lock holds on the two new step screens', () => {
    expect(shouldHoldWakeLock('step_running')).toBe(true)
    expect(shouldHoldWakeLock('step_done')).toBe(true)
  })

  it('amendment 2: Undo after the timer start from a viewed step returns to that step, not started', () => {
    let se = DONUTS.done(DONUTS.fresh(), FIRST_THREE, T0 + MIN)
    se = must(engine.view(se, DONUTS.model, 'first_rise', T0 + 2 * MIN))
    const before = se
    const primary = DONUTS.view(se, T0 + 2 * MIN).primary!.action
    expect(primary).toEqual({ kind: 'startNode', nodeId: 'first_rise', clearView: true })

    // What CookingModeScreen dispatches for that descriptor.
    se = must(engine.startNode(se, DONUTS.model, 'first_rise', T0 + 3 * MIN))
    se = must(engine.view(se, DONUTS.model, null, T0 + 3 * MIN))

    // The start cleared the view, so the page is now another step: the link names the start (CP3).
    const v = DONUTS.view(se, T0 + 3 * MIN + 5_000)
    expect(v.secondary).toEqual({ label: 'Undo timer start on First rise', solid: false, action: { kind: 'undo' } })

    const undone = must(engine.undo(se, DONUTS.model, T0 + 3 * MIN + 5_000))
    expect(undone.nodes.first_rise).toEqual({ state: 'pending' })
    expect(undone.nodes).toEqual(before.nodes)
    expect(undone.finishedAt).toBe(before.finishedAt)
    expect(undone.viewing).toBe('first_rise')
    const back = DONUTS.view(undone, T0 + 3 * MIN + 5_000)
    expect(back.screenId).toBe('handsoff_pending')
    expect(back.label).toBe(DONUTS.model.nodes.first_rise.label)
  })
})
