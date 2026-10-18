import type { RenderIngredientGroup } from './derive'
import { IngredientList } from './IngredientList'
import { panelIngredientGroups } from './ingredientGroups'

/**
 * The Ingredients tab. A plain grouped list — a dead tab is worse than a quiet one.
 * Quantities sit in the same right-aligned tabular column the durations use on the Plan
 * tab, so the two tabs scan the same way.
 */
export function IngredientsPanel({ groups }: { groups: RenderIngredientGroup[] }) {
  return (
    <div className="px-5 py-5">
      <IngredientList groups={panelIngredientGroups(groups)} />
    </div>
  )
}
