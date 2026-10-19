import type { Ingredient } from '@abc-cook/schema'

import type { CookingNodeInfo } from '@/cooking/types'
import { quantityTrailingScaled } from '@/lib/quantity'

/**
 * One phrase per consumed ingredient, in `consumes` order: `ing_*` ids only (`comp_*`
 * never listed — a component has no ingredient row to quote), each rendered as
 * the Ingredients tab's quantity text, then the lower-cased name ("salt to taste" when that text is
 * exactly "to taste"). The step screen's F2 ingredient chips show these directly; `quantityLine` is their join, so the two can never disagree.
 *
 * `factor` (the cook's `choiceFactor`, default 1) goes through `scaleQuantity`; at 1 the phrase
 * is the source's own text.
 *
 * `prep_note` composition and the single-qty-split-across-nodes case are open items
 * (§8 — "still needs the schema answer") and are intentionally not attempted here.
 */
export function quantityPhrases(
  node: CookingNodeInfo,
  ingredientsById: ReadonlyMap<string, Ingredient>,
  factor = 1,
): string[] {
  return quantityChips(node, ingredientsById, factor).map((chip) => chip.text)
}

/** A chip and whether its amount is one the scaler could not scale (R4 A3). `text` is
 * exactly the `quantityPhrases` string, so keys and the quantity line never change. */
export interface QuantityChip {
  text: string
  unscaled: boolean
}

/** `quantityPhrases`, structured: the same strings in the same order, each with its marker flag. */
export function quantityChips(
  node: CookingNodeInfo,
  ingredientsById: ReadonlyMap<string, Ingredient>,
  factor = 1,
): QuantityChip[] {
  // Identical phrases collapse ("salt to taste · salt to taste" when one node consumes
  // two ids for the same ingredient). Same name with *different* amounts is left alone:
  // which one is right is not something the screen can know.
  const chips = new Map<string, QuantityChip>()
  for (const id of node.consumes) {
    if (!id.startsWith('ing_')) continue
    const ingredient = ingredientsById.get(id)
    if (ingredient == null) continue
    const chip = quantityChip(ingredient, factor)
    if (!chips.has(chip.text)) chips.set(chip.text, chip)
  }
  return [...chips.values()]
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

function quantityChip(ingredient: Ingredient, factor: number): QuantityChip {
  const name = ingredient.name.toLowerCase()
  const { text: trailing, unscaled } = quantityTrailingScaled(ingredient, factor, {
    formatNumber: legacyNumber,
    // The source already put the amount in the name ("A handful of fresh coriander" with
    // qty_text "a handful") — print it once, not "a handful a handful of …".
    omitAmount: (amount) => startsWithWords(name, amount.toLowerCase()),
  })
  if (!trailing) return { text: name, unscaled }
  const text = trailing.trim().toLowerCase() === 'to taste' ? `${name} ${trailing}` : `${trailing} ${name}`
  return { text, unscaled }
}

/** `text` starts with `prefix` on a word boundary ("a handful of x" / "a handful"). */
function startsWithWords(text: string, prefix: string): boolean {
  return text === prefix || text.startsWith(`${prefix} `)
}

export function ingredientsById(ingredients: readonly Ingredient[]): Map<string, Ingredient> {
  return new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
}
