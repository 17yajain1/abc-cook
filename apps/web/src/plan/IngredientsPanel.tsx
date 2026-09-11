import type { RenderIngredientGroup } from './derive'

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
            <h3 className="mb-1 text-[13px] font-semibold text-ink">{group.group}</h3>
          )}
          <ul>
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 border-b border-rule py-2 text-[15px] last:border-b-0"
              >
                <span className="text-ink">
                  {item.name}
                  {item.optional && (
                    <span className="ml-2 text-[13px] text-ink-3">optional</span>
                  )}
                </span>
                {(item.qty != null || item.unit) && (
                  <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
                    {[item.qty ?? '', item.unit ?? ''].join(' ').trim()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
