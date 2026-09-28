import type { ImportMeta } from '@abc-cook/schema'

/**
 * P1 #5 §R4 hardening: must match `graph.py`'s `SERVINGS_DEFAULTED_WARNING` verbatim.
 * Pinned against a regenerated web fixture by `servings.test.ts` — a change on either
 * side without the other breaks the one thing this constant exists for: detecting a
 * legacy saved import's default without a migration (see `servingsLine` below).
 */
export const SERVINGS_DEFAULTED_WARNING = 'Servings not stated in the source; defaulted to 4.'

/** The subset of `CookingGraph`/`RecipeSummary` `servingsLine` needs — same field
 * names, so both call sites (the raw graph/summary) pass themselves through
 * directly; `RecipeHeader` (reading `RenderPlan`, camelCased by `derive.ts`) adapts
 * at its own call site instead of this function taking two shapes. */
export interface ServingsSource {
  servings: number
  servings_stated?: boolean
  yield_text?: string | null
}

/** Mirrors `graph.py`'s `_YIELD_PEOPLE_WORDS` (§R4 PC5 guard) — used here only to
 * decide whether `yield_text` already says "people" on its own, not to re-run PC5
 * (that already happened server-side; `servings_stated` is its verdict). */
const YIELD_PEOPLE_WORDS = ['serves', 'servings', 'people', 'persons', 'portions']

function yieldNamesPeople(yieldText: string): boolean {
  const lowered = yieldText.toLowerCase()
  return YIELD_PEOPLE_WORDS.some((word) => lowered.includes(word))
}

/**
 * The Plan header's / Library row's servings line, or `null` to show nothing.
 *
 * Never invents a number.
 * - Both a stated `servings` and a kept `yield_text` that DOESN'T already name a
 *   people word: show both, "N servings · <yield>" — the yield adds real
 *   information (an item count, a pan size) a bare "N servings" alone wouldn't
 *   carry, so neither one shown alone would be the full picture.
 * - `yield_text` alone (either `servings` isn't stated, or the yield already says
 *   "people"/"servings" itself — showing a second, redundant count would be the
 *   "Pancakes show the source's yield, not '15 servings'" mistake in reverse):
 *   just the yield, verbatim.
 * - `servings` alone (stated, no yield_text): "N servings"/"1 serving".
 * - Neither: `null` — including the legacy gap: a recipe saved BEFORE
 *   `servings_stated` existed deserializes with the field defaulted to `true`
 *   (schema default), but its own `import_meta.warnings` — captured at import
 *   time, before this field existed — still remembers the exact
 *   defaulted-servings warning. The graph alone can't distinguish "field absent"
 *   from "explicitly true" any more by the time this runs; the warning text is
 *   the only signal left. A legacy import saved with no `import_meta` at all is a
 *   residual, accepted gap (§R5) this function cannot close.
 */
export function servingsLine(graph: ServingsSource, importMeta?: ImportMeta | null): string | null {
  const yieldText = graph.yield_text?.trim() || null

  const stated = graph.servings_stated ?? true
  const legacyDefaulted = importMeta?.warnings?.includes(SERVINGS_DEFAULTED_WARNING) ?? false
  const servingsText =
    stated && !legacyDefaulted
      ? `${graph.servings} ${graph.servings === 1 ? 'serving' : 'servings'}`
      : null

  if (yieldText && servingsText && !yieldNamesPeople(yieldText)) {
    return `${servingsText} · ${yieldText}`
  }
  return yieldText ?? servingsText
}
