import type { Ingredient } from '@abc-cook/schema'

import type { CookingNodeInfo } from '@/cooking/types'
import { quantityTrailing } from '@/lib/quantity'

/**
 * One phrase per consumed ingredient, in `consumes` order: `ing_*` ids only (`comp_*`
 * never listed — a component has no ingredient row to quote), each rendered as
 * the Ingredients tab's quantity text, then the lower-cased name ("salt to taste" when that text is
 * exactly "to taste"). The step screen's F2 ingredient chips show these directly; `quantityLine` is their join, so the two can never disagree.
 *
 * `factor` (chosen/original servings, default 1) goes through `scaleQuantity`; no caller passes
 * one yet, and at 1 the phrase is the source's own text.
 *
 * `prep_note` composition and the single-qty-split-across-nodes case are open items
 * (§8 — "still needs the schema answer") and are intentionally not attempted here.
 */
export function quantityPhrases(
  node: CookingNodeInfo,
  ingredientsById: ReadonlyMap<string, Ingredient>,
  factor = 1,
): string[] {
  // Identical phrases collapse ("salt to taste · salt to taste" when one node consumes
  // two ids for the same ingredient). Same name with *different* amounts is left alone:
  // which one is right is not something the screen can know.
  return [
    ...new Set(
      node.consumes
        .filter((id) => id.startsWith('ing_'))
        .map((id) => ingredientsById.get(id))
        .filter((ingredient): ingredient is Ingredient => ingredient != null)
        .map((ingredient) => quantityPhrase(ingredient, factor)),
    ),
  ]
}

/**
 * The calm screen's quantity line (M3.4 implementation handoff §5): `quantityPhrases`
 * joined ` · `. A node consuming only components renders no line at all (`null`, not an
 * empty string — an absent slot per §3).
 */
export function quantityLine(
  node: CookingNodeInfo,
  ingredientsById: ReadonlyMap<string, Ingredient>,
  factor = 1,
): string | null {
  const phrases = quantityPhrases(node, ingredientsById, factor)
  return phrases.length > 0 ? phrases.join(' · ') : null
}

// FGC-44: chips still print a bare number with `String`; the tab uses `formatQty`.
const legacyNumber = (qty: number | null | undefined): string => (qty != null ? String(qty) : '')

function quantityPhrase(ingredient: Ingredient, factor: number): string {
  const name = ingredient.name.toLowerCase()
  const trailing = quantityTrailing(ingredient, factor, {
    formatNumber: legacyNumber,
    // The source already put the amount in the name ("A handful of fresh coriander" with
    // qty_text "a handful") — print it once, not "a handful a handful of …".
    omitAmount: (amount) => startsWithWords(name, amount.toLowerCase()),
  })
  if (!trailing) return name
  return trailing.trim().toLowerCase() === 'to taste' ? `${name} ${trailing}` : `${trailing} ${name}`
}

/** `text` starts with `prefix` on a word boundary ("a handful of x" / "a handful"). */
function startsWithWords(text: string, prefix: string): boolean {
  return text === prefix || text.startsWith(`${prefix} `)
}

export function ingredientsById(ingredients: readonly Ingredient[]): Map<string, Ingredient> {
  return new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
}
