import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from './model'
import { createSessionStore, type StorageLike } from './store'
import type { CookingSession } from './types'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

/**
 * CP2 store tests — plan §H rows 15 (reopen), 34 (conflict), 35 (tolerant read), plus
 * `dispatch`/`subscribe` wiring. `engine.test.ts` covers the reducer's own semantics in
 * depth; this file covers persistence, salvage and the store's action-dispatch surface,
 * the same split `library/store.test.ts` uses for the library.
 */

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse

const T0 = 1_700_000_000_000
const m = (min: number) => min * 60_000

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

  raw(key: string): string | undefined {
    return this.data.get(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }
}

const clock = (t: number) => () => t

describe('createSessionStore — dispatch/getState/subscribe wiring', () => {
  it('start persists a session that getState returns; subscribe notifies on every successful dispatch', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    expect(store.getState()).toBeNull()

    let notifications = 0
    const unsubscribe = store.subscribe(() => notifications++)

    const started = store.dispatch({ type: 'start', model, planKey: 'server:kadai', now: T0 })
    expect(started.ok).toBe(true)
    expect(store.getState()?.planKey).toBe('server:kadai')
    expect(notifications).toBe(1)

    const done = store.dispatch({ type: 'markDone', model, nodeId: 'chop_onion', now: T0 })
    expect(done.ok).toBe(true)
    expect(store.getState()?.nodes.chop_onion.state).toBe('done')
    expect(notifications).toBe(2)

    unsubscribe()
    store.dispatch({ type: 'markDone', model, nodeId: 'saute_onion', now: T0 })
    expect(notifications).toBe(2) // no further notification after unsubscribe

    // A rejected dispatch does not persist or notify.
    const rejected = store.dispatch({ type: 'markDone', model, nodeId: 'add_veggies', now: T0 })
    expect(rejected.ok).toBe(false)
  })

  it('every mutating action rejects with no_session before a session has been started', () => {
    const model = deriveCookingModel(KADAI)
    const store = createSessionStore(new MemoryStorage(), clock(T0))

    for (const action of [
      { type: 'startNode' as const, model, nodeId: 'boil_water', now: T0 },
      { type: 'markDone' as const, model, nodeId: 'x', now: T0 },
      { type: 'acknowledge' as const, model, now: T0 },
      { type: 'skip' as const, model, nodeId: 'x', now: T0 },
      { type: 'extend' as const, model, nodeId: 'x', now: T0 },
      { type: 'undo' as const, model, now: T0 },
      { type: 'leave' as const, model, now: T0 },
      { type: 'resume' as const, model, now: T0 },
    ]) {
      expect(store.dispatch(action)).toEqual({ ok: false, reason: 'no_session' })
    }

    // touch and end have no session precondition — both are no-ops here.
    expect(store.dispatch({ type: 'touch', now: T0 })).toEqual({ ok: true, session: null })
    expect(store.dispatch({ type: 'end', now: T0 })).toEqual({ ok: true, session: null })
  })
})

describe('createSessionStore — reopen (row 15)', () => {
  it('a new store over the same storage round-trips the session, including a running timer', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const first = createSessionStore(storage, clock(T0))
    first.dispatch({ type: 'start', model, planKey: 'server:kadai', now: T0 })
    first.dispatch({ type: 'markDone', model, nodeId: 'chop_onion', now: T0 })
    first.dispatch({ type: 'markDone', model, nodeId: 'saute_onion', now: T0 })
    first.dispatch({ type: 'markDone', model, nodeId: 'chop_tomato', now: T0 })
    first.dispatch({ type: 'startNode', model, nodeId: 'cook_tomato_base', now: T0 + m(10) })

    const reopened = createSessionStore(storage, clock(T0 + m(40)))
    expect(reopened.getState()).toEqual(first.getState())
    expect(reopened.getState()?.nodes.cook_tomato_base).toEqual({
      state: 'running',
      startedAt: T0 + m(10),
      endsAt: T0 + m(22),
      extendedMs: 0,
    })

    // The read is at T0+40 (18 min past expiry) — unchanged by the reopen itself.
    const state = reopened.getState()?.nodes.cook_tomato_base
    if (state?.state !== 'running') throw new Error('expected running')
    expect(T0 + m(40) - state.endsAt).toBe(m(18))
  })
})

