import type { Ingredient } from '@abc-cook/schema'

import type { CookingNodeInfo } from '@/cooking/types'

/**
 * The calm screen's quantity line (M3.4 implementation handoff §5): `ing_*` ids only
 * (`comp_*` never listed — a component has no ingredient row to quote), each rendered
 * as `qty unit name` lower-cased and joined ` · `. A node consuming only components
 * renders no line at all (`null`, not an empty string — an absent slot per §3).
 *
 * `prep_note` composition and the single-qty-split-across-nodes case are open items
 * (§8 — "still needs the schema answer") and are intentionally not attempted here.
 */
export function quantityLine(
  node: CookingNodeInfo,
  ingredientsById: ReadonlyMap<string, Ingredient>,
): string | null {
  const phrases = node.consumes
    .filter((id) => id.startsWith('ing_'))
    .map((id) => ingredientsById.get(id))
    .filter((ingredient): ingredient is Ingredient => ingredient != null)
    .map(quantityPhrase)

  return phrases.length > 0 ? phrases.join(' · ') : null
}

function quantityPhrase(ingredient: Ingredient): string {
  const name = ingredient.name.toLowerCase()
  if (ingredient.qty == null && ingredient.unit === 'to taste') return `${name} to taste`

  const qty = ingredient.qty_text ?? (ingredient.qty != null ? String(ingredient.qty) : null)
  return [qty, ingredient.unit, name].filter((part): part is string => !!part).join(' ')
}

export function ingredientsById(ingredients: readonly Ingredient[]): Map<string, Ingredient> {
  return new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]))
}
