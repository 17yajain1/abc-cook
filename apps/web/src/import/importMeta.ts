import type { ImportMeta, ImportResult } from '@abc-cook/schema'

/** A6: import-status fields the frozen `RecipePlanResponse` doesn't carry, computed
 * once here so App/PlanScreen/the saved-library entry all thread the same value
 * rather than re-deriving `degraded` at each hop. `degraded` is true whenever the
 * pipeline ended in the linear fallback, including when the repair provider was
 * unavailable (`repair_unavailable` is added beside `degraded`, never instead of it). */
export function importMetaFrom(result: ImportResult): ImportMeta {
  const warnings = result.warnings ?? []
  return {
    warnings,
    review_recommended: result.review_recommended ?? false,
    sources: result.sources ?? [],
    provenance: result.provenance ?? null,
    degraded: warnings.includes('degraded'),
  }
}
