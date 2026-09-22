import { EXTEND_MS } from './constants'
import { current, handover, lifecycle, skipAllowed } from './select'
import type { CookingModel, CookingSession, NodeState, Rejected, SessionLifecycle, Transition, TransitionEntry } from './types'

/**
 * The session reducer — every action in plan §E as `(session, model, now) -> session |
 * Rejected`, never throwing. `now` is a parameter everywhere; nothing in this file reads
 * `Date.now()` (that only happens in `useSession.ts` — CLAUDE.md, M3.3 exit criterion 3).
 *
 * Rejection reasons (the `Rejected.reason` vocabulary this file produces):
 * `session_exists`, `session_stale`, `not_left`, `not_current`, `hands_on_node`,
 * `hands_off_node`, `not_pending`, `not_running`, `no_handover`, `no_alternative`,
 * `nothing_to_undo`. Never thrown, never a bare string message. (`session_finished` is
 * producible only by `leave`, below — `resume` no longer produces it; see the
 * 2026-09-22 audit clarification on `resume`.)
 *
 * Lifecycle boundary (plan §M1, the CP2 brief's "IMPORTANT lifecycle boundary", and the
 * 2026-09-22 semantic audit that settled two ambiguities the first pass had resolved by
 * inference rather than by an explicit line of §E — both clarifications are also
 * recorded in the saved plan, § *Audit clarifications, 2026-09-22*):
 *
 * - `finished`/`stale` precedence lives in `select.ts`'s `lifecycle()` and is never
 *   recreated here. `undo` is deliberately **not** gated by it — §E's own `undo` row
 *   states its effect as "restores `prev`; clears `finishedAt` if it was the sink",
 *   which presupposes `undo` still runs the instant after `finishedAt` was just set;
 *   gating `undo` on `lifecycle() === 'active'` would make that documented effect
 *   unreachable. `markDone`/`startNode`/`acknowledge`/`skip`/`extend`/`touch` are
 *   likewise ungated — every one of their §E precondition columns is stated purely in
 *   node-state terms (`current`, `running`, a pending handover, `skipAllowed`), with no
 *   lifecycle clause, and the caller (`useSession.ts`/M3.4) is responsible for not
 *   dispatching those once `lifecycle() !== 'active'` (C6: "the engine reports it...
 *   M3.4 offers Continue / Start again").
 * - `open` reports `lifecycle()` (§E: "returns it (+ stale flag)") without gating on it.
 * - `leave`'s only precondition in §E is the prose "session live", never defined
 *   elsewhere in the plan. **Definition (2026-09-22 audit clarification): "session
 *   live" ⇔ `lifecycle(model, session, now) === 'active'`.** There is nothing to
 *   "leave" once finished, and a stale reopen must go through Continue/Start again
 *   before any other action, leave included — so `leave` calls `lifecycle()` directly.
 * - `resume`'s only precondition in §E is `leftAt != null` — nothing more. An earlier
 *   revision of this file additionally rejected a `finished` lifecycle on `resume`;
 *   that was not authorized by any line of §E/§K5/§L/§M and has been removed
 *   (2026-09-22 audit clarification). See `resume`'s own doc comment below for why this
 *   is safe: `lifecycle()` checks `finishedAt` first, unconditionally, so clearing
 *   `leftAt` on a finished session cannot resurrect it.
 */

function reject(reason: string): Rejected {
  return { ok: false, reason }
}

function isRejected(value: CookingSession | Rejected): value is Rejected {
  return (value as Rejected).ok === false
}

// ---------------------------------------------------------------------------
// open / start / end — entering and leaving a plan (plan §E, §B15, §C9)
// ---------------------------------------------------------------------------

export type OpenResult =
  | { status: 'none' }
  | { status: 'conflict' }
  | { status: 'ok'; session: CookingSession; lifecycle: SessionLifecycle }

/**
 * `open(payload, now)` (plan §E/§C9/§B15). Read-only — never mutates or persists.
 * `stored` is whatever the store already holds (there is at most one session, C9).
 * `none` when nothing is stored; `conflict` when a session exists for a *different*
 * plan (planKey mismatch) or fails the defensive `graphId` check (C9); otherwise `ok`
 * with `lifecycle` computed by `select.ts`'s `lifecycle()` — never reimplemented here,
 * per the lifecycle boundary above.
 */
export function open(stored: CookingSession | null, model: CookingModel, planKey: string, now: number): OpenResult {
  if (stored == null) return { status: 'none' }
  if (stored.planKey !== planKey || stored.graphId !== model.graphId) return { status: 'conflict' }
  return { status: 'ok', session: stored, lifecycle: lifecycle(model, stored, now) }
}

/** `start(now)` (plan §E): only when no session is stored (or after `end`) — one active
 * session at a time (§B15). Every node starts `pending`. */
