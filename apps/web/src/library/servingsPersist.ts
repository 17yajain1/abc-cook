import type { PlanOrigin } from '@/cooking-mode/planKey'
import { canonicalSourceKey } from './sourceKey'
import { isOriginalChoice, type ServingsChoice } from '@/lib/servings'

/**
 * R4b: which saved entry, if any, the open recipe's servings choice is written to, and when.
 * Pure: `App.setServingsChoice` does the write.
 */

/** The library lookup this needs: `planKeyFor`'s own, so the two rules cannot differ. */
export type FindBySource = (sourceKey: string) => { id: string } | undefined

/** The entry a choice is written through to (Q3, the `planKeyFor` rule): a library open is its
 * own entry, an import is the entry saved under its source key, a fixture has none. */
export function persistTargetId(origin: PlanOrigin, findBySource: FindBySource): string | null {
  switch (origin.kind) {
    case 'library':
      return origin.id
    case 'import':
      return findBySource(canonicalSourceKey(origin.payload.graph.source))?.id ?? null
    case 'server':
      return null
  }
}

/** What is stored: the recipe as written is null, so stepping back to the original and
 * "Reset to N" both clear the field. */
export function toStored(choice: ServingsChoice | null | undefined): ServingsChoice | null {
  return choice == null || isOriginalChoice(choice) ? null : choice
}

/** No write while a cook is in progress (the stepper is locked), and none without a target. */
export function shouldPersist(locked: boolean, id: string | null): id is string {
  return !locked && id != null
}
