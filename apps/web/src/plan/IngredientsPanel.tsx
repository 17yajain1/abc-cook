import type { RenderIngredientGroup } from './derive'

/** The Ingredients tab. A plain grouped list — a dead tab is worse than a quiet one. */
export function IngredientsPanel({ groups }: { groups: RenderIngredientGroup[] }) {
  return (
    <div className="px-5 py-5">
      {groups.map((group, i) => (
        <div key={group.group ?? `ungrouped-${i}`} className="mb-5 last:mb-0">
          {group.group && (
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-dim">
              {group.group}
            </h3>
          )}
          <ul className="space-y-1.5">
            {group.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 text-sm last:border-b-0"
              >
                <span className="text-ink">
                  {item.name}
                  {item.optional && (
                    <span className="ml-1.5 text-xs text-ink-dim">optional</span>
                  )}
                </span>
                {(item.qty != null || item.unit) && (
                  <span className="tabular flex-shrink-0 text-ink-muted">
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
