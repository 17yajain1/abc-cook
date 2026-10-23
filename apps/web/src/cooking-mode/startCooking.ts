import type { DispatchResult, SessionStore } from '@/cooking/store'
import type { CookingModel } from '@/cooking/types'
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
