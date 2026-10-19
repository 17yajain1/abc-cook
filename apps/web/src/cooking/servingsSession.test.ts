import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import { servingsLocked } from '@/library/staleness'
import type { ServingsChoice } from '@/lib/servings'

import { deriveCookingModel } from './model'
import { createSessionStore, type StorageLike } from './store'

const MODEL = deriveCookingModel(kadhi as RecipePlanResponse)
const T0 = 1_700_000_000_000
const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })

function storage(): StorageLike & { mem: Map<string, string> } {
  const mem = new Map<string, string>()
  return { mem, getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }
}

describe('CookingSession.servingsChoice (additive, v1)', () => {
  it('start stores the choice and a fresh store reads it back', () => {
    const st = storage()
    const a = createSessionStore(st, () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0, servingsChoice: S(6, 4) })
    expect(a.getState()?.servingsChoice).toEqual(S(6, 4))
    expect(createSessionStore(st, () => T0).getState()?.servingsChoice).toEqual(S(6, 4))
  })
  it('start with no choice leaves the field absent (a session from before R4 reads the same)', () => {
    const a = createSessionStore(storage(), () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0 })
    expect('servingsChoice' in a.getState()!).toBe(false)
  })
  it('a factor-1 choice is not stored', () => {
    const a = createSessionStore(storage(), () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0, servingsChoice: S(4, 4) })
    expect('servingsChoice' in a.getState()!).toBe(false)
  })
  it('a malformed stored choice is dropped, never the session', () => {
    const st = storage()
    const a = createSessionStore(st, () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0, servingsChoice: S(6, 4) })
    const body = JSON.parse(st.mem.get([...st.mem.keys()][0])!)
    body.session.servingsChoice = { mode: 'servings', chosen: 'six' }
    st.mem.set([...st.mem.keys()][0], JSON.stringify(body))
    const b = createSessionStore(st, () => T0).getState()
    expect(b?.planKey).toBe('library:1')
    expect(b?.servingsChoice).toBeUndefined()
  })
  it('replace carries the new choice', () => {
    const a = createSessionStore(storage(), () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0 })
    a.dispatch({ type: 'replace', model: MODEL, planKey: 'library:2', expectedPlanKey: 'library:1', now: T0, servingsChoice: S(2, 4) })
    expect(a.getState()?.servingsChoice).toEqual(S(2, 4))
  })
})

describe('servingsLocked (Q9)', () => {
  const store = () => {
    const a = createSessionStore(storage(), () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'library:1', now: T0 })
    return a
  }
  it('locked while this plan has an active session', () => {
    expect(servingsLocked(store().getState(), 'library:1', T0 + 60_000)).toBe(true)
  })
  it('a session for another plan does not lock this one', () => {
    expect(servingsLocked(store().getState(), 'library:2', T0 + 60_000)).toBe(false)
  })
  it('no session, no lock', () => {
    expect(servingsLocked(null, 'library:1', T0)).toBe(false)
  })
  it('a session idle past the active window does not lock', () => {
    expect(servingsLocked(store().getState(), 'library:1', T0 + 25 * 60 * 60 * 1000)).toBe(false)
  })
  it('a finished session does not lock', () => {
    const s = { ...store().getState()!, finishedAt: T0 + 1000 }
    expect(servingsLocked(s, 'library:1', T0 + 2000)).toBe(false)
  })
  it('works for any plan-key prefix, not only library:', () => {
    const a = createSessionStore(storage(), () => T0)
    a.dispatch({ type: 'start', model: MODEL, planKey: 'import:g', now: T0 })
    expect(servingsLocked(a.getState(), 'import:g', T0 + 1000)).toBe(true)
  })
})