export function start(
  existing: CookingSession | null,
  model: CookingModel,
  planKey: string,
  now: number,
): CookingSession | Rejected {
  if (existing != null) return reject('session_exists')
  const nodes: Record<string, NodeState> = {}
  for (const id of model.order) nodes[id] = { state: 'pending' }
  return {
    version: 1,
    planKey,
    graphId: model.graphId,
    startedAt: now,
    lastSeenAt: now,
    leftAt: null,
    finishedAt: null,
    nodes,
    lastTransition: null,
  }
}

/** `end(now)` (plan §E): the only destructive action — clears the stored session.
 * Always allowed, regardless of lifecycle (a finished or stale session must still be
 * endable — it is the second half of "Start again"). */
export function end(): null {
  return null
}

// ---------------------------------------------------------------------------
// startNode — plan §E / §C3 / §K2
// ---------------------------------------------------------------------------

/** `startNode(id, now)` (plan §E/§C4/§K2): the one explicit action that creates a
 * hands-off node's timer. Rejected for any node that is not `current`, for a hands-on
 * node (it never has a timer), or for one already running/done. */
export function startNode(session: CookingSession, model: CookingModel, nodeId: string, now: number): CookingSession | Rejected {
  if (current(model, session) !== nodeId) return reject('not_current')
  const info = model.nodes[nodeId]
  if (info.occupiesCook) return reject('hands_on_node')
  const state = session.nodes[nodeId]
  if (state.state !== 'pending') return reject('not_pending')
  return {
    ...session,
    nodes: {
      ...session.nodes,
      [nodeId]: { state: 'running', startedAt: now, endsAt: now + info.durationTypical * 60_000, extendedMs: 0 },
    },
    // §E: "lastTransition = null" — starting a node clears undo history (§L "undo
    // allowed iff no startNode has happened since").
    lastTransition: null,
  }
}

// ---------------------------------------------------------------------------
// markDone / acknowledge — plan §E / §C3 / §C5
// ---------------------------------------------------------------------------

/** `markDone(id, now)` (plan §E/§C3): a hands-on node must be `current`; a hands-off
 * node must be `running` (at any time — the cue governs, the clock is advisory, §C4).
 * Sets `finishedAt` when `id` is the sink. */
export function markDone(session: CookingSession, model: CookingModel, nodeId: string, now: number): CookingSession | Rejected {
  const info = model.nodes[nodeId]
  const prev = session.nodes[nodeId]

  if (info.occupiesCook) {
    if (current(model, session) !== nodeId) return reject('not_current')
  } else if (prev.state !== 'running') {
    return reject('not_running')
  }

  const endsAt = prev.state === 'running' ? prev.endsAt : null
  const transition: Transition = { kind: 'done', at: now, entries: [{ nodeId, prev }] }
  return {
    ...session,
    nodes: { ...session.nodes, [nodeId]: { state: 'done', at: now, endsAt } },
    lastTransition: transition,
    finishedAt: info.isSink ? now : session.finishedAt,
  }
}

/** `acknowledge(now)` (plan §E/§C5/§L2): `markDone` for every producer named by the
 * pending handover, in execution order, as one multi-entry transition (§L1 — supersedes
 * the single-entry `Transition` shape so `undo` can reverse all of them or none). */
export function acknowledge(session: CookingSession, model: CookingModel, now: number): CookingSession | Rejected {
  const h = handover(model, session, now)
  if (h == null) return reject('no_handover')

  const entries: TransitionEntry[] = []
  let nodes = { ...session.nodes }
  let finishedAt = session.finishedAt

  for (const producerId of h.producers) {
    const prev = nodes[producerId]
    entries.push({ nodeId: producerId, prev })
    const endsAt = prev.state === 'running' ? prev.endsAt : null
    nodes = { ...nodes, [producerId]: { state: 'done', at: now, endsAt } }
    if (model.nodes[producerId].isSink) finishedAt = now
  }

  return { ...session, nodes, lastTransition: { kind: 'acknowledge', at: now, entries }, finishedAt }
}

// ---------------------------------------------------------------------------
// skip / extend / undo — plan §E / §B12 / §F9 / §C4 / §C8 / §L1
// ---------------------------------------------------------------------------

/** `skip(id, now)` (plan §E/§B12/§F9): hands-on, `current`, and only when
 * `skipAllowed` — reused verbatim from `select.ts` rather than reimplementing its
 * "another non-deferred executable node exists" clause. */
