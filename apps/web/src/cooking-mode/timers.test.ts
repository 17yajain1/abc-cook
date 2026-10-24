import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { readyClock } from './copy'
import { pageOrder } from './stepPage'
import { MAX_RAILS, runningTimers, SHEET_TOP_PX, sheetTop, strips, timerSheet } from './timers'
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

describe('strips, no timer ended: the CP3 rails (owner answer 1: at most two)', () => {
  it('one timer: one rail naming its step and time left, with the design\'s aria-label', () => {
    const se = start(fresh(), 'first_rise', T0)
    expect(strips(model, se, T0 + 8 * MIN, order)).toEqual([
      { kind: 'timer', nodeId: 'first_rise', name: 'First rise', left: '52 min left', aria: 'First rise, 52 min left. Open timer' },
    ])
  })

  it('includes the viewed step\'s own timer unless it is hidden (its own waiting screen)', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = must(engine.view(se, model, 'first_rise', T0))
    expect(strips(model, se, T0, order).map((r) => r.kind === 'timer' && r.nodeId)).toEqual(['first_rise'])
    expect(strips(model, se, T0, order, 'first_rise')).toEqual([])
  })

  it('two timers: two rails, soonest on top', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    expect(strips(model, se, T0, order).map((r) => r.kind === 'timer' && r.name)).toEqual(['Proof donuts', 'First rise'])
  })

  it('three or more: the soonest, then "N more timers" (N = timers not on the first rail; CP3.1 label)', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    se = start(se, 'heat_oil', T0)
    const r = strips(model, se, T0, order)
    expect(r).toHaveLength(MAX_RAILS)
    expect(r[0]).toMatchObject({ kind: 'timer', nodeId: 'heat_oil' })
    expect(r[1]).toEqual({ kind: 'more', count: 2, text: '2 more timers', aria: '2 more timers. Show all timers' })
  })

  it('a hidden timer is not counted: three running, one hidden, two rails', () => {
    let se = start(fresh(), 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    se = start(se, 'heat_oil', T0)
    expect(strips(model, se, T0, order, 'heat_oil').map((r) => r.kind === 'timer' && r.nodeId)).toEqual([
      'proof_donuts',
      'first_rise',
    ])
  })

  it('none running: no rail', () => {
    expect(strips(model, fresh(), T0, order)).toEqual([])
  })
})

