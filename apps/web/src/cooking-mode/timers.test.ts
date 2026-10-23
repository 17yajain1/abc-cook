import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { localClock } from './copy'
import { pageOrder } from './stepPage'
import { MAX_RAILS, rails, runningTimers, timerSheet } from './timers'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { ADD_TIME_MS } from '@/cooking/constants'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession, Rejected } from '@/cooking/types'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'

/**
 * PR 2 CP3: the timer rail, the timer sheet and the Timers list (owner answer 1). Real
 * engine on the Donuts fixture; every `now` is a literal.
 */

const T0 = 1_700_000_000_000
const MIN = 60_000

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

const DONUTS = homemadeDonuts as RecipePlanResponse
const model = deriveCookingModel(DONUTS)
const order = pageOrder(model, stepNumbers(derivePlan(DONUTS).stages))
const stepRef = (id: string) => `Step ${order.indexOf(id) + 1}`
const fresh = () => must(engine.start(null, model, 'server:donuts', T0))
const start = (se: CookingSession, id: string, at: number) => must(engine.startNode(se, model, id, at))

describe('runningTimers', () => {
  it('every running node, soonest end first, with its page step and time left', () => {
    let se = start(fresh(), 'first_rise', T0) // ends T0+60
    se = start(se, 'proof_donuts', T0 + MIN) // ends T0+26
    se = start(se, 'fry_donuts', T0 + 2 * MIN) // periodic, ends T0+16
    expect(runningTimers(model, se, T0 + 8 * MIN, order)).toEqual([
      { nodeId: 'fry_donuts', name: 'Fry donuts', stepRef: stepRef('fry_donuts'), left: '8 min left' },
      { nodeId: 'proof_donuts', name: 'Proof donuts', stepRef: stepRef('proof_donuts'), left: '18 min left' },
      { nodeId: 'first_rise', name: 'First rise', stepRef: stepRef('first_rise'), left: '52 min left' },
    ])
  })

  it('nothing running: none; a stopped or done timer drops out', () => {
    expect(runningTimers(model, fresh(), T0, order)).toEqual([])
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    se = must(engine.stopNode(se, model, 'first_rise', T0 + MIN))
    se = must(engine.markDone(se, model, 'proof_donuts', T0 + MIN))
    expect(runningTimers(model, se, T0 + MIN, order)).toEqual([])
  })

  it('an expired timer that is still running reads "Time\'s up"', () => {
    const se = start(fresh(), 'proof_donuts', T0)
    expect(runningTimers(model, se, T0 + 30 * MIN, order)[0].left).toBe("Time's up")
  })
})

describe('rails (owner answer 1: at most two)', () => {
  it('one timer: one rail naming its step and time left, with the design\'s aria-label', () => {
    const se = start(fresh(), 'first_rise', T0)
    expect(rails(model, se, T0 + 8 * MIN, order)).toEqual([
      { kind: 'timer', nodeId: 'first_rise', name: 'First rise', left: '52 min left', aria: 'First rise, 52 min left. Open timer' },
    ])
  })

  it('includes the viewed step\'s own timer (its page has no other way to the sheet)', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = must(engine.view(se, model, 'first_rise', T0))
    expect(rails(model, se, T0, order).map((r) => r.kind === 'timer' && r.nodeId)).toEqual(['first_rise'])
  })

  it('two timers: two rails, soonest on top', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    expect(rails(model, se, T0, order).map((r) => r.kind === 'timer' && r.name)).toEqual(['Proof donuts', 'First rise'])
  })

  it('three or more: the soonest, then "N more timers" (N = timers not on the first rail; CP3.1 label)', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    se = start(se, 'heat_oil', T0)
    const r = rails(model, se, T0, order)
    expect(r).toHaveLength(MAX_RAILS)
    expect(r[0]).toMatchObject({ kind: 'timer', nodeId: 'heat_oil' })
    expect(r[1]).toEqual({ kind: 'more', count: 2, text: '2 more timers', aria: '2 more timers. Show all timers' })
  })

  it('none running: no rail', () => {
    expect(rails(model, fresh(), T0, order)).toEqual([])
  })
})

describe('timerSheet', () => {
  const rising = () => start(fresh(), 'first_rise', T0) // 60 min, ends T0+60

  it('the design\'s pieces: name, Go to step, minutes + unit, ready clock, bar, three actions', () => {
    const now = T0 + 8 * MIN
    expect(timerSheet(model, rising(), now, 'first_rise', order, 'grease_pan', 'en-GB')).toEqual({
      nodeId: 'first_rise',
      name: 'First rise',
      stepRef: stepRef('first_rise'),
      goTo: { label: `Go to ${stepRef('first_rise').toLowerCase()}`, action: { kind: 'view', nodeId: 'first_rise' } },
      big: '52',
      unit: 'min left',
      readyAt: `Ready around ${localClock(now, T0 + 60 * MIN, 'en-GB')}`,
      fraction: 8 / 60,
      add: { label: 'Add 5 min', action: { kind: 'extend', nodeId: 'first_rise', ms: ADD_TIME_MS } },
      stop: { label: 'Stop timer', action: { kind: 'stopNode', nodeId: 'first_rise' } },
      done: { label: "It's done", action: { kind: 'markDone', nodeId: 'first_rise' } },
    })
  })

  it('no "Go to" when the cook is already on that step (the header just says "Step N")', () => {
    expect(timerSheet(model, rising(), T0, 'first_rise', order, 'first_rise')?.goTo).toBeNull()
  })

  it('an hour or more: "1 hr 12 min" + "left"', () => {
    let se = rising()
    for (let i = 0; i < 3; i++) se = must(engine.extend(se, model, 'first_rise', T0, ADD_TIME_MS)) // ends T0+75
    const s = timerSheet(model, se, T0 + 3 * MIN, 'first_rise', order, null)!
    expect([s.big, s.unit]).toEqual(['1 hr 12 min', 'left'])
    expect(s.fraction).toBeCloseTo(3 / 75)
  })

  it('expired: "Time\'s up", no unit, no ready clock, no Add 5 min; the bar is full', () => {
    const s = timerSheet(model, rising(), T0 + 61 * MIN, 'first_rise', order, null)!
    expect([s.big, s.unit, s.readyAt, s.add]).toEqual(["Time's up", null, null, null])
    expect(s.fraction).toBe(1)
    expect(s.stop.action).toEqual({ kind: 'stopNode', nodeId: 'first_rise' })
  })

  it('a node that is not running has no sheet (the sheet then closes itself)', () => {
    expect(timerSheet(model, fresh(), T0, 'first_rise', order, null)).toBeNull()
    const done = must(engine.markDone(rising(), model, 'first_rise', T0 + MIN))
    expect(timerSheet(model, done, T0 + MIN, 'first_rise', order, null)).toBeNull()
  })

  it('a periodic (low attention) timer gets the same sheet (Kadai base)', () => {
    const KADAI = kadaiPaneer as RecipePlanResponse
    const kModel = deriveCookingModel(KADAI)
    const kOrder = pageOrder(kModel, stepNumbers(derivePlan(KADAI).stages))
    const se = must(engine.startNode(must(engine.start(null, kModel, 'server:kadai', T0)), kModel, 'cook_tomato_base', T0))
    expect(timerSheet(kModel, se, T0 + 2 * MIN, 'cook_tomato_base', kOrder, null)).toMatchObject({ big: '10', unit: 'min left' })
  })
})
