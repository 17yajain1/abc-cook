import { choiceFactor, type ServingsChoice } from '@/lib/servings'
import { servingsCopy } from '@/lib/servingsCopy'

import type { RenderIngredientGroup } from './derive'
import { EditableIngredientList, type IngredientsEdit } from './EditableIngredientList'
import { IngredientList } from './IngredientList'
import { panelIngredientGroups } from './ingredientGroups'

/** R4: the servings control's state for this recipe. `choice` is the factor the amounts are
 * drawn at; it is `null` when the control is gated, and the amounts stay as written. */
export interface PanelServings {
  kind: 'live' | 'locked' | 'gated'
  choice: ServingsChoice | null
  onChange: (choice: ServingsChoice) => void
}

/**
 * "What you need" (D7): the full ingredient list, never folded, between the header and the steps.
 * Amounts sit in the right-hand column in bold, drawn at the cook's servings factor (R4), and each row is
 * editable in edit mode (R6a). The servings control itself lives in the header's tile.
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
  const count = groups.reduce((n, g) => n + g.items.length, 0)
  const listGroups = panelIngredientGroups(groups, factor, marker)

  return (
    <section className="px-5 pt-[22px]" aria-labelledby="need-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="need-heading" className="text-[20px] font-extrabold leading-[1.2] text-home-ink">
          What you need
        </h2>
        <span className="tabular text-[13px] text-home-ink-2">
          {count} {count === 1 ? 'ingredient' : 'ingredients'}
        </span>
      </div>
      <div className="mt-2.5">
        {edit ? <EditableIngredientList groups={listGroups} edit={edit} /> : <IngredientList groups={listGroups} />}
      </div>
    </section>
  )
}
