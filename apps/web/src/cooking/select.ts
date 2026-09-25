import { LONG_WAIT_MS, SESSION_BREAK_MS, staleThresholdMs } from './constants'
import type { CookingModel, CookingSession, ForeignSessionState, NodeState, Role, SessionLifecycle } from './types'

/**
 * Pure derivations over `(model, session, now)` — M3.3 plan §F. Nothing here is stored
 * on `CookingSession` (plan §D "what is deliberately not stored"): current node,
 * running set, handover, sitting index, remaining/overrun time, away class and the
 * stale flag are all recomputed on every evaluation, never persisted, never drifting.
 *
 * `now` is a parameter everywhere. Nothing in this file reads `Date.now()` — that only
 * happens in `useSession.ts` (CLAUDE.md's "Timers survive backgrounding" rule, and
 * M3.3 exit criterion 3).
 */

// ---------------------------------------------------------------------------
// Small state-shape helpers (not exported — internal narrowing only).
// ---------------------------------------------------------------------------

type RunningState = Extract<NodeState, { state: 'running' }>

function isRunning(state: NodeState): state is RunningState {
  return state.state === 'running'
}

function isExpiredRunning(session: CookingSession, now: number, nodeId: string): boolean {
  const s = session.nodes[nodeId]
  return isRunning(s) && now >= s.endsAt
}

/** `endsAt` of a running node, or `+Infinity` for one that isn't — safe as a min/sort
 * key without special-casing non-running nodes at every call site. */
function endsAtOf(session: CookingSession, nodeId: string): number {
  const s = session.nodes[nodeId]
  return isRunning(s) ? s.endsAt : Number.POSITIVE_INFINITY
}

/** A dependency is satisfied for `consumerReady` purposes iff it is `done`, or it is
 * hands-off, running and expired (plan §F3) — or, for the `requiredIfExpired` reading
 * (§F6), iff it is the node `assumeExpired` names, presumed expired regardless of its
 * actual state. */
function isDepSatisfied(
  model: CookingModel,
  session: CookingSession,
  now: number,
  depId: string,
  assumeExpired: string | null,
): boolean {
  if (depId === assumeExpired) return true
  const s = session.nodes[depId]
  if (s.state === 'done') return true
  return !model.nodes[depId].occupiesCook && isRunning(s) && now >= s.endsAt
}

function isConsumerReady(
  model: CookingModel,
  session: CookingSession,
  now: number,
  consumerId: string,
  assumeExpired: string | null = null,
): boolean {
  const s = session.nodes[consumerId]
  if (s.state !== 'pending' && s.state !== 'deferred') return false
  return model.nodes[consumerId].dependsOn.every((d) => isDepSatisfied(model, session, now, d, assumeExpired))
}

// ---------------------------------------------------------------------------
// §F2 — executable / current
// ---------------------------------------------------------------------------

/** A node is executable iff its state is `pending` or `deferred` and every dependency
 * is `done`. Running, deferred and pending producers do not satisfy a dependency
 * (plan §C2) — only `isDepSatisfied`'s hands-off-expired carve-out (§F3) relaxes that,
 * and only for the handover predicate, never for `executable`. */
export function executable(model: CookingModel, session: CookingSession, nodeId: string): boolean {
  const s = session.nodes[nodeId]
  if (s.state !== 'pending' && s.state !== 'deferred') return false
  return model.nodes[nodeId].dependsOn.every((d) => session.nodes[d].state === 'done')
}

/** The first executable `pending` node in execution order; if none, the first
 * executable `deferred` node; if none, `null` (plan §C2/§F2). */
export function current(model: CookingModel, session: CookingSession): string | null {
  for (const id of model.order) {
    if (session.nodes[id].state === 'pending' && executable(model, session, id)) return id
  }
  for (const id of model.order) {
    if (session.nodes[id].state === 'deferred' && executable(model, session, id)) return id
  }
  return null
}

// ---------------------------------------------------------------------------
// §F3 — required / handover / holding
// ---------------------------------------------------------------------------

