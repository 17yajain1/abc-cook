import type { DispatchResult, SessionStore } from '@/cooking/store'
import type { CookingModel, CookingSession } from '@/cooking/types'
import type { ServingsChoice } from '@/lib/servings'
import type { CompletionVia, SessionFinished } from '@/metrics/outbox'

export type { CompletionVia, SessionFinished }

/**
 * M5 completion metric: the one place a cooking session is *confirmed* finished. Follows
 * the `startCooking.ts` pattern — `CookingModeScreen` (untested, no jsdom) delegates the
 * branching here.
 *
 * `finishedAt` alone is NOT a completion: the sink being done is undoable for 10 s
 * (`UNDO_WINDOW_MS`). A completion is confirmed only by (1) the "Finished cooking" tap
 * ending the session, or (2) a finished session being replaced through the conflict flow.
 * A finished session that is never confirmed is a known, accepted undercount (owner
 * decision O2) — to be reviewed at M5's tester exit review.
 *
 * `emit` is called only after the end/replace write succeeds, so a failed write can never
 * leave a still-undoable session that has already been counted.
 */

/** The event for `session` if it is finished, else `null`. `event_id` identifies the
 * session (`planKey@startedAt`), so re-emitting is harmless: the outbox de-duplicates. */
export function completionEventFor(
  session: CookingSession | null,
  via: CompletionVia,
  now: number,
): SessionFinished | null {
  if (session == null || session.finishedAt == null) return null
  return {
    event_id: `${session.planKey}@${session.startedAt}`,
    kind: 'session_finished',
    plan_key: session.planKey,
    started_at: session.startedAt,
    finished_at: session.finishedAt,
    confirmed_at: now,
    via,
  }
}

/** Ends the session ("Finished cooking") and emits its completion if it was finished.
 * The caller still calls `onFinish()` unconditionally. */
export function finishCooking(
  store: SessionStore,
  emit: (event: SessionFinished) => void,
  now: number,
): DispatchResult {
  const captured = store.getState()
  const result = store.dispatch({ type: 'end', now })
  if (result.ok) safeEmit(emit, completionEventFor(captured, 'finish', now))
  return result
}

/** Replaces the blocking session with a new one and emits the replaced session's
 * completion if it was finished. A rejected replace emits nothing. */
export function replaceSession(
  store: SessionStore,
  model: CookingModel,
  planKey: string,
  expectedPlanKey: string,
  recipeTitle: string | undefined,
  emit: (event: SessionFinished) => void,
  now: number,
  servingsChoice?: ServingsChoice | null,
): DispatchResult {
  const captured = store.getState()
  const result = store.dispatch({ type: 'replace', model, planKey, expectedPlanKey, now, recipeTitle, servingsChoice })
  if (result.ok) safeEmit(emit, completionEventFor(captured, 'replace', now))
  return result
}

/** Metrics must never block cooking: a throwing sink is swallowed. */
function safeEmit(emit: (event: SessionFinished) => void, event: SessionFinished | null): void {
  if (event == null) return
  try {
    emit(event)
  } catch {
    // Accepted loss (plan): finishing the cook matters more than counting it.
  }
}
