import { foreignLifecycle } from '@/cooking/select'
import type { CookingSession } from '@/cooking/types'
import type { ServingsChoice } from '@/lib/servings'

/**
 * CP5.1: the servings choice a Cookbook row should show. While a cook on this entry is active or stale
 * (the rule "Continue cooking" uses) it is the session's own choice, because resuming cooks that batch even
 * if the saved choice has been changed since: the lock lifts when a session goes untouched for a day, so
 * the two can differ. Otherwise it is the saved choice. A session that started "as written" has none (`null`).
 */
export function rowServingsChoice(
  session: CookingSession | null,
  entryId: string,
  now: number,
  saved: ServingsChoice | null | undefined,
): ServingsChoice | null | undefined {
  if (session == null || session.planKey !== `library:${entryId}`) return saved
  const state = foreignLifecycle(session, now)
  return state === 'active' || state === 'stale' ? (session.servingsChoice ?? null) : saved
}
