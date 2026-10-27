import { useEffect, useState, useSyncExternalStore } from 'react'

import type { SessionStore, StorageLike } from '@/cooking/store'
import type { CookingSession } from '@/cooking/types'

import type { CookingNotice, CookingSignals } from './cookingSignals'
import { cookingSignals } from './signals'

/**
 * PR 2 CP4: the timer-end sound and vibration, once per timer, across the whole app,
 * remembered across reloads. Read from the stored session only (the `endsAt`s, no model),
 * so a cook who left still hears the timer on Home or the recipe page. The banner itself
 * reads session state, which is why it survives reloads; this only rings.
 *
 * Which ends have rung lives in its own `localStorage` entry, never in the session, so the
 * engine and the store are untouched. A key (`nodeId@endsAt`) is written before the sound
 * plays, so a reload, a second mount or StrictMode never rings it again; "+5 min" gives a
 * new `endsAt`, so the new end rings once.
 */

export const RANG_KEY = 'abc-cook.timer-rang'
/** A timer that ended longer ago than this when first seen (the page wasn't open) never
 * rings; its banner says "Timer ended N min ago" instead. */
export const RING_WINDOW_MS = 60_000
/** iPhone has no `navigator.vibrate`: nothing happens there, no error, no message. */
export const VIBRATE_PATTERN = [300, 150, 300]

export interface RangState {
  /** The session the keys belong to: `planKey@startedAt`. */
  session: string
  keys: string[]
}

function sessionIdOf(session: CookingSession): string {
  return `${session.planKey}@${session.startedAt}`
}

/** Pure: the timers to ring at `now`, and the rang set to store. A running timer rings when
 * its end has passed, under `RING_WINDOW_MS` ago, and its key isn't in the set. A new
 * session id starts a new set; no session clears it (`next: null`). */
export function shouldRing(
  rang: RangState | null,
  session: CookingSession | null,
  now: number,
): { ring: CookingNotice[]; next: RangState | null } {
  if (session == null) return { ring: [], next: null }
  const id = sessionIdOf(session)
  const keys = rang?.session === id ? rang.keys : []
  const ring: CookingNotice[] = []
  for (const [nodeId, s] of Object.entries(session.nodes)) {
    if (s.state !== 'running' || s.endsAt > now || now - s.endsAt >= RING_WINDOW_MS) continue
    if (keys.includes(`${nodeId}@${s.endsAt}`)) continue
    ring.push({ kind: 'timerEnded', nodeId, endsAt: s.endsAt })
  }
  return { ring, next: { session: id, keys: [...keys, ...ring.map((n) => `${n.nodeId}@${n.endsAt}`)] } }
}

export interface RangStore {
  read(): RangState | null
  write(state: RangState | null): void
}

function isRangState(value: unknown): value is RangState {
  if (value == null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.session === 'string' && Array.isArray(v.keys) && v.keys.every((k) => typeof k === 'string')
}

/** The rang set in `storage`, falling back to memory for the rest of the page load once
 * storage can't be read or written (like the stores, never blocking the cook). The worst
 * case is one repeat ring after a reload. */
export function createRangStore(storage: StorageLike | null): RangStore {
  let memory: RangState | null = null
  let usable = storage != null
  return {
    read() {
      if (!usable) return memory
      try {
        const raw = storage!.getItem(RANG_KEY)
        if (raw == null) return null
        const parsed: unknown = JSON.parse(raw)
        return isRangState(parsed) ? parsed : null
      } catch {
        usable = false
        return memory
      }
    },
    write(state) {
      memory = state
      if (!usable) return
      try {
        if (state == null) storage!.removeItem(RANG_KEY)
        else storage!.setItem(RANG_KEY, JSON.stringify(state))
      } catch {
        usable = false
      }
    },
  }
}

/** Checks the session against the rang set and rings what is due: one sound and one vibrate
 * however many timers ended in the same tick, and a `notify` for each. */
export function createTimerEndRinger(deps: {
  store: RangStore
  signals: Pick<CookingSignals, 'playSound' | 'vibrate' | 'notify'>
}): { check(session: CookingSession | null, now: number): void } {
  return {
    check(session, now) {
      const rang = deps.store.read()
      const { ring, next } = shouldRing(rang, session, now)
      if (JSON.stringify(next) !== JSON.stringify(rang)) deps.store.write(next)
      if (ring.length === 0) return
      deps.signals.playSound('timerEnd')
      deps.signals.vibrate(VIBRATE_PATTERN)
      for (const notice of ring) deps.signals.notify(notice)
    },
  }
}

function deviceStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

/**
 * Called once, in `App.tsx`, so it rings on any screen and can never ring twice. Checks
 * every second while some timer is running, and whenever the page becomes visible again.
 * Not unit-tested as a hook (no jsdom); `createTimerEndRinger` above is.
 */
export function useTimerEndSignals(store: SessionStore): void {
  const session = useSyncExternalStore(store.subscribe, store.getState)
  const [ringer] = useState(() => createTimerEndRinger({ store: createRangStore(deviceStorage()), signals: cookingSignals }))
  const anyRunning = session != null && Object.values(session.nodes).some((s) => s.state === 'running')

  useEffect(() => {
    const check = () => ringer.check(store.getState(), Date.now())
    check()
    document.addEventListener('visibilitychange', check)
    const id = anyRunning ? window.setInterval(check, 1000) : null
    return () => {
      document.removeEventListener('visibilitychange', check)
      if (id != null) window.clearInterval(id)
    }
  }, [ringer, store, session, anyRunning])
}
