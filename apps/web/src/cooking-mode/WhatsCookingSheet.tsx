import type { SheetView } from './viewModel'

/**
 * `WhatsCookingSheet` (M3.4 handoff §2): read-only. Header line, one row per running
 * hands-off node, closing line. Cannot start, skip or reorder — Close is its only
 * action, and it always returns to whatever calm screen was underneath (§4.4).
 */
export function WhatsCookingSheet({ sheet, onClose }: { sheet: SheetView; onClose: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-home-ink/40">
      <div className="flex-shrink-0 border-t border-home-rule bg-home-ground px-6 pb-[34px] pt-[22px]">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[22px] font-semibold text-home-ink">What&apos;s cooking</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[15px] text-home-ink-2 underline underline-offset-[3px]"
          >
            Close
          </button>
        </div>
        <p className="mb-3.5 text-[15px] leading-[1.5] text-home-ink-2">{sheet.note}</p>

        {sheet.rows.map((row) => (
          <div key={row.nodeId} className="flex items-center gap-3 border-t border-home-rule py-3.5">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${row.dot ? 'bg-home-terracotta' : 'bg-transparent'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[18px] text-home-ink">{row.label}</div>
              {row.cue && <div className="text-[13px] leading-[1.45] text-home-ink-2">{row.cue}</div>}
            </div>
            <span className="tabular flex-shrink-0 text-[22px] font-light text-home-ink" style={{ fontStretch: '88%' }}>
              {row.time}
            </span>
          </div>
        ))}

        {sheet.next && (
          <p className="mt-3.5 border-t border-home-rule pt-3.5 text-[15px] leading-[1.5] text-home-ink-2">{sheet.next}</p>
        )}
      </div>
    </div>
  )
}
