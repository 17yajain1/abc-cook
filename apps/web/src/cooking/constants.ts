/**
 * Session timing constants (M3.3 plan §K5, §F7, §F8, §C4). Each traces to one line of
 * the approved contract — do not change a value here without re-reading that line.
 */

/** §C4/§K5 "Give it longer": `extend` adds this to a running node's `endsAt`, whether
 * or not it has expired. The design's flat "+60 s" (plan §B6), not the scheduler's
 * `duration_max - duration_typical` headroom — the owner may revisit this (§K5 table). */
export const EXTEND_MS = 60_000

/** §C7/§F7: a gap at least this long is a sitting break. Mirrors `summary.py`'s
 * `SESSION_BREAK_MIN = 120` (minutes), converted to ms for a `now`-based comparison. */
export const SESSION_BREAK_MS = 120 * 60_000

/** §C7/§F7: a gap at least this long (but under `SESSION_BREAK_MS`) is a long wait.
 * Mirrors `summary.py`'s `LONG_WAIT_MIN = 45`. */
export const LONG_WAIT_MS = 45 * 60_000

/** §F8: floor of `STALE_MS = max(STALE_FLOOR_MS, STALE_FACTOR * total_min * 60_000)`. */
export const STALE_FLOOR_MS = 6 * 60 * 60_000

/** §F8: multiplier of `STALE_MS`, applied to the plan's `total_min`. */
export const STALE_FACTOR = 2

/** §F8: `STALE_MS` for a plan whose typical makespan is `totalMin` minutes — the
 * threshold past which a reopened session is reported stale rather than resumed. */
export function staleThresholdMs(totalMin: number): number {
  return Math.max(STALE_FLOOR_MS, STALE_FACTOR * totalMin * 60_000)
}