export interface Handover {
  /** Expired hands-off nodes this handover covers, earliest-in-order first. */
  producers: string[]
  consumer: string | null
  reason: 'must_attend' | 'finish' | 'consumer_ready'
  overrunMs: number
}

type RequiredInfo =
  | { required: false }
  | { required: true; reason: 'must_attend' | 'finish'; producers: [string]; consumer: null }
  | { required: true; reason: 'consumer_ready'; producers: string[]; consumer: string }

/** `required(H)` (plan §F3), evaluated only for an `H` already known to be expired and
 * running. Reason precedence is `must_attend` (periodic), then `finish` (the sink),
 * then `consumer_ready` — a periodic host is required the instant it expires regardless
 * of whether its consumer is ready (§K3: "conservative by design"). */
function requiredInfo(model: CookingModel, session: CookingSession, now: number, nodeId: string): RequiredInfo {
  const info = model.nodes[nodeId]
  if (info.attention === 'periodic') {
    return { required: true, reason: 'must_attend', producers: [nodeId], consumer: null }
  }
  if (info.isSink) {
    return { required: true, reason: 'finish', producers: [nodeId], consumer: null }
  }
  const readyConsumer = info.consumers.find((c) => isConsumerReady(model, session, now, c))
  if (readyConsumer != null) {
    const producers = model.nodes[readyConsumer].dependsOn
      .filter((d) => isExpiredRunning(session, now, d))
      .sort((a, b) => model.order.indexOf(a) - model.order.indexOf(b))
    return { required: true, reason: 'consumer_ready', producers, consumer: readyConsumer }
  }
  return { required: false }
}

/** The one pending handover, if any: the required expired hands-off node earliest in
 * execution order (plan §C5 "one handover at a time"). */
export function handover(model: CookingModel, session: CookingSession, now: number): Handover | null {
  for (const id of model.order) {
    if (!isExpiredRunning(session, now, id)) continue
    const info = requiredInfo(model, session, now, id)
    if (info.required) {
      const overrunMs = now - Math.min(...info.producers.map((p) => endsAtOf(session, p)))
      return { producers: info.producers, consumer: info.consumer, reason: info.reason, overrunMs }
    }
  }
  return null
}

/** Expired hands-off nodes that are not (yet) required — holding, exposed for the
 * whisper (plan §F3 "not required => the pan is holding"). */
export function holding(model: CookingModel, session: CookingSession, now: number): string[] {
  return model.order.filter(
    (id) => isExpiredRunning(session, now, id) && !requiredInfo(model, session, now, id).required,
  )
}

// ---------------------------------------------------------------------------
// §F4 — running set / sheet order
// ---------------------------------------------------------------------------

/** Hands-off nodes currently running, soonest `endsAt` first. Every node in state
 * `running` is hands-off by construction (§C3: hands-on nodes never enter `running`). */
export function running(model: CookingModel, session: CookingSession): string[] {
  return model.order
    .filter((id) => session.nodes[id].state === 'running')
    .sort((a, b) => endsAtOf(session, a) - endsAtOf(session, b))
}

/** `requiredIfExpired(H)` (plan §F6): `required(H)` with the expiry clause removed —
 * "if H's timer were up right now, would it (or a consumer it would unblock) need the
 * cook?" Used only by `waitSubject` and `sheetOrder`, never by `handover`/`holding`,
 * which must stay gated on actual expiry. */
export function requiredIfExpired(model: CookingModel, session: CookingSession, now: number, nodeId: string): boolean {
  const info = model.nodes[nodeId]
  if (info.attention === 'periodic') return true
  if (info.isSink) return true
  return info.consumers.some((c) => isConsumerReady(model, session, now, c, nodeId))
}

/** The design's "order by need": `running`, with every `requiredIfExpired` node moved
 * ahead of the rest, ties broken by `endsAt` (plan §F4). */
