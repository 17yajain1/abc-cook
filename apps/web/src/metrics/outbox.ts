/**
 * The M5 completion-metric outbox: a local, de-duplicated list of `session_finished`
 * events. Same shape as `library/store.ts` and `cooking/store.ts` — pure logic over an
 * injected storage, tolerant reads with salvage, writes that never throw.
 *
 * Deliberately NOT here: sending events to a server, marking them sent, and any event
 * kind other than `session_finished`. Those belong to M5's transport/Supabase plan, which
 * also owns the server-side `UNIQUE(event_id)`. The M5 metric counts distinct `event_id`s
 * (owner decision O5) — never rows, and never cooking-history records. This outbox alone
 * does not produce that metric.
 */

const STORAGE_KEY = 'abc-cook:events:v1'

/** The subset of the `Storage` interface this module needs. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type CompletionVia = 'finish' | 'replace'

/** A confirmed cooking-session completion. Minimal by design (owner decision O3): no
 * recipe title and no graph content. `event_id` is `${plan_key}@${started_at}`. */
export interface SessionFinished {
  event_id: string
  kind: 'session_finished'
  plan_key: string
  started_at: number
  finished_at: number
  confirmed_at: number
  via: CompletionVia
}

export type AppendResult = { ok: true; created: boolean } | { ok: false }

export interface Outbox {
  /** Idempotent on `event_id`: a duplicate is a no-op returning `created: false`. */
  append(event: SessionFinished): AppendResult
  /** Events not yet sent. Nothing marks events sent yet, so this is every stored event. */
  pending(): SessionFinished[]
}

interface StoredShape {
  version: 1
  events: SessionFinished[]
}

/** Builds an `Outbox` backed by `storage` and reads it once, synchronously. `now` is only
 * used for the salvage-key timestamp. */
export function createOutbox(
  storage: StorageLike = window.localStorage,
  now: () => number = () => Date.now(),
): Outbox {
  let events: SessionFinished[] = readEvents(storage, now)

  return {
    append(event) {
      if (events.some((e) => e.event_id === event.event_id)) return { ok: true, created: false }
      const next = [...events, event]
      if (!writeEvents(storage, next)) return { ok: false }
      events = next
      return { ok: true, created: true }
    },

    pending: () => [...events],
  }
}

/** Tolerant by design: every failure mode degrades to an empty outbox rather than
 * throwing, and unreadable data is preserved under a timestamped key rather than dropped. */
function readEvents(storage: StorageLike, now: () => number): SessionFinished[] {
  const raw = safeGetItem(storage, STORAGE_KEY)
  if (raw == null) return []

  const parsed = tryParseJson(raw)
  if (!isStoredShape(parsed)) {
    salvageUnreadable(storage, raw, now)
    return []
  }

  const seen = new Set<string>()
  return parsed.events.filter((e): e is SessionFinished => {
    if (!isSessionFinished(e) || seen.has(e.event_id)) return false
    seen.add(e.event_id)
    return true
  })
}

function writeEvents(storage: StorageLike, events: SessionFinished[]): boolean {
  const body: StoredShape = { version: 1, events }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(body))
    return true
  } catch {
    return false
  }
}

function salvageUnreadable(storage: StorageLike, raw: string, now: () => number): void {
  try {
    storage.setItem(`${STORAGE_KEY}:unreadable-${now()}`, raw)
  } catch {
    // Storage itself is unusable — the read still degrades to an empty outbox.
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

function isStoredShape(value: unknown): value is { version: 1; events: unknown[] } {
  return isPlainObject(value) && value.version === 1 && Array.isArray(value.events)
}

function isSessionFinished(value: unknown): value is SessionFinished {
  if (!isPlainObject(value)) return false
  return (
    typeof value.event_id === 'string' &&
    value.kind === 'session_finished' &&
    typeof value.plan_key === 'string' &&
    typeof value.started_at === 'number' &&
    typeof value.finished_at === 'number' &&
    typeof value.confirmed_at === 'number' &&
    (value.via === 'finish' || value.via === 'replace')
  )
}