describe('createSessionStore — open: conflict/none/ok (row 34)', () => {
  it('reports none before any session, ok for the matching plan, conflict for a different one; end clears the way', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))

    expect(store.open(kadaiModel, 'library:kadai', T0)).toEqual({ status: 'none' })

    store.dispatch({ type: 'start', model: kadaiModel, planKey: 'library:kadai', now: T0 })
    expect(store.open(kadaiModel, 'library:kadai', T0)).toMatchObject({ status: 'ok', lifecycle: 'active' })
    expect(store.open(biryaniModel, 'library:biryani', T0)).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai', title: null, state: 'active' },
    })

    // start() itself also refuses a second session while the kadai one is live.
    expect(store.dispatch({ type: 'start', model: biryaniModel, planKey: 'library:biryani', now: T0 })).toEqual({
      ok: false,
      reason: 'session_exists',
    })

    store.dispatch({ type: 'end', now: T0 })
    expect(store.open(biryaniModel, 'library:biryani', T0)).toEqual({ status: 'none' })
    expect(store.dispatch({ type: 'start', model: biryaniModel, planKey: 'library:biryani', now: T0 }).ok).toBe(true)
  })
})

describe('createSessionStore — tolerant read and write-failure handling (row 35)', () => {
  it('corrupt JSON reads as no session, preserves the raw value, and never throws', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:session:v1', '{not valid json')

    let store: ReturnType<typeof createSessionStore> | undefined
    expect(() => {
      store = createSessionStore(storage, clock(T0))
    }).not.toThrow()

    expect(store!.getState()).toBeNull()
    const salvageKey = storage.keys().find((k) => k.startsWith('abc-cook:session:v1:unreadable-'))
    expect(salvageKey).toBeDefined()
    expect(storage.raw(salvageKey!)).toBe('{not valid json')
  })

  it('a wrong version reads as no session and preserves the raw value', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:session:v1', JSON.stringify({ version: 2, session: null }))

    const store = createSessionStore(storage, clock(T0))
    expect(store.getState()).toBeNull()
    expect(storage.keys().some((k) => k.startsWith('abc-cook:session:v1:unreadable-'))).toBe(true)
  })

  it('a subsequent start does not clobber the salvaged raw value', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:session:v1', 'garbage')
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'server:kadai', now: T0 })

    const salvageKey = storage.keys().find((k) => k.startsWith('abc-cook:session:v1:unreadable-'))
    expect(storage.raw(salvageKey!)).toBe('garbage')
  })

  it('setItem throwing returns {ok:false} and leaves in-memory state unchanged', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'server:kadai', now: T0 })
    const before: CookingSession | null = store.getState()

    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }

    const result = store.dispatch({ type: 'markDone', model, nodeId: 'chop_onion', now: T0 })
    expect(result).toEqual({ ok: false, reason: 'storage_write_failed' })
    expect(store.getState()).toEqual(before)

    storage.setItem = originalSetItem
  })
})

// ---------------------------------------------------------------------------
// CP1b (M3.4.5 session-lockout plan) — conflict actions, at the store/engine level
// that `CookingModeScreen`/`App.tsx` actually drive:
//
// - "Go to <recipe>" never calls `store.dispatch`/`session.start`/`session.end` at all
//   — `App.tsx`'s `goToConflict` only switches which plan `CookingModeScreen` is
//   mounted against; the *same* store instance then re-`open()`s against the target
//   plan. Tests 5-7 below simulate exactly that: open the target plan against a store
//   that already holds a session for it, and confirm it reports `'ok'` with the
//   unmutated stored session — never a second `start()`, never a mutation.
// - "End it and start this" is `session.end()` and nothing else (`CookingModeScreen`'s
//   `onEndBlockingSession`) — tests 8-10 confirm `end()` clears the blocking session
//   and that the plan the cook was trying to open then reports `'none'` (so it falls
//   through to the entry/start screen), with no `start()` call anywhere in the path.
// - "Close" (test 11) is unchanged from CP1a: it never dispatches anything, so the
//   blocking session survives untouched — already covered by CP1a's own conflict tests
//   (`store.open` returning `'conflict'` without mutating `getState()`); restated here
//   once more for CP1b's own numbered list.
// ---------------------------------------------------------------------------

