import * as engine from './engine'
import type { OpenResult } from './engine'
import type { CookingModel, CookingSession, Rejected } from './types'

/**
 * The session store: pure logic over an injected storage, same shape as
 * `library/store.ts` (plan §G/§K5 "existing pattern... no Zustand"). One session at
 * most, under `abc-cook:session:v1` (plan §C9). `createSessionStore` is the only place
 * that touches `storage`; `getState`/`subscribe` give `useSession.ts` a
 * `useSyncExternalStore`-compatible source with zero new dependencies.
 */

const STORAGE_KEY = 'abc-cook:session:v1'

/** The subset of the `Storage` interface this module needs — real `localStorage`
 * satisfies it, and tests inject an in-memory fake (same contract as `library/store.ts`). */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface StoredShape {
  version: 1
  session: CookingSession | null
}

/**
 * One dispatched action per §E, each carrying the `CookingModel` for the plan it
 * applies to (the store itself is model-agnostic — `CookingModel` is built once per
 * plan by `deriveCookingModel` and never persisted, plan §D — so every call site that
 * has a model already at hand passes it through here rather than the store re-deriving
 * or caching one). `touch`/`end` need no model: neither reads plan/graph data.
 */
export type SessionAction =
  | { type: 'start'; model: CookingModel; planKey: string; now: number; recipeTitle?: string }
  | { type: 'startNode'; model: CookingModel; nodeId: string; now: number }
  | { type: 'markDone'; model: CookingModel; nodeId: string; now: number }
  | { type: 'acknowledge'; model: CookingModel; now: number }
  | { type: 'skip'; model: CookingModel; nodeId: string; now: number }
  | { type: 'extend'; model: CookingModel; nodeId: string; now: number }
  | { type: 'undo'; model: CookingModel; now: number }
  | { type: 'leave'; model: CookingModel; now: number }
  | { type: 'resume'; model: CookingModel; now: number }
  | { type: 'touch'; now: number }
  | { type: 'end'; now: number }

export type DispatchResult = { ok: true; session: CookingSession | null } | Rejected

export interface SessionStore {
  getState(): CookingSession | null
  subscribe(listener: () => void): () => void
  dispatch(action: SessionAction): DispatchResult
  /** `open(payload, now)` (plan §E) — read-only, reports the currently stored session
   * (if any) against `model`/`planKey` without mutating or persisting anything. */
  open(model: CookingModel, planKey: string, now: number): OpenResult
}

/**
 * Builds a `SessionStore` backed by `storage` (`window.localStorage` by default) and
 * reads it once, synchronously, at construction — same discipline as `createLibrary`.
 *
 * `now` has no default (unlike `createLibrary`'s `now: () => Date = () => new Date()`)
 * — it is used only for the salvage-key timestamp (`readSession`), but a default here
 * would put a literal `Date.now` reference in this file, and plan exit criterion 3 is
 * repo-wide (`grep -n "Date.now" apps/web/src/cooking` returns only `useSession.ts`),
 * not just engine/model/select. The caller that constructs the store (`useSession.ts`)
 * already has a clock to pass.
 */
export function createSessionStore(storage: StorageLike = window.localStorage, now: () => number): SessionStore {
  let session: CookingSession | null = readSession(storage, now)
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const listener of listeners) listener()
  }

  function persist(next: CookingSession | null): DispatchResult {
    const written = writeSession(storage, next)
    if (!written.ok) return written
    session = next
    notify()
    return { ok: true, session }
  }

  function requireSession(): CookingSession | Rejected {
    return session ?? reject('no_session')
  }

  function applying(result: CookingSession | Rejected): DispatchResult {
    return engine.isRejected(result) ? result : persist(result)
  }

  return {
    getState: () => session,

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    open(model, planKey, nowMs) {
      return engine.open(session, model, planKey, nowMs)
    },

    dispatch(action: SessionAction): DispatchResult {
      switch (action.type) {
        case 'start':
          return applying(engine.start(session, action.model, action.planKey, action.now, action.recipeTitle))
        case 'end':
          return persist(engine.end())
        case 'touch':
          return session == null ? { ok: true, session: null } : persist(engine.touch(session, action.now))
        case 'startNode': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.startNode(current, action.model, action.nodeId, action.now))
        }
        case 'markDone': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.markDone(current, action.model, action.nodeId, action.now))
        }
        case 'acknowledge': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.acknowledge(current, action.model, action.now))
        }
        case 'skip': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.skip(current, action.model, action.nodeId, action.now))
        }
        case 'extend': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.extend(current, action.model, action.nodeId, action.now))
        }
        case 'undo': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.undo(current, action.model, action.now))
        }
        case 'leave': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.leave(current, action.model, action.now))
        }
        case 'resume': {
          const current = requireSession()
          return engine.isRejected(current) ? current : applying(engine.resume(current, action.model, action.now))
        }
      }
    },
  }
}

function reject(reason: string): Rejected {
  return { ok: false, reason }
}

/** Reads and validates the stored session. Tolerant by design (CLAUDE.md: the app must
 * never fail to show a recipe) — an unreadable value degrades to no session rather than
 * throwing, and is preserved under a timestamped key rather than dropped (same pattern
 * as `library/store.ts`). A version bump is salvage + none — no in-place migration in
 * v1 (plan §C9: "a session is minutes-to-hours of state, not a library"). */
function readSession(storage: StorageLike, now: () => number): CookingSession | null {
  const raw = safeGetItem(storage, STORAGE_KEY)
  if (raw == null) return null

  const parsed = tryParseJson(raw)
  if (!isStoredShape(parsed)) {
    salvageUnreadable(storage, raw, now)
    return null
  }

  return parsed.session
}

function writeSession(storage: StorageLike, session: CookingSession | null): { ok: true } | Rejected {
  const body: StoredShape = { version: 1, session }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(body))
    return { ok: true }
  } catch {
    return reject('storage_write_failed')
  }
}

function salvageUnreadable(storage: StorageLike, raw: string, now: () => number): void {
  try {
    storage.setItem(`${STORAGE_KEY}:unreadable-${now()}`, raw)
  } catch {
    // Storage itself is unusable (quota/private mode) — nothing more to do; the read
    // still degrades to no session rather than throwing.
  }
}

function safeGetItem(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredShape(value: unknown): value is StoredShape {
  if (!isPlainObject(value) || value.version !== 1) return false
  return value.session === null || isSessionShape(value.session)
}

function isSessionShape(value: unknown): value is CookingSession {
  if (!isPlainObject(value)) return false
  return (
    value.version === 1 &&
    typeof value.planKey === 'string' &&
    typeof value.graphId === 'string' &&
    typeof value.startedAt === 'number' &&
    typeof value.lastSeenAt === 'number' &&
    isPlainObject(value.nodes)
  )
}
