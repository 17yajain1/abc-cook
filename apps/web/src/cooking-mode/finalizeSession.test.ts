import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { completionEventFor, finishCooking, replaceSession, type SessionFinished } from './finalizeSession'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { deriveCookingModel } from '@/cooking/model'
import { createSessionStore, type SessionStore, type StorageLike } from '@/cooking/store'
import { createOutbox } from '@/metrics/outbox'

/**
 * M5 completion metric: `finalizeSession.ts` is where "confirmed finished" is decided.
 * `CookingModeScreen` has no test coverage (no jsdom), so every counting rule is pinned
 * here instead.
 */

const MAGGI = maggi2min as RecipePlanResponse
const KADAI = kadaiPaneer as RecipePlanResponse
const MAGGI_MODEL = deriveCookingModel(MAGGI)
const KADAI_MODEL = deriveCookingModel(KADAI)
const T0 = 1_700_000_000_000
const m = (min: number) => min * 60_000
const SINK_AT = T0 + m(7)

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
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

/** Reads normally, but every write throws while `failing` is true. */
class FlakyStorage extends MemoryStorage {
  failing = false
  override setItem(key: string, value: string): void {
    if (this.failing) throw new Error('quota exceeded')
    super.setItem(key, value)
  }
}

function newStore(storage: StorageLike = new MemoryStorage()): SessionStore {
  return createSessionStore(storage, () => T0)
}

function collector() {
  const events: SessionFinished[] = []
  return { events, emit: (e: SessionFinished) => void events.push(e) }
}

/** Starts Maggi and walks it to the sink being done (finishedAt = SINK_AT), unconfirmed. */
function runToSink(store: SessionStore, planKey = 'server:maggi'): void {
  const model = MAGGI_MODEL
  const step = (action: Parameters<SessionStore['dispatch']>[0]) => {
    expect(store.dispatch(action).ok).toBe(true)
  }
  step({ type: 'start', model, planKey, now: T0, recipeTitle: 'Maggi' })
  step({ type: 'startNode', model, nodeId: 'boil_water', now: T0 })
  step({ type: 'markDone', model, nodeId: 'boil_water', now: T0 + m(3) })
  step({ type: 'markDone', model, nodeId: 'add_noodles_masala', now: T0 + m(4) })
  step({ type: 'startNode', model, nodeId: 'cook_noodles', now: T0 + m(4) })
  step({ type: 'acknowledge', model, now: T0 + m(6) })
  step({ type: 'markDone', model, nodeId: 'serve', now: SINK_AT })
}

describe('completionEventFor', () => {
  it('is null for no session and for an unfinished session', () => {
    expect(completionEventFor(null, 'finish', SINK_AT)).toBeNull()

    const store = newStore()
    store.dispatch({ type: 'start', model: MAGGI_MODEL, planKey: 'server:maggi', now: T0 })
    expect(completionEventFor(store.getState(), 'finish', SINK_AT)).toBeNull()
  })

  it('carries identity and timestamps only — no title or graph content', () => {
    const store = newStore()
    runToSink(store)

    expect(completionEventFor(store.getState(), 'finish', SINK_AT + 5000)).toEqual({
      event_id: `server:maggi@${T0}`,
      kind: 'session_finished',
      plan_key: 'server:maggi',
      started_at: T0,
      finished_at: SINK_AT,
      confirmed_at: SINK_AT + 5000,
      via: 'finish',
    })
  })
})

