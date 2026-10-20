import { choiceFactor, type ServingsChoice } from '@/lib/servings'
import { servingsCopy } from '@/lib/servingsCopy'
import { unscaledCount } from '@/lib/quantity'

import type { RenderIngredientGroup } from './derive'
import { EditableIngredientList, EditToolbar, type IngredientsEdit } from './EditableIngredientList'
import { IngredientList } from './IngredientList'
import { panelIngredientGroups } from './ingredientGroups'
import { ServingsControl } from './ServingsControl'

/** R4: the servings control's state for this recipe. `choice` is the factor the amounts are
 * drawn at; it is `null` when the control is gated, and the amounts stay as written. */
export interface PanelServings {
  kind: 'live' | 'locked' | 'gated'
  choice: ServingsChoice | null
  onChange: (choice: ServingsChoice) => void
}

/**
 * The Ingredients tab. A plain grouped list — a dead tab is worse than a quiet one.
 * Quantities sit in the same right-aligned tabular column the durations use on the Plan
 * tab, so the two tabs scan the same way. With `servings`, the control sits above the list
 * and every amount is drawn at the cook's factor (R4).
 */
export function IngredientsPanel({
  groups,
  servings,
  edit,
}: {
  groups: RenderIngredientGroup[]
  servings?: PanelServings
  /** R6a: the saved recipe's edit session. Absent when the recipe has no saved entry to edit. */
  edit?: IngredientsEdit
}) {
  const choice = servings?.kind === 'gated' ? null : (servings?.choice ?? null)
  const factor = choiceFactor(choice)
  const marker = choice != null && factor !== 1 ? servingsCopy(choice).marker : undefined
  const unscaled = unscaledCount(
    groups.flatMap((g) => g.items),
    factor,
  )

  return (
    <>
      {servings && (
        <ServingsControl
          state={
            servings.kind === 'gated' || choice == null
              ? { kind: 'gated' }
              : servings.kind === 'locked'
                ? { kind: 'locked', choice }
                : { kind: 'live', choice, unscaled }
          }
          onChange={servings.onChange}
        />
      )}
      {edit && <EditToolbar edit={edit} />}
      <div className="px-5 py-5">
        {edit ? (
          <EditableIngredientList groups={panelIngredientGroups(groups, factor, marker)} edit={edit} />
        ) : (
          <IngredientList groups={panelIngredientGroups(groups, factor, marker)} />
        )}
      </div>
    </>
  )
}
