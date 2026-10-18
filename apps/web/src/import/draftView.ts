import type { NormalizedIngredient } from '@abc-cook/schema'

import { joinQtyUnit } from '../lib/quantity'
import type { IngredientListGroup } from '../plan/ingredientGroups'

/**
 * The streamed draft's ingredients, mapped onto the shared `IngredientList`.
 *
 * Arrival order, never regrouped: the list is append-only while it streams, so a row on
 * screen never moves. A heading opens whenever the group changes from the previous item
 * (so the same group can head two runs if the model interleaves them; the recipe page
 * after the tap shows the proper grouping). Keys are positions, which are stable under
 * append.
 *
 * The quantity column is the model's own text, `qty` then `unit` (`joinQtyUnit`: a unit the
 * quantity already ends with is not repeated): no parsing, no `formatQty`, no scaling.
 * This screen sits before the scheduler. It is deliberately not routed through
 * `scaleQuantity`: it renders `NormalizedIngredient` before `graph.py` builds a `qty_amount`,
 * and the draft never scales.
 */
export function draftIngredientGroups(
  ingredients: readonly NormalizedIngredient[],
): IngredientListGroup[] {
  const groups: IngredientListGroup[] = []
  let current: IngredientListGroup | null = null
  ingredients.forEach((ingredient, i) => {
    const heading = ingredient.group?.trim() || null
    if (!current || current.heading !== heading) {
      current = { key: `g${i}`, heading, items: [] }
      groups.push(current)
    }
    const trailing = joinQtyUnit(ingredient.qty, ingredient.unit)
    current.items.push({ key: `${i}`, name: ingredient.name, trailing: trailing || null })
  })
  return groups
}

/** A blog page's own ingredient lines, each whole: one headingless group, nothing parsed. */
export function previewIngredientGroups(lines: readonly string[]): IngredientListGroup[] {
  return [
    {
      key: 'lines',
      heading: null,
      items: lines.map((line, i) => ({ key: `${i}-${line}`, name: line, trailing: null })),
    },
  ]
}