export function sheetOrder(model: CookingModel, session: CookingSession, now: number): string[] {
  return [...running(model, session)].sort((a, b) => {
    const aReq = requiredIfExpired(model, session, now, a) ? 0 : 1
    const bReq = requiredIfExpired(model, session, now, b) ? 0 : 1
    if (aReq !== bReq) return aReq - bReq
    return endsAtOf(session, a) - endsAtOf(session, b)
  })
}

// ---------------------------------------------------------------------------
// §F6 — wait subject
// ---------------------------------------------------------------------------

export interface WaitSubject {
  nodeId: string
  /** `donenessCue != null` — whether the cook can judge this subject done by eye,
   * independent of the clock (plan §B13 leaves suppression rules to M3.4). */
  judgeable: boolean
}

/** Among `running`, the soonest-`endsAt` node for which `requiredIfExpired` holds —
 * what the calm `wait` screen names as the thing to watch (plan §F6). */
export function waitSubject(model: CookingModel, session: CookingSession, now: number): WaitSubject | null {
  const candidates = running(model, session).filter((id) => requiredIfExpired(model, session, now, id))
  if (candidates.length === 0) return null
  const soonest = candidates.reduce((a, b) => (endsAtOf(session, a) <= endsAtOf(session, b) ? a : b))
  return { nodeId: soonest, judgeable: model.nodes[soonest].donenessCue != null }
}

// ---------------------------------------------------------------------------
// §F7 — nextRequiredAt / away class
// ---------------------------------------------------------------------------

export type AwayClass = 'sitting_break' | 'long_wait' | 'wait'

/**
 * The earliest wall-clock instant a running node will need the cook (plan §F7). A
 * running `H` contributes `endsAt(H)` when `H` is periodic or the sink, or when some
 * consumer of `H` has every *other* dependency already done or running with an
 * `endsAt <= endsAt(H)` — i.e. the moment `H` finishes is the moment everything that
 * consumer needs converges. A node that contributes nothing arrives with a later
 * node's `endsAt` or a cook action, and is excluded from the `min`. `null` if no
 * running node contributes (see K4's pizza walk-through for the worked example).
 */
export function nextRequiredAt(model: CookingModel, session: CookingSession): number | null {
  let best: number | null = null
  for (const id of running(model, session)) {
    const info = model.nodes[id]
    const endsAt = endsAtOf(session, id)
    const contributes =
      info.attention === 'periodic' ||
      info.isSink ||
      info.consumers.some((c) =>
        model.nodes[c].dependsOn
          .filter((d) => d !== id)
          .every((d) => {
            const s = session.nodes[d]
            return s.state === 'done' || (s.state === 'running' && s.endsAt <= endsAt)
          }),
      )
    if (contributes && (best === null || endsAt < best)) best = endsAt
  }
  return best
}

/**
 * Only meaningful when `current(model, session) == null` (plan §F7). Classifies the
 * idle gap to `nextRequiredAt` against the session-break/long-wait thresholds.
 *
 * `nextRequiredAt == null` (plan §M2, 2026-09-22 — resolves the CP1 audit's item 7/8
 * gap): not a new state, already implied by §F7's own exhaustive three-way partition
 * (`>= 120min -> sitting_break`, `>= 45min -> long_wait`, `else -> wait`) plus its own
 * description of the null case — "its requirement arrives with a later node's `endsAt`,
 * or with a cook action" (i.e. not yet, not never). Neither numeric threshold can be
 * evaluated as satisfied without a defined `idleMs`, so the state falls into the only
 * remaining bucket: `wait`. No code change was needed; this comment is the record.
 */
export function awayClass(model: CookingModel, session: CookingSession, now: number): AwayClass {
  const next = nextRequiredAt(model, session)
  if (next == null) return 'wait'
  const idleMs = next - now
  if (idleMs >= SESSION_BREAK_MS) return 'sitting_break'
  if (idleMs >= LONG_WAIT_MS) return 'long_wait'
  return 'wait'
}

