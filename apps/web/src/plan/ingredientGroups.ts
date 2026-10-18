import { formatQty, joinQtyUnit } from '../lib/quantity'
import { scaleQuantity } from '../lib/scaleQuantity'
import type { RenderIngredientGroup } from './derive'

/** What `IngredientList` draws: plain strings, so every mapping onto it tests without a
 * browser. Each caller decides what `trailing` says; the list never parses or formats. */
export interface IngredientListItem {
  key: string
  name: string
  optional?: boolean
  trailing: string | null
}

export interface IngredientListGroup {
  key: string
  /** `null` draws no heading. */
  heading: string | null
  items: IngredientListItem[]
}

/**
 * The recipe page's Ingredients tab: the plan's grouped ingredients, as stated. `factor` is
 * chosen/original servings; at 1 (the default, and every caller today) the text is the source's.
 */
export function panelIngredientGroups(
  groups: RenderIngredientGroup[],
  factor = 1,
): IngredientListGroup[] {
  return groups.map((group, i) => ({
    key: group.group ?? `ungrouped-${i}`,
    heading: group.group,
    items: group.items.map((item) => ({
      key: item.id,
      name: item.name,
      optional: item.optional === true,
      trailing:
        item.qty_text != null || item.qty != null || item.unit
          ? joinQtyUnit(scaleQuantity(item, factor).text ?? formatQty(item.qty), item.unit)
          : null,
    })),
  }))
}
