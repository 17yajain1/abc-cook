import type { ReactNode } from 'react'

/**
 * One ingredient line, presentational only. It owns the hairline, the padding, the type
 * and the right-aligned tabular trailing column; it knows nothing about where the line
 * came from. The recipe page maps a structured item (name, formatted quantity and unit)
 * onto it, and the import screen maps the draft or the source's raw text onto it (a whole
 * line as `primary`, no `trailing`, nothing parsed). Both are Home register, so there is
 * one style: restyling this component restyles both.
 */
export function IngredientRow({ primary, trailing }: { primary: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-home-rule py-2.5 text-[15px] last:border-b-0">
      <span className="text-home-ink">{primary}</span>
      {trailing != null && (
        <span className="tabular max-w-[60%] flex-shrink-0 text-right text-[15px] font-bold text-home-ink">
          {trailing}
        </span>
      )}
    </li>
  )
}