// ---------------------------------------------------------------------------
// §F8 — stale
// ---------------------------------------------------------------------------

/**
 * `stale` (plan §F8): true when no running node has a future `endsAt`, and the time
 * since the later of `lastSeenAt` and the latest `endsAt` among running nodes exceeds
 * `staleThresholdMs(model.totalMin)`. Never auto-resumed or auto-cleared (plan §C6) —
 * the caller (M3.4) reports it and offers Continue / Start again.
 */
export function isStale(model: CookingModel, session: CookingSession, now: number): boolean {
  const runningIds = running(model, session)
  if (runningIds.some((id) => endsAtOf(session, id) > now)) return false
  const latestEndsAt = runningIds.reduce((max, id) => Math.max(max, endsAtOf(session, id)), Number.NEGATIVE_INFINITY)
  const reference = Math.max(session.lastSeenAt, latestEndsAt)
  return now - reference > staleThresholdMs(model.totalMin)
}

// ---------------------------------------------------------------------------
// §M1 (2026-09-22) — session lifecycle, composed above role
// ---------------------------------------------------------------------------

/**
 * Session lifecycle (plan §M1 — resolves the CP1 audit's stale/role gap). A THIRD
 * concept, separate from and checked before `Role`: `finished` takes precedence and is
 * never stale-checked; `stale` is handled as its own screen, never as an ordinary role;
 * only `active` proceeds to `role`/`current`/`handover`/`awayClass`. This function *is*
 * that composition — a caller (`useSession.ts`, M3.4) calls this first, and only calls
 * `role` once it reads `'active'` here.
 */
export function lifecycle(model: CookingModel, session: CookingSession, now: number): SessionLifecycle {
  if (session.finishedAt != null) return 'finished'
  if (isStale(model, session, now)) return 'stale'
  return 'active'
}

// ---------------------------------------------------------------------------
// CP1a (M3.4.5 session-lockout plan) — foreign session lifecycle, for a plan-key
// conflict. No CookingModel for the other plan exists at conflict time, so this cannot
// reuse `isStale`/`lifecycle` (both take one) — it reads only the stored session's own
// snapshot fields.
// ---------------------------------------------------------------------------

/** `isStale`'s "nothing running has a future `endsAt`, and the gap since the later of
 * `lastSeenAt`/the latest `endsAt` exceeds the threshold" test, without a `CookingModel`
 * to enumerate node ids from — every `session.nodes` value is read directly instead of
 * going through `model.order`, which changes nothing: the set of running nodes and their
 * `endsAt`s is the same either way, and order is irrelevant to a min/max reduction. */
function foreignIsStale(session: CookingSession, totalMin: number, now: number): boolean {
  const runningEndsAt = Object.values(session.nodes)
    .filter((s): s is Extract<NodeState, { state: 'running' }> => s.state === 'running')
    .map((s) => s.endsAt)
  if (runningEndsAt.some((endsAt) => endsAt > now)) return false
  const latestEndsAt = runningEndsAt.reduce((max, endsAt) => Math.max(max, endsAt), Number.NEGATIVE_INFINITY)
  const reference = Math.max(session.lastSeenAt, latestEndsAt)
  return now - reference > staleThresholdMs(totalMin)
}

/**
 * The lifecycle of a *foreign* stored session, for `engine.open()`'s conflict report
 * (plan decision 2: finished/stale foreign sessions still show the explicit conflict
 * flow, never silently cleared). `finished` takes precedence, exactly as in `lifecycle`,
 * and needs no `totalMin`. Absent that snapshot (a session persisted before CP1a),
 * staleness cannot be evaluated at all — reported as `unknown` rather than guessed as
 * either `active` or `stale`.
 */
export function foreignLifecycle(session: CookingSession, now: number): ForeignSessionState {
  if (session.finishedAt != null) return 'finished'
  if (session.totalMin == null) return 'unknown'
  return foreignIsStale(session, session.totalMin, now) ? 'stale' : 'active'
}

