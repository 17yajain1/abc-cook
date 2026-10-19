import { quantityTrailingScaled } from '../lib/quantity'
import type { RenderIngredientGroup } from './derive'

/** What `IngredientList` draws: plain strings, so every mapping onto it tests without a
 * browser. Each caller decides what `trailing` says; the list never parses or formats. */
export interface IngredientListItem {
  key: string
  name: string
  optional?: boolean
  trailing: string | null
  /** A second, quieter line under the amount: set only for an amount the scaler could not scale. */
  note?: string
}

export interface IngredientListGroup {
  key: string
  /** `null` draws no heading. */
  heading: string | null
  items: IngredientListItem[]
}

/**
 * The recipe page's Ingredients tab: the plan's grouped ingredients, as stated. `factor` is the
 * cook's `choiceFactor`; at 1 (the default) the text is the source's. A line with a number the
 * scaler could not scale carries `unscaledNote` ("for 4 servings") so it is never mistaken for a
 * scaled amount; without a note text, or at factor 1, no line carries one.
 */
export function panelIngredientGroups(
  groups: RenderIngredientGroup[],
  factor = 1,
  unscaledNote?: string,
): IngredientListGroup[] {
  return groups.map((group, i) => ({
    key: group.group ?? `ungrouped-${i}`,
    heading: group.group,
    items: group.items.map((item) => {
      const { text, unscaled } = quantityTrailingScaled(item, factor)
      return {
        key: item.id,
        name: item.name,
        optional: item.optional === true,
        trailing: text,
        ...(unscaled && unscaledNote ? { note: unscaledNote } : {}),
      }
    }),
  }))
}