export function skip(session: CookingSession, model: CookingModel, nodeId: string, now: number): CookingSession | Rejected {
  if (current(model, session) !== nodeId) return reject('not_current')
  const info = model.nodes[nodeId]
  if (!info.occupiesCook) return reject('hands_off_node')
  if (!skipAllowed(model, session)) return reject('no_alternative')

  const prev = session.nodes[nodeId]
  return {
    ...session,
    nodes: { ...session.nodes, [nodeId]: { state: 'deferred', at: now } },
    lastTransition: { kind: 'skip', at: now, entries: [{ nodeId, prev }] },
  }
}

/** `extend(id, now)` (plan §E/§C4/§K5 "Give it longer"): adds `EXTEND_MS` whether or
 * not the node has expired; does not touch `lastTransition` (§E lists no undo effect —
 * only `done`/`skip`/`acknowledge` do). Per §C4's own wording, the increment is a fixed
 * `EXTEND_MS` added to the *existing* `endsAt` — not `now + EXTEND_MS` — so neither
 * `model` nor `now` is read; both stay in the signature only for parity with every
 * other action in §E, which is `(session, model, ..., now)` throughout. */
export function extend(session: CookingSession, _model: CookingModel, nodeId: string, _now: number): CookingSession | Rejected {
  const prev = session.nodes[nodeId]
  if (prev.state !== 'running') return reject('not_running')
  return {
    ...session,
    nodes: {
      ...session.nodes,
      [nodeId]: { ...prev, endsAt: prev.endsAt + EXTEND_MS, extendedMs: prev.extendedMs + EXTEND_MS },
    },
  }
}

/** `undo(now)` (plan §E/§L1): reverses every entry of `lastTransition` — one
 * `done`/`skip`/`acknowledge` action, all its nodes or none — then clears
 * `lastTransition` (so a second `undo` rejects, and so does one after a `startNode`,
 * which already clears it). Clears `finishedAt` when the sink's completion is among the
 * entries being undone. `now` is unused: restoring `prev` verbatim, including its own
 * timestamp, is the entire effect — kept as a parameter only for signature parity with
 * every other action in §E. */
export function undo(session: CookingSession, model: CookingModel, _now: number): CookingSession | Rejected {
  const t = session.lastTransition
  if (t == null) return reject('nothing_to_undo')

  let nodes = { ...session.nodes }
  let finishedAt = session.finishedAt
  for (const entry of t.entries) {
    nodes = { ...nodes, [entry.nodeId]: entry.prev }
    if (model.nodes[entry.nodeId].isSink && entry.prev.state !== 'done') finishedAt = null
  }

  return { ...session, nodes, lastTransition: null, finishedAt }
}

// ---------------------------------------------------------------------------
// leave / resume / touch — plan §E / §C6
// ---------------------------------------------------------------------------

/** `leave(now)` (plan §E/§C6): §E's precondition is "session live", defined
 * (2026-09-22 audit clarification, above) as `lifecycle(model, session, now) ===
 * 'active'` — there is nothing to "leave" once finished, and a stale reopen must go
 * through Continue/Start again before any other action, leave included. */
export function leave(session: CookingSession, model: CookingModel, now: number): CookingSession | Rejected {
  const lc = lifecycle(model, session, now)
  if (lc !== 'active') return reject(`session_${lc}`)
  return { ...session, leftAt: now, lastSeenAt: now }
}

/** `resume(now)` (plan §E/§C6/2026-09-22 audit clarification): the literal §E
 * precondition is exactly `leftAt != null` — nothing more. An earlier revision of this
 * function additionally rejected a `finished` lifecycle; that was not authorized by any
 * line of §E/§K5/§L/§M and has been removed. `resume` succeeds from a `stale` reading
 * (it is the engine action behind the plan's own explicit "Continue" choice, C6: "a
 * stale session is never resumed silently... offers Continue / Start again" — note
 * *silently*: an explicit, user-confirmed Continue is not the silent/automatic
 * resumption §K5's stale row forbids) and now also from a `finished` one: clearing
 * `leftAt` on a finished session is inert, because `lifecycle()` (§M1) checks
 * `session.finishedAt != null` first, unconditionally, before it would ever look at
 * `leftAt` — so `resume` cannot resurrect a finished session regardless of whether it is
 * allowed to run. `model` is unused (kept for signature parity with every other action
 * in §E, same as `extend`/`undo`) now that there is no `lifecycle()` call here. */
export function resume(session: CookingSession, _model: CookingModel, now: number): CookingSession | Rejected {
  if (session.leftAt == null) return reject('not_left')
  return { ...session, leftAt: null, lastSeenAt: now }
}

/** `touch(now)` (plan §E/§C6): no precondition — always allowed. Also the recovery
 * action for a *silent* pick-up gone stale (`leftAt` never set — C6's other stale path),
 * where `resume` does not apply because its own precondition (`leftAt != null`) fails. */
export function touch(session: CookingSession, now: number): CookingSession {
  return { ...session, lastSeenAt: now }
}

export { isRejected }
