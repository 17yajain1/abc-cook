import { IngredientRow } from './IngredientRow'
import type { IngredientListGroup } from './ingredientGroups'

/**
 * A grouped ingredient list, presentational only. The recipe page's Ingredients tab and
 * the import screen's draft both draw through it, so the hand-off from one to the other
 * doesn't change the type, the rules or the quantity column. Restyle it here and both
 * screens change.
 */
export function IngredientList({ groups }: { groups: IngredientListGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="mb-6 last:mb-0">
          {group.heading && (
            <h3 className="mb-1 text-[13px] font-semibold text-home-ink">{group.heading}</h3>
          )}
          <ul>
            {group.items.map((item) => (
              <IngredientRow
                key={item.key}
                primary={
                  <>
                    {item.name}
                    {item.optional && (
                      <span className="ml-2 text-[13px] text-home-ink-2">optional</span>
                    )}
                  </>
                }
                trailing={
                  item.note ? (
                    <>
                      {item.trailing}
                      <span className="block text-[12px] font-normal">{item.note}</span>
                    </>
                  ) : (
                    item.trailing
                  )
                }
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}
