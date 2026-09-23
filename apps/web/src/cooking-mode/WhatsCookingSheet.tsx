import type { SheetView } from './viewModel'

/**
 * `WhatsCookingSheet` (M3.4 handoff §2): read-only. Header line, one row per running
 * hands-off node, closing line. Cannot start, skip or reorder — Close is its only
 * action, and it always returns to whatever calm screen was underneath (§4.4).
 */
export function WhatsCookingSheet({ sheet, onClose }: { sheet: SheetView; onClose: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-end bg-ink/40">
      <div className="flex-shrink-0 border-t border-ink bg-paper px-6 pb-[34px] pt-[22px]">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[22px] font-semibold text-ink">What&apos;s cooking</span>
          <button
            type="button"
            onClick={onClose}
            className="text-[15px] text-ink-2 underline underline-offset-[3px]"
          >
            Close
          </button>
        </div>
        <p className="mb-3.5 text-[15px] leading-[1.5] text-ink-2">{sheet.note}</p>

        {sheet.rows.map((row) => (
          <div key={row.nodeId} className="flex items-center gap-3 border-t border-rule py-3.5">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${row.dot ? 'bg-signal' : 'bg-transparent'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[18px] text-ink">{row.label}</div>
              {row.cue && <div className="text-[13px] leading-[1.45] text-ink-2">{row.cue}</div>}
            </div>
            <span className="tabular flex-shrink-0 text-[22px] font-light text-ink" style={{ fontStretch: '88%' }}>
              {row.time}
            </span>
          </div>
        ))}

        {sheet.next && (
          <p className="mt-3.5 border-t border-rule pt-3.5 text-[15px] leading-[1.5] text-ink-2">{sheet.next}</p>
        )}
      </div>
    </div>
  )
}