describe('CP1b — "Go to <recipe>": opens the existing session, never creates or replaces it', () => {
  it('test 5: reopening the target plan reports ok, not none or conflict — the stored session is found and opened', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:kadai-id', now: T0, recipeTitle: 'Kadai Paneer' })

    // What "Go to" does at the store level: `App.tsx` switches which plan
    // `CookingModeScreen` is mounted against, and that screen's own `session.open()`
    // (`store.open`) is called fresh with the target's own model/planKey. No `start`
    // call happens anywhere in that path.
    const reopened = store.open(model, 'library:kadai-id', T0 + m(5))
    expect(reopened.status).toBe('ok')
  })

  it('test 6: reopening never creates a second session or replaces the stored one — getState is unchanged', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:kadai-id', now: T0, recipeTitle: 'Kadai Paneer' })
    const before = store.getState()

    store.open(model, 'library:kadai-id', T0 + m(5)) // read-only — `engine.open`'s own contract
    expect(store.getState()).toEqual(before)
    expect(store.getState()).toBe(before) // same object, not a replacement — open() never persists
  })

  it('test 7: a running node\'s timer survives the "Go to" round trip untouched', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:kadai-id', now: T0, recipeTitle: 'Kadai Paneer' })
    store.dispatch({ type: 'markDone', model, nodeId: 'chop_onion', now: T0 })
    store.dispatch({ type: 'markDone', model, nodeId: 'saute_onion', now: T0 })
    store.dispatch({ type: 'markDone', model, nodeId: 'chop_tomato', now: T0 })
    store.dispatch({ type: 'startNode', model, nodeId: 'cook_tomato_base', now: T0 + m(10) })
    const runningBefore = store.getState()?.nodes.cook_tomato_base

    const reopened = store.open(model, 'library:kadai-id', T0 + m(15))
    expect(reopened).toMatchObject({ status: 'ok' })
    expect(store.getState()?.nodes.cook_tomato_base).toEqual(runningBefore) // untouched, same endsAt
  })
})

describe('CP1b — "End it and start this": ends the blocking session, never auto-starts the new one', () => {
  it('test 8: end() clears the blocking session — getState becomes null', () => {
    const model = deriveCookingModel(BIRYANI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:biryani-id', now: T0, recipeTitle: 'Chicken Biryani' })
    expect(store.getState()).not.toBeNull()

    store.dispatch({ type: 'end', now: T0 })
    expect(store.getState()).toBeNull()
  })

  it('test 9: once ended, the requested recipe\'s own plan reports none — the entry/start view, never conflict', () => {
    const model = deriveCookingModel(BIRYANI)
    const kadaiModel = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:biryani-id', now: T0, recipeTitle: 'Chicken Biryani' })

    store.dispatch({ type: 'end', now: T0 })

    // "the requested recipe" — the one the cook was trying to open when it conflicted.
    expect(store.open(kadaiModel, 'library:kadai-id', T0)).toEqual({ status: 'none' })
  })

  it('test 10: ending the blocking session never itself starts a new one — no session exists until an explicit start', () => {
    const model = deriveCookingModel(BIRYANI)
    const kadaiModel = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model, planKey: 'library:biryani-id', now: T0, recipeTitle: 'Chicken Biryani' })

    store.dispatch({ type: 'end', now: T0 })

    // No `start` dispatched for kadai — `getState()` stays null until the cook
    // explicitly presses "Start cooking" on the entry screen `'none'` produced above.
    expect(store.getState()).toBeNull()
    expect(store.open(kadaiModel, 'library:kadai-id', T0).status).toBe('none')
  })
})

describe('CP1b — "Close": the blocking session remains intact (unchanged from CP1a)', () => {
  it('test 11: opening the conflicting plan again still reports conflict, and getState is untouched', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, clock(T0))
    store.dispatch({ type: 'start', model: kadaiModel, planKey: 'library:kadai-id', now: T0, recipeTitle: 'Kadai Paneer' })
    const before = store.getState()

    // "Close" dispatches nothing at all (`CookingModeScreen`'s `onClose` only calls
    // `onExit`, a local view change) — simulated here by simply not dispatching.
    const stillConflicts = store.open(biryaniModel, 'library:biryani-id', T0)
    expect(stillConflicts).toEqual({
      status: 'conflict',
      conflict: { planKey: 'library:kadai-id', title: 'Kadai Paneer', state: 'active' },
    })
    expect(store.getState()).toEqual(before)
  })
})
