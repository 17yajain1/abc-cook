import type { ReactNode } from 'react'

/**
 * One ingredient line, presentational only. It owns the hairline, the padding, the type
 * and the right-aligned tabular trailing column; it knows nothing about where the line
 * came from. The recipe page maps a structured item (name, formatted quantity and unit)
 * onto it, and the import screen maps the source's raw text onto it (whole line as
 * `primary`, no `trailing`, nothing parsed). Restyling this one component restyles both.
 *
 * `tone` picks the register's rule colour: the recipe page is Home register, the import
 * screen is still on the Plan's paper (`AppShell`: "the import-progress screens keep the
 * Plan paper").
 */
export function IngredientRow({
  primary,
  trailing,
  tone = 'home',
}: {
  primary: ReactNode
  trailing?: ReactNode
  tone?: 'home' | 'plan'
}) {
  if (tone === 'plan') {
    return (
      <li className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 text-[15px] leading-[1.45] text-ink">
        <span>{primary}</span>
        {trailing != null && (
          <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">{trailing}</span>
        )}
      </li>
    )
  }
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-home-rule py-2 text-[15px] last:border-b-0">
      <span className="text-home-ink">{primary}</span>
      {trailing != null && (
        <span className="tabular flex-shrink-0 text-[13px] font-medium text-home-ink-2">
          {trailing}
        </span>
      )}
    </li>
  )
}
