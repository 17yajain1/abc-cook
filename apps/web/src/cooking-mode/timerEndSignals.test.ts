import { describe, expect, it, vi } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import type { CookingNotice } from './cookingSignals'
import { createRangStore, createTimerEndRinger, RANG_KEY, shouldRing, VIBRATE_PATTERN } from './timerEndSignals'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import { ADD_TIME_MS } from '@/cooking/constants'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { StorageLike } from '@/cooking/store'
import type { CookingSession, Rejected } from '@/cooking/types'

/**
 * PR 2 CP4: the timer-end sound and vibration ring once per timer, across the whole app,
 * remembered across reloads. Real engine on the Donuts fixture, fake storage and signals;
 * every `now` is a literal.
 */

const T0 = 1_700_000_000_000
const MIN = 60_000
const DONUTS = homemadeDonuts as RecipePlanResponse
const model = deriveCookingModel(DONUTS)

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}

/** heat_oil runs 12 min from T0, so it ends at T0+12. */
const heating = () => must(engine.startNode(must(engine.start(null, model, 'server:donuts', T0)), model, 'heat_oil', T0))
const END = T0 + 12 * MIN

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error('blocked')
  }
  setItem(): void {
    throw new Error('blocked')
  }
  removeItem(): void {
    throw new Error('blocked')
  }
}

function fakeSignals() {
  const order: string[] = []
  const notices: CookingNotice[] = []
  return {
    order,
    notices,
    playSound: vi.fn(() => {
      order.push('sound')
    }),
    vibrate: vi.fn(() => {
      order.push('vibrate')
    }),
    notify: vi.fn((n: CookingNotice) => {
      notices.push(n)
    }),
  }
}

function ringer(storage: StorageLike) {
  const signals = fakeSignals()
  return { signals, r: createTimerEndRinger({ store: createRangStore(storage), signals }) }
}

describe('shouldRing (pure)', () => {
  it('a running timer that ended under 60 s ago and is not yet rung', () => {
    const { ring, next } = shouldRing(null, heating(), END + 1_000)
    expect(ring).toEqual([{ kind: 'timerEnded', nodeId: 'heat_oil', endsAt: END }])
    expect(next).toEqual({ session: `server:donuts@${T0}`, keys: [`heat_oil@${END}`] })
  })

  it('not before the end; not once rung; not 60 s or more after the end', () => {
    const se = heating()
    expect(shouldRing(null, se, END - 1).ring).toEqual([])
    expect(shouldRing({ session: `server:donuts@${T0}`, keys: [`heat_oil@${END}`] }, se, END).ring).toEqual([])
    expect(shouldRing(null, se, END + 60_000).ring).toEqual([])
  })

  it('no session: nothing to ring, and the set is cleared', () => {
    expect(shouldRing({ session: 'x@1', keys: ['a@1'] }, null, END)).toEqual({ ring: [], next: null })
  })
})

describe('createTimerEndRinger', () => {
  it('rings once: sound, vibrate [300, 150, 300] and notify, and never again for that end', () => {
    const storage = new MemoryStorage()
    const { r, signals } = ringer(storage)
    const se = heating()
    r.check(se, END - 1_000)
    expect(signals.playSound).not.toHaveBeenCalled()
    r.check(se, END)
    r.check(se, END + 1_000)
    r.check(se, END + 2_000)
    expect(signals.playSound).toHaveBeenCalledTimes(1)
    expect(signals.playSound).toHaveBeenCalledWith('timerEnd')
    expect(signals.vibrate).toHaveBeenCalledWith(VIBRATE_PATTERN)
    expect(VIBRATE_PATTERN).toEqual([300, 150, 300])
    expect(signals.notices).toEqual([{ kind: 'timerEnded', nodeId: 'heat_oil', endsAt: END }])
  })

  it('the key is written before the sound plays', () => {
    const storage = new MemoryStorage()
    let storedAtSound: string | null = null
    const signals = fakeSignals()
    signals.playSound.mockImplementation(() => {
      storedAtSound = storage.getItem(RANG_KEY)
    })
    createTimerEndRinger({ store: createRangStore(storage), signals }).check(heating(), END)
    expect(storedAtSound).toContain(`heat_oil@${END}`)
  })

  it('no second ring after a reload (a new ringer, the same storage) or a second mount', () => {
    const storage = new MemoryStorage()
    const se = heating()
    const first = ringer(storage)
    first.r.check(se, END + 1_000)
    const second = ringer(storage)
    second.r.check(se, END + 2_000)
    expect(first.signals.playSound).toHaveBeenCalledTimes(1)
    expect(second.signals.playSound).not.toHaveBeenCalled()
  })

  it('a timer that ended 61 s before the page was open never rings', () => {
    const { r, signals } = ringer(new MemoryStorage())
    r.check(heating(), END + 61_000)
    expect(signals.playSound).not.toHaveBeenCalled()
  })

  it('"+5 min" gives a new end, which rings once', () => {
    const { r, signals } = ringer(new MemoryStorage())
    let se = heating()
    r.check(se, END)
    se = must(engine.extend(se, model, 'heat_oil', END + 30_000, ADD_TIME_MS))
    const newEnd = END + 30_000 + ADD_TIME_MS
    r.check(se, newEnd - 1)
    r.check(se, newEnd)
    r.check(se, newEnd + 1_000)
    expect(signals.playSound).toHaveBeenCalledTimes(2)
  })

  it('two timers ending in the same tick: one sound, one vibrate, a notice each', () => {
    const { r, signals } = ringer(new MemoryStorage())
    let se = heating()
    se = must(engine.startNode(se, model, 'proof_donuts', END - 25 * MIN))
    r.check(se, END + 500)
    expect(signals.playSound).toHaveBeenCalledTimes(1)
    expect(signals.vibrate).toHaveBeenCalledTimes(1)
    expect(signals.notices.map((n) => n.nodeId).sort()).toEqual(['heat_oil', 'proof_donuts'])
  })

  it('a new session id resets the set', () => {
    const storage = new MemoryStorage()
    const { r, signals } = ringer(storage)
    r.check(heating(), END)
    // The same plan started again at T0 + 1 min: a new session, its own heat_oil end.
    const again = must(engine.startNode(must(engine.start(null, model, 'server:donuts', T0 + MIN)), model, 'heat_oil', T0 + MIN))
    r.check(again, END + MIN)
    expect(signals.playSound).toHaveBeenCalledTimes(2)
    expect(JSON.parse(storage.getItem(RANG_KEY)!)).toEqual({ session: `server:donuts@${T0 + MIN}`, keys: [`heat_oil@${END + MIN}`] })
  })

  it('no session clears the stored set', () => {
    const storage = new MemoryStorage()
    const { r } = ringer(storage)
    r.check(heating(), END)
    expect(storage.getItem(RANG_KEY)).not.toBeNull()
    r.check(null, END + 1_000)
    expect(storage.getItem(RANG_KEY)).toBeNull()
  })

  it('storage that throws: still rings once per page load, never throws', () => {
    const { r, signals } = ringer(new ThrowingStorage())
    const se = heating()
    expect(() => {
      r.check(se, END)
      r.check(se, END + 1_000)
    }).not.toThrow()
    expect(signals.playSound).toHaveBeenCalledTimes(1)
  })

  it('a stored value that is not ours is ignored', () => {
    const storage = new MemoryStorage()
    storage.setItem(RANG_KEY, '{"oops":true}')
    const { r, signals } = ringer(storage)
    r.check(heating(), END)
    expect(signals.playSound).toHaveBeenCalledTimes(1)
  })
})
