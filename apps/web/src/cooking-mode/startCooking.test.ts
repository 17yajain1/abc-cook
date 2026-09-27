import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { startIfNone } from './startCooking'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import { deriveCookingModel } from '@/cooking/model'
import { createSessionStore, type StorageLike } from '@/cooking/store'

/**
 * P1 #6 (orientation/recovery plan §F "One start path"): `startCooking.ts` is the only
 * unit in this feature `App.tsx` (untested) delegates its branching to — this file is
 * the regression test for "one start screen" the plan calls out, since there is no
 * jsdom/`@testing-library/react` in this repo to drive `App.tsx` itself.
 */

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

/** A storage whose every write rejects — simulates `storage_write_failed` without
 * touching real `localStorage` quotas. */
class FailingStorage implements StorageLike {
  getItem(): string | null {
    return null
  }
  setItem(): void {
    throw new Error('quota exceeded')
  }
  removeItem(): void {}
}

describe('startIfNone — P1 #6 §C5', () => {
  it('none: starts a session — stored, and the first view is task, not entry', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, () => T0)

    const result = startIfNone(store, model, 'server:kadai', T0, 'Kadai Paneer')

    expect(result.ok).toBe(true)
    expect(store.getState()).not.toBeNull()
    expect(store.getState()?.planKey).toBe('server:kadai')
    // The freshly started session opens straight onto the first node, not an entry
    // screen with nothing yet started.
    const opened = store.open(model, 'server:kadai', T0)
    expect(opened.status).toBe('ok')
  })

  it('ok: an existing live session for the same plan is left completely untouched (resume)', () => {
    const model = deriveCookingModel(KADAI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, () => T0)
    store.dispatch({ type: 'start', model, planKey: 'server:kadai', now: T0, recipeTitle: 'Kadai Paneer' })
    store.dispatch({ type: 'markDone', model, nodeId: 'chop_onion', now: T0 + 60_000 })
    const before = store.getState()

    const result = startIfNone(store, model, 'server:kadai', T0 + 120_000, 'Kadai Paneer')

    expect(result).toEqual({ ok: true, session: before })
    expect(store.getState()).toEqual(before) // byte-for-byte unchanged, no re-start
  })

  it('conflict: a session for a different plan is left byte-for-byte unchanged, never replaced or cleared', () => {
    const kadaiModel = deriveCookingModel(KADAI)
    const biryaniModel = deriveCookingModel(BIRYANI)
    const storage = new MemoryStorage()
    const store = createSessionStore(storage, () => T0)
    store.dispatch({ type: 'start', model: kadaiModel, planKey: 'server:kadai', now: T0 })
    const before = store.getState()

    const result = startIfNone(store, biryaniModel, 'server:biryani', T0 + 60_000, 'Chicken Biryani')

    expect(result).toEqual({ ok: true, session: before })
    expect(store.getState()).toEqual(before)
    expect(store.getState()?.planKey).toBe('server:kadai')
  })

  it('write failure: returns the rejection, and the session stays null — the entry screen is the fallback', () => {
    const model = deriveCookingModel(KADAI)
    const store = createSessionStore(new FailingStorage(), () => T0)

    const result = startIfNone(store, model, 'server:kadai', T0, 'Kadai Paneer')

    expect(result).toEqual({ ok: false, reason: 'storage_write_failed' })
    expect(store.getState()).toBeNull()
  })
})