describe('strips, a timer ended: the V2Banner (PR 2 CP4)', () => {
  // Started at T0: heat_oil ends T0+12, fry_donuts T0+14, proof_donuts T0+25, first_rise T0+60.
  const banner = (nodeId: string, name: string, line: string) => ({
    kind: 'banner',
    nodeId,
    title: `${name} is ready`,
    line,
    add: { label: '+5 min', action: { kind: 'extend', nodeId, ms: ADD_TIME_MS } },
    done: { label: 'Done', action: { kind: 'markDone', nodeId } },
  })

  it('just ended: "‹name› is ready" / "Timer ended just now", its own +5 min and Done', () => {
    const se = start(fresh(), 'heat_oil', T0)
    expect(strips(model, se, T0 + 12 * MIN + 10_000, order)).toEqual([banner('heat_oil', 'Heat oil', 'Timer ended just now')])
  })

  it('ended while away: minutes, rounded, never seconds; from an hour, hours and minutes', () => {
    const se = start(fresh(), 'heat_oil', T0)
    expect(strips(model, se, T0 + 16 * MIN + 20_000, order)[0]).toMatchObject({ line: 'Timer ended 4 min ago' })
    expect(strips(model, se, T0 + 77 * MIN, order)[0]).toMatchObject({ line: 'Timer ended 1 hr 5 min ago' })
  })

  it('every ended timer becomes a banner, required or not (holding included)', () => {
    // first_rise's consumer (shape_and_cut) is not ready while other steps are pending.
    const se = start(fresh(), 'first_rise', T0)
    expect(strips(model, se, T0 + 61 * MIN, order).map((s) => s.kind)).toEqual(['banner'])
  })

  it('banner first, then the one running timer as its rail', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = start(se, 'first_rise', T0)
    const s = strips(model, se, T0 + 13 * MIN, order)
    expect(s.map((x) => x.kind)).toEqual(['banner', 'timer'])
    expect(s[1]).toMatchObject({ nodeId: 'first_rise', left: '47 min left' })
  })

  it('banner, then several running fold into "N more timers"', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = start(se, 'first_rise', T0)
    se = start(se, 'proof_donuts', T0)
    const s = strips(model, se, T0 + 13 * MIN, order)
    expect(s.map((x) => x.kind)).toEqual(['banner', 'more'])
    expect(s[1]).toMatchObject({ count: 2, text: '2 more timers' })
  })

  it('two ended: two banners, the one that ended first on top; at most 2 banners and 3 strips', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = start(se, 'proof_donuts', T0)
    se = start(se, 'first_rise', T0)
    const two = strips(model, se, T0 + 26 * MIN, order)
    expect(two.map((x) => x.kind)).toEqual(['banner', 'banner', 'timer'])
    expect(two.map((x) => (x.kind === 'more' ? null : x.nodeId))).toEqual(['heat_oil', 'proof_donuts', 'first_rise'])
    // All three ended: two banners, the third folds into the strip (one left: its rail).
    const three = strips(model, se, T0 + 61 * MIN, order)
    expect(three.map((x) => x.kind)).toEqual(['banner', 'banner', 'timer'])
    expect(three[2]).toMatchObject({ nodeId: 'first_rise', left: "Time's up" })
  })

  it('a third ended plus one running fold into "2 more timers"', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = start(se, 'proof_donuts', T0)
    se = start(se, 'fry_donuts', T0) // 14 min, ends T0+14
    se = start(se, 'first_rise', T0)
    const s = strips(model, se, T0 + 26 * MIN, order)
    expect(s.map((x) => x.kind)).toEqual(['banner', 'banner', 'more'])
    expect(s[2]).toMatchObject({ count: 2 })
  })

  it('a hidden timer\'s banner is hidden too (its own waiting screen shows the end)', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = start(se, 'first_rise', T0)
    expect(strips(model, se, T0 + 13 * MIN, order, 'heat_oil').map((x) => x.kind)).toEqual(['timer'])
  })

  it('"+5 min" after the end gives a new end 5 min from now, so the banner becomes a rail', () => {
    let se = start(fresh(), 'heat_oil', T0)
    se = must(engine.extend(se, model, 'heat_oil', T0 + 16 * MIN, ADD_TIME_MS))
    expect(strips(model, se, T0 + 16 * MIN, order)).toEqual([
      { kind: 'timer', nodeId: 'heat_oil', name: 'Heat oil', left: '5 min left', aria: 'Heat oil, 5 min left. Open timer' },
    ])
  })
})

describe('sheetTop (PR 2 CP4.1: a sheet never sits under a banner)', () => {
  it('150px with no banner, or banners ending above it; else the bottom of the banners', () => {
    expect(SHEET_TOP_PX).toBe(150)
    expect(sheetTop(null)).toBe(150)
    expect(sheetTop(126)).toBe(150)
    expect(sheetTop(213)).toBe(213)
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
      readyAt: `Ready around ${readyClock(now, T0 + 60 * MIN, 'en-GB')}`,
      ended: false,
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

  it('expired: "Time\'s up", no unit, no ready clock; the bar is full; Add 5 min stays (CP4: from now)', () => {
    const s = timerSheet(model, rising(), T0 + 61 * MIN, 'first_rise', order, null)!
    expect([s.big, s.unit, s.readyAt, s.ended]).toEqual(["Time's up", null, null, true])
    expect(s.add).toEqual({ label: 'Add 5 min', action: { kind: 'extend', nodeId: 'first_rise', ms: ADD_TIME_MS } })
    expect(s.fraction).toBe(1)
    expect(s.stop.action).toEqual({ kind: 'stopNode', nodeId: 'first_rise' })
  })

  it('the next day: "Ready around 7:00 tomorrow", the time first (CP4 readyClock)', () => {
    const now = new Date(2026, 9, 23, 22, 0).getTime()
    const se = must(engine.startNode(fresh(), model, 'first_rise', now - 51 * MIN)) // ends 22:09 the same day
    expect(timerSheet(model, se, now, 'first_rise', order, null, 'en-GB')?.readyAt).toBe('Ready around 22:09')
    const late = must(engine.extend(se, model, 'first_rise', now, 9 * 60 * MIN)) // ends 07:09 the next day
    expect(timerSheet(model, late, now, 'first_rise', order, null, 'en-GB')?.readyAt?.replace(/\s/gu, ' ')).toBe(
      'Ready around 7:09 tomorrow',
    )
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