// ---------------------------------------------------------------------------
// §F5 — role
// ---------------------------------------------------------------------------

/**
 * The current screen's role token (plan §F5, refined by §M1), meaningful only once the
 * caller has read `lifecycle(model, session, now) === 'active'` — `role` does not
 * re-check `finishedAt`/staleness itself; that is `lifecycle`'s job, checked first.
 * `returning` is not a member of `Role` either — it overlays whatever role is computed
 * here, read directly off `session.leftAt != null`.
 */
export function role(model: CookingModel, session: CookingSession, now: number): Role {
  if (handover(model, session, now) != null) return 'handover'
  if (current(model, session) != null) return 'task'
  return awayClass(model, session, now)
}

// ---------------------------------------------------------------------------
// §F9 — skip allowed
// ---------------------------------------------------------------------------

/** `skip` is offered only for the current hands-on node, and only when some other
 * *non-deferred* executable node exists (plan §B12/§F9) — skipping the only thing
 * there is to do is a no-op, so the control is absent rather than a rejection. */
export function skipAllowed(model: CookingModel, session: CookingSession): boolean {
  const cur = current(model, session)
  if (cur == null || !model.nodes[cur].occupiesCook) return false
  return model.order.some((id) => id !== cur && session.nodes[id].state === 'pending' && executable(model, session, id))
}

// ---------------------------------------------------------------------------
// §F10 — sitting index
// ---------------------------------------------------------------------------

/** `sittingOf(current ?? last done)` (plan §F10) — the live sitting index, for
 * `sessions[k]` copy lookups (hosts, `elapsed_min`, `preceded_by_wait_min`). */
export function sittingIndex(model: CookingModel, session: CookingSession): number | null {
  const cur = current(model, session)
  if (cur != null) return model.sittingOf[cur] ?? null

  let lastDone: string | null = null
  let lastAt = Number.NEGATIVE_INFINITY
  for (const id of model.order) {
    const s = session.nodes[id]
    if (s.state === 'done' && s.at > lastAt) {
      lastAt = s.at
      lastDone = id
    }
  }
  return lastDone != null ? (model.sittingOf[lastDone] ?? null) : null
}

// ---------------------------------------------------------------------------
// §F11 — copy inputs exposed for M3.4, computed nowhere else
// ---------------------------------------------------------------------------

export interface WhisperInput {
  nodeId: string
  windowId: string | null
  /** Assigned tasks in that window not yet `done`. `0` when the subject hosts no
   * window (nothing left to name as "start with"). */
  remainingWindowTasks: number
}

/** The soonest required-if-expired running node, plus its window's remaining task
 * count, for the whisper's phrasing (`lib/whisper.ts`, M3.4) to consume (plan §F11). */
export function whisperInput(model: CookingModel, session: CookingSession, now: number): WhisperInput | null {
  const subject = waitSubject(model, session, now)
  if (!subject) return null
  const window = model.windows.find((w) => w.host_node_id === subject.nodeId) ?? null
  const remainingWindowTasks = window
    ? window.assigned.filter((id) => session.nodes[id].state !== 'done').length
    : 0
  return { nodeId: subject.nodeId, windowId: window?.id ?? null, remainingWindowTasks }
}

export interface StepContext {
  /** 1-based position in execution order. */
  index: number
  total: number
  /** The node's own stage label, or — for a task the scheduler borrowed into a wait
   * window — its host's stage label (plan §F11). */
  stageLabel: string
}

/** `i of N` plus the stage label M3.4 shows for `nodeId` in step mode (plan §F11). */
export function stepContext(model: CookingModel, nodeId: string): StepContext {
  const info = model.nodes[nodeId]
  let stageLabel = info.stageLabel
  if (info.windowId != null) {
    const window = model.windows.find((w) => w.id === info.windowId)
    const host = window ? model.nodes[window.host_node_id] : undefined
    if (host) stageLabel = host.stageLabel
  }
  return { index: model.order.indexOf(nodeId) + 1, total: model.order.length, stageLabel }
}
