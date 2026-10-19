import type { ImportMeta, Ingredient, ServingsByBatch, ServingsChoice } from '@abc-cook/schema'

import { hasNumber } from './amountNumber'

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

// ---------------------------------------------------------------------------------------
// R4: the cook's servings choice. One factor per open recipe; times and steps never change.
// ---------------------------------------------------------------------------------------

/** The batch sizes a recipe with no stated servings can be scaled to (A2). */
export type BatchMultiplier = ServingsByBatch['multiplier']
export const BATCH_LADDER = [0.5, 1, 1.5, 2, 3] as const satisfies readonly BatchMultiplier[]

/**
 * The canonical servings state (A2), shared by the app's view state, `CookingSession` and
 * `SavedRecipe`. Generated from the Pydantic model (R4b), so the stored shape and this one
 * cannot drift. `servings`: the recipe states how many it serves, so the cook picks a
 * headcount. `batch`: it doesn't, so the cook picks a relative size and no people are
 * counted. `null` (or absent) everywhere means factor 1.
 */
export type { ServingsChoice }

/** Whether the recipe states its servings: the schema flag, minus the legacy default
 * `servingsLine` already detects through the import warning. */
export function servingsStated(source: ServingsSource, importMeta?: ImportMeta | null): boolean {
  const legacyDefaulted = importMeta?.warnings?.includes(SERVINGS_DEFAULTED_WARNING) ?? false
  return (source.servings_stated ?? true) && !legacyDefaulted
}

/** The multiplier for a choice. Missing is 1. Passed on raw: `scaleQuantity` does the
 * rounding, once, per line. */
export function choiceFactor(choice: ServingsChoice | null | undefined): number {
  if (choice == null) return 1
  const factor = choice.mode === 'servings' ? choice.chosen / choice.original : choice.multiplier
  return Number.isFinite(factor) && factor > 0 ? factor : 1
}

/** Q3: 1 up to the larger of double the original and the original plus four. */
export function servingsBounds(original: number): { min: number; max: number } {
  return { min: 1, max: Math.max(2 * original, original + 4) }
}

/** One tap of the stepper. Stops at the ends rather than wrapping. */
export function stepChoice(choice: ServingsChoice, direction: 1 | -1): ServingsChoice {
  if (choice.mode === 'servings') {
    const { min, max } = servingsBounds(choice.original)
    return { ...choice, chosen: Math.min(max, Math.max(min, choice.chosen + direction)) }
  }
  const at = BATCH_LADDER.indexOf(choice.multiplier)
  const next = Math.min(BATCH_LADDER.length - 1, Math.max(0, at + direction))
  return { mode: 'batch', multiplier: BATCH_LADDER[next] }
}

/** Whether the choice leaves every amount as written. */
export function isOriginalChoice(choice: ServingsChoice | null | undefined): boolean {
  return choiceFactor(choice) === 1
}

function isBatchMultiplier(value: unknown): value is BatchMultiplier {
  return typeof value === 'number' && (BATCH_LADDER as readonly number[]).includes(value)
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

/** Shape check only: a stored value is either one of the two shapes or `null`. */
export function parseChoice(value: unknown): ServingsChoice | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.mode === 'servings' && isCount(v.chosen) && isCount(v.original)) {
    return { mode: 'servings', chosen: v.chosen, original: v.original }
  }
  if (v.mode === 'batch' && isBatchMultiplier(v.multiplier)) return { mode: 'batch', multiplier: v.multiplier }
  return null
}

/**
 * A saved or in-memory choice, made safe for the recipe it is about to be applied to (A2).
 * It drops to `null` (factor 1) when its servings were for a different recipe version
 * (`original` isn't the payload's `servings`), or when the recipe has since gone from
 * defaulted to stated or back, which changes which mode applies. `chosen` is clamped into
 * the Q3 bounds.
 */
export function reconcileChoice(
  choice: unknown,
  source: ServingsSource,
  importMeta?: ImportMeta | null,
): ServingsChoice | null {
  const parsed = parseChoice(choice)
  if (parsed == null) return null
  const stated = servingsStated(source, importMeta)
  if (parsed.mode === 'batch') return stated ? null : parsed
  if (!stated || parsed.original !== source.servings) return null
  const { min, max } = servingsBounds(parsed.original)
  return { ...parsed, chosen: Math.min(max, Math.max(min, parsed.chosen)) }
}

/** A1: how many ingredient lines the scaler can act on, and how many carry a number. */
export function scalability(ingredients: ReadonlyArray<Pick<Ingredient, 'qty_text' | 'qty' | 'qty_amount'>>): {
  scalable: number
  numbered: number
} {
  let scalable = 0
  let numbered = 0
  for (const line of ingredients) {
    if (line.qty_amount != null) scalable += 1
    if (hasNumber(line.qty_text)) numbered += 1
  }
  return { scalable, numbered }
}

/**
 * Which control a recipe gets (A1/A2). `gated` when no line can be scaled (hand goldens,
 * a payload from before `qty_amount`, a saved recipe whose refresh failed): there is
 * nothing a factor could act on, so no working control is offered.
 */
export function servingsControlKind(
  source: ServingsSource,
  importMeta: ImportMeta | null | undefined,
  ingredients: ReadonlyArray<Pick<Ingredient, 'qty_text' | 'qty' | 'qty_amount'>>,
): 'servings' | 'batch' | 'gated' {
  if (scalability(ingredients).scalable === 0) return 'gated'
  return servingsStated(source, importMeta) ? 'servings' : 'batch'
}

/** The starting choice for a live control: the recipe as written. */
export function originalChoice(source: ServingsSource, importMeta?: ImportMeta | null): ServingsChoice {
  return servingsStated(source, importMeta)
    ? { mode: 'servings', chosen: source.servings, original: source.servings }
    : { mode: 'batch', multiplier: 1 }
}
