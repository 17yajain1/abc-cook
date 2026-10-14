import type { PlanSummary } from '@abc-cook/schema'

import { headerTiming, type HeaderTiming } from '@/lib/duration'

/**
 * R2: the timing part of the recipe header's meta line.
 *
 * Without the plan-ahead card (no `summary.phases`) this is R1's `headerTiming` unchanged.
 * With the card, the multi-sitting "Start about ... before you eat" secondary is dropped
 * (the card replaces it), and for a multi-sitting recipe the primary range goes too:
 * `headerTiming` reports only the last sitting, which would read as the total time (O3).
 * A single-sitting recipe keeps both its range and its "~N min hands-on" secondary.
 */
export function headerMeta(
  summary: PlanSummary | null | undefined,
  totalMin: number,
  hasCard: boolean,
): { primary: HeaderTiming['primary'] | null; secondary: HeaderTiming['secondary'] } {
  const timing = headerTiming(summary, totalMin)
  if (!hasCard) return timing
  if (summary && summary.sessions.length > 1) return { primary: null, secondary: null }
  return timing
}
