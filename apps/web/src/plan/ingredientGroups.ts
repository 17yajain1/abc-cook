import { formatQty, joinQtyUnit } from '../lib/quantity'
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

/** The recipe page's Ingredients tab: the plan's grouped ingredients, as stated. */
export function panelIngredientGroups(groups: RenderIngredientGroup[]): IngredientListGroup[] {
  return groups.map((group, i) => ({
    key: group.group ?? `ungrouped-${i}`,
    heading: group.group,
    items: group.items.map((item) => ({
      key: item.id,
      name: item.name,
      optional: item.optional === true,
      trailing:
        item.qty_text != null || item.qty != null || item.unit
          ? joinQtyUnit(item.qty_text ?? formatQty(item.qty), item.unit)
          : null,
    })),
  }))
}
