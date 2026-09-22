import type { Node, Session, WaitWindow } from '@abc-cook/schema'

/**
 * Session-core types for M3.3 (`s21-M3.3-session-core.md`, plan §D/§L1).
 *
 * `CookingSession` is the only persisted shape (`localStorage['abc-cook:session:v1']`).
 * `CookingModel` is rebuilt once per plan by `deriveCookingModel` and never persisted.
 * Everything derivable from the two — current node, handover, sitting index, remaining/
 * overrun time, "away" class, stale flag — is computed by `select.ts`, never stored
 * (plan §D "What is deliberately not stored").
 */

/** Persisted session shape. Every timestamp is epoch ms (plan §D). */
export interface CookingSession {
  version: 1
  /** `App.tsx`'s `planKey(origin)` — `server:`/`library:`/`import:` prefixed. */
  planKey: string
  /** Defensive: must match `payload.graph.id` on `open` (plan §E `open`). */
  graphId: string
  startedAt: number
  /** `touch(now)` input; also the stale-rule input (plan §F8). */
  lastSeenAt: number
  /** Set by explicit `leave`; cleared by `resume`. `null` otherwise. */
  leftAt: number | null
  /** Set when the sink node (`kind: 'finish'`) is done. */
  finishedAt: number | null
  /** Every node id in the graph, always present. */
  nodes: Record<string, NodeState>
  /** Undo support (engine only in M3.3 — plan §C8, §E `undo`). */
  lastTransition: Transition | null
}

/** A hands-on node's lifecycle is `pending -> done` or `pending -> deferred -> done`,
 * and it never has a timer. A hands-off node's lifecycle is `pending -> running -> done`;
 * only `running` carries the absolute wall-clock `endsAt` (plan §C3, §C4). */
export type NodeState =
  | { state: 'pending' }
  | { state: 'deferred'; at: number }
  | { state: 'running'; startedAt: number; endsAt: number; extendedMs: number }
  | { state: 'done'; at: number; endsAt: number | null }

/** One node's state before a reversible action touched it (plan §L1). */
export interface TransitionEntry {
  nodeId: string
  prev: NodeState
}

/**
 * The last reversible action, for `undo` (plan §L1 — supersedes the single-entry shape
 * in plan §D: `acknowledge` may mark more than one expired producer done at once, e.g.
 * biryani t=20's two producers, and `undo` must reverse all of them or none).
 */
export interface Transition {
  kind: 'done' | 'skip' | 'acknowledge'
  at: number
  entries: TransitionEntry[]
}

/**
 * A typed rejection from an engine action. Never thrown (plan §E preamble: actions are
 * `(session, model, now) -> session | Rejected`). The specific `reason` vocabulary is
 * an `engine.ts` (M3.3 CP2) concern — this is the shape CP1's types commit to.
 */
export interface Rejected {
  readonly ok: false
  readonly reason: string
}

/**
 * Session lifecycle (plan §M1, 2026-09-22 — resolves the CP1 audit's stale/role gap):
 * a THIRD concept, separate from and above `Role`. `finished`/`stale` are lifecycle
 * facts, not Cooking Mode roles. Composition (caller-level, e.g. `useSession.ts`):
 * `finished` takes precedence and is never stale-checked; `stale` is handled as its own
 * screen (Continue / Start again), never as an ordinary role; only `active` proceeds to
 * `role`/`current`/`handover`/`awayClass`. See `select.ts`'s `lifecycle`.
 */
export type SessionLifecycle = 'finished' | 'stale' | 'active'

/**
 * What M3.4 renders for the current screen, once `lifecycle === 'active'` (plan §F5,
 * refined by §M1). `finished`/`stale` are NOT members — they are `SessionLifecycle`
 * facts, checked by the caller before `role` is ever consulted. `returning` is not a
 * member either — it overlays any role when `session.leftAt != null` (read directly,
 * not derived); see `select.ts`'s `role`/`lifecycle` doc comments.
 */
export type Role = 'handover' | 'task' | 'sitting_break' | 'long_wait' | 'wait'

/** Per-node facts joined from the graph and the scheduled plan — everything the session
 * engine and selectors read about a node, looked up by id (plan §D `CookingModel`). */
export interface CookingNodeInfo {
  id: string
  label: string
  instruction: string
  tip: string | null
  attention: Node['attention']
  kind: Node['kind']
  /** `ScheduledNode.occupies_cook`, copied verbatim — never recomputed from `attention`. */
  occupiesCook: boolean
  /** Verified in plan §K3 and deliberately unused by session logic: it gates window
   * placement for a hands-on task, not whether a finished hands-off node can be left. */
  interruptible: boolean
  dependsOn: string[]
  /** Inverse of `dependsOn` — every node whose `dependsOn` names this one. */
  consumers: string[]
  consumes: string[]
  /** `kind === 'finish'`. Exactly one true per graph (plan §D test row 2). */
  isSink: boolean
  durationMin: number
  durationTypical: number
  durationMax: number
  donenessCue: string | null
  stageId: string
  stageLabel: string
  /** Set when the scheduler placed this node inside another node's wait window. */
  windowId: string | null
  rankInWindow: number | null
  /** `ScheduledNode.start_min` / `end_min` — a lookup for ordering and M3.4 copy only;
   * never used for minute arithmetic (CLAUDE.md — the frontend never derives a duration). */
  startMin: number
  endMin: number
}

/**
 * Built once per plan by `deriveCookingModel` (`model.ts`) and never persisted.
 *
 * `order`, `windows`, `sessions` and `sittingOf` are read-only lookups computed from
 * `plan.scheduled` / `PlanSummary`; they are never re-derived by `select.ts`, which only
 * ever compares against stored `NodeState` (plan §C1: "Windows, stages, rank_in_window
 * and critical_path are never read for ordering or selection").
 */
export interface CookingModel {
  graphId: string
  /** Execution order (plan §C1/§F1/§K1): `plan.scheduled` re-keyed by
   * `(start_min, occupies_cook ? 1 : 0, node_id)`. Node ids, in order. */
  order: string[]
  nodes: Record<string, CookingNodeInfo>
  /** `id` of the single `kind: 'finish'` node — same as `nodes[id].isSink`, kept as a
   * direct lookup for convenience. */
  sinkId: string
  /** `plan.windows`, verbatim — lookups for M3.4 copy only (whisper, sheet). */
  windows: WaitWindow[]
  /** `PlanSummary.sessions`, verbatim, or `[]` for a plan saved before `summary` existed. */
  sessions: Session[]
  /** Inverse of `sessions[k].node_ids`: node id -> session index (plan §C7 `sittingOf`). */
  sittingOf: Record<string, number>
  warnings: string[]
  savedMin: number
  totalMin: number
}