describe('finishCooking', () => {
  it('successful completion: emits exactly one event (via finish) and clears the session', () => {
    const store = newStore()
    const { events, emit } = collector()
    runToSink(store)

    const result = finishCooking(store, emit, SINK_AT + 3000)

    expect(result.ok).toBe(true)
    expect(store.getState()).toBeNull()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event_id: `server:maggi@${T0}`, via: 'finish', finished_at: SINK_AT })
  })

  it('undo before confirmation: nothing is emitted', () => {
    const store = newStore()
    const { events, emit } = collector()
    runToSink(store)
    expect(store.dispatch({ type: 'undo', model: MAGGI_MODEL, now: SINK_AT + 1000 }).ok).toBe(true)
    expect(store.getState()?.finishedAt).toBeNull()
    expect(completionEventFor(store.getState(), 'finish', SINK_AT + 2000)).toBeNull()

    finishCooking(store, emit, SINK_AT + 2000)

    expect(events).toEqual([])
  })

  it('abandonment: ending a mid-cook session emits nothing', () => {
    const store = newStore()
    const { events, emit } = collector()
    store.dispatch({ type: 'start', model: MAGGI_MODEL, planKey: 'server:maggi', now: T0 })
    store.dispatch({ type: 'startNode', model: MAGGI_MODEL, nodeId: 'boil_water', now: T0 })

    // The `end` action ("Start again" / "End the cook") goes straight to the store —
    // it never passes through `finishCooking`, so it can never count.
    expect(store.dispatch({ type: 'end', now: T0 + m(2) }).ok).toBe(true)
    expect(events).toEqual([])

    // And `finishCooking` on an unfinished session ends it but emits nothing.
    store.dispatch({ type: 'start', model: MAGGI_MODEL, planKey: 'server:maggi', now: T0 })
    expect(finishCooking(store, emit, T0 + m(2)).ok).toBe(true)
    expect(store.getState()).toBeNull()
    expect(events).toEqual([])
  })

  it('duplicates: a second call emits nothing, and re-emitting into the outbox stores one entry', () => {
    const store = newStore()
    const { events, emit } = collector()
    runToSink(store)

    finishCooking(store, emit, SINK_AT + 1000)
    finishCooking(store, emit, SINK_AT + 1100)

    expect(events).toHaveLength(1)

    const outbox = createOutbox(new MemoryStorage(), () => 1)
    outbox.append(events[0])
    outbox.append(events[0])
    expect(outbox.pending()).toHaveLength(1)
  })

  it('end write fails: nothing emitted, session stays finished; a retry emits once', () => {
    const storage = new FlakyStorage()
    const store = newStore(storage)
    const { events, emit } = collector()
    runToSink(store)

    storage.failing = true
    expect(finishCooking(store, emit, SINK_AT + 1000)).toEqual({ ok: false, reason: 'storage_write_failed' })
    expect(events).toEqual([])
    expect(store.getState()?.finishedAt).toBe(SINK_AT)

    storage.failing = false
    expect(finishCooking(store, emit, SINK_AT + 2000).ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].event_id).toBe(`server:maggi@${T0}`)
  })

  it('emit throws: finishing still succeeds, so onFinish is unaffected', () => {
    const store = newStore()
    runToSink(store)

    const result = finishCooking(
      store,
      () => {
        throw new Error('outbox exploded')
      },
      SINK_AT + 1000,
    )

    expect(result.ok).toBe(true)
    expect(store.getState()).toBeNull()
  })

  it('outbox write fails: finishing still succeeds and the outbox stays empty', () => {
    const store = newStore()
    runToSink(store)
    const outboxStorage = new FlakyStorage()
    outboxStorage.failing = true
    const outbox = createOutbox(outboxStorage, () => 1)

    const result = finishCooking(store, (e) => void outbox.append(e), SINK_AT + 1000)

    expect(result.ok).toBe(true)
    expect(store.getState()).toBeNull()
    expect(outbox.pending()).toEqual([])
  })
})

describe('replaceSession', () => {
  it('replacing a finished session emits one event for it (via replace) and starts the new one', () => {
    const store = newStore()
    const { events, emit } = collector()
    runToSink(store, 'server:maggi')

    const result = replaceSession(store, KADAI_MODEL, 'server:kadai', 'server:maggi', 'Kadai Paneer', emit, SINK_AT + m(30))

    expect(result.ok).toBe(true)
    expect(store.getState()?.planKey).toBe('server:kadai')
    expect(events).toEqual([
      {
        event_id: `server:maggi@${T0}`,
        kind: 'session_finished',
        plan_key: 'server:maggi',
        started_at: T0,
        finished_at: SINK_AT,
        confirmed_at: SINK_AT + m(30),
        via: 'replace',
      },
    ])
  })

  it('replacing an unfinished session emits nothing', () => {
    const store = newStore()
    const { events, emit } = collector()
    store.dispatch({ type: 'start', model: MAGGI_MODEL, planKey: 'server:maggi', now: T0 })

    const result = replaceSession(store, KADAI_MODEL, 'server:kadai', 'server:maggi', 'Kadai Paneer', emit, T0 + m(5))

    expect(result.ok).toBe(true)
    expect(store.getState()?.planKey).toBe('server:kadai')
    expect(events).toEqual([])
  })

  it('a conflict_changed rejection emits nothing and leaves the finished session in place', () => {
    const store = newStore()
    const { events, emit } = collector()
    runToSink(store, 'server:maggi')

    const result = replaceSession(store, KADAI_MODEL, 'server:kadai', 'server:other', 'Kadai Paneer', emit, SINK_AT + m(30))

    expect(result).toEqual({ ok: false, reason: 'conflict_changed' })
    expect(events).toEqual([])
    expect(store.getState()?.planKey).toBe('server:maggi')
    expect(store.getState()?.finishedAt).toBe(SINK_AT)
  })

  it('a storage write failure emits nothing; the retry after recovery emits once', () => {
    const storage = new FlakyStorage()
    const store = newStore(storage)
    const { events, emit } = collector()
    runToSink(store, 'server:maggi')

    storage.failing = true
    const failed = replaceSession(store, KADAI_MODEL, 'server:kadai', 'server:maggi', 'Kadai Paneer', emit, SINK_AT + m(30))
    expect(failed).toEqual({ ok: false, reason: 'storage_write_failed' })
    expect(events).toEqual([])

    storage.failing = false
    expect(replaceSession(store, KADAI_MODEL, 'server:kadai', 'server:maggi', 'Kadai Paneer', emit, SINK_AT + m(31)).ok).toBe(true)
    expect(events).toHaveLength(1)
  })

  it('finish and replace of the same session share one event_id, so the outbox counts it once', () => {
    const outbox = createOutbox(new MemoryStorage(), () => 1)
    const emit = (e: SessionFinished) => void outbox.append(e)
    const finishStore = newStore()
    runToSink(finishStore)
    const replaceStore = newStore()
    runToSink(replaceStore)

    finishCooking(finishStore, emit, SINK_AT + 1000)
    replaceSession(replaceStore, KADAI_MODEL, 'server:kadai', 'server:maggi', 'Kadai Paneer', emit, SINK_AT + 2000)

    expect(outbox.pending()).toHaveLength(1)
  })
})
