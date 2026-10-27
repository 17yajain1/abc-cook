import { foreignLifecycle } from '@/cooking/select'
import type { DispatchResult, SessionStore } from '@/cooking/store'
import type { CookingModel, CookingSession } from '@/cooking/types'
import type { ServingsChoice } from '@/lib/servings'

/**
 * P1 #6 (orientation/recovery plan §C5/E6): the one place "start a session if none is
 * open" happens. `App.tsx`'s `startCooking` calls this before mounting Cooking Mode, so
 * the Plan's "Start cooking" lands on step 1 directly (PR 2 CP4: there is no start screen),
 * without `App.tsx` (which has no test coverage) owning any of the branching. `open()` is
 * read-only (§E); a `start` is dispatched only when it reports `none`. `ok` (resuming a
 * live session) and `conflict` are left completely untouched — `CookingModeScreen` renders
 * the resume/conflict flow itself once mounted.
 */
/**
 * The Plan page's primary button: "Continue cooking" when this plan already has a live session
 * (`active` or `stale`, the rule Home's Continue strip uses), else "Start cooking". A finished
 * session, one with no `totalMin` snapshot (`unknown`) and another plan's session are not
 * continuing anything here. The tap is the same either way: `startIfNone` resumes.
 */
export function cookCtaLabel(session: CookingSession | null, planKey: string, now: number): string {
  return isContinuing(session, planKey, now) ? 'Continue cooking' : 'Start cooking'
}

/** The line under that button while a cook is under way; `null` otherwise (the page keeps its own line). */
export function cookCtaSubline(session: CookingSession | null, planKey: string, now: number): string | null {
  return isContinuing(session, planKey, now) ? 'Pick up where you left off.' : null
}

function isContinuing(session: CookingSession | null, planKey: string, now: number): boolean {
  if (session == null || session.planKey !== planKey) return false
  const state = foreignLifecycle(session, now)
  return state === 'active' || state === 'stale'
}

export function startIfNone(
  store: SessionStore,
  model: CookingModel,
  planKey: string,
  now: number,
  recipeTitle: string,
  servingsChoice?: ServingsChoice | null,
): DispatchResult {
  const opened = store.open(model, planKey, now)
  if (opened.status !== 'none') return { ok: true, session: store.getState() }
  return store.dispatch({ type: 'start', model, planKey, now, recipeTitle, servingsChoice })
}
