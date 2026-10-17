import { formatQty } from '../lib/quantity'
import type { RenderIngredientGroup } from './derive'
import { IngredientRow } from './IngredientRow'

/**
 * The Ingredients tab. A plain grouped list — a dead tab is worse than a quiet one.
 * Quantities sit in the same right-aligned tabular column the durations use on the Plan
 * tab, so the two tabs scan the same way.
 */
export function IngredientsPanel({ groups }: { groups: RenderIngredientGroup[] }) {
  return (
    <div className="px-5 py-5">
      {groups.map((group, i) => (
        <div key={group.group ?? `ungrouped-${i}`} className="mb-6 last:mb-0">
          {group.group && (
            <h3 className="mb-1 text-[13px] font-semibold text-home-ink">{group.group}</h3>
          )}
          <ul>
            {group.items.map((item) => (
              <IngredientRow
                key={item.id}
                primary={
                  <>
                    {item.name}
                    {item.optional && (
                      <span className="ml-2 text-[13px] text-home-ink-2">optional</span>
                    )}
                  </>
                }
                trailing={
                  item.qty_text != null || item.qty != null || item.unit
                    ? [item.qty_text ?? formatQty(item.qty), item.unit ?? ''].join(' ').trim()
                    : null
                }
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
