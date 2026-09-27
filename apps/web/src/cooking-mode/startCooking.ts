import type { DispatchResult, SessionStore } from '@/cooking/store'
import type { CookingModel } from '@/cooking/types'

/**
 * P1 #6 (orientation/recovery plan §C5/E6): the one place "start a session if none is
 * open" happens. `App.tsx`'s `startCooking` calls this instead of unconditionally
 * mounting the entry screen — the Plan's "Start Cooking" then lands on step 1 directly,
 * never the black entry screen, without `App.tsx` (which has no test coverage) owning
 * any of the branching. `open()` is read-only (§E); a `start` is dispatched only when it
 * reports `none`. `ok` (resuming a live session) and `conflict` are left completely
 * untouched — `CookingModeScreen` renders the resume/conflict flow itself once mounted,
 * exactly as it does today.
 */
export function startIfNone(
  store: SessionStore,
  model: CookingModel,
  planKey: string,
  now: number,
  recipeTitle: string,
): DispatchResult {
  const opened = store.open(model, planKey, now)
  if (opened.status !== 'none') return { ok: true, session: store.getState() }
  return store.dispatch({ type: 'start', model, planKey, now, recipeTitle })
}
