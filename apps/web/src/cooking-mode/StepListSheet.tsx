import { useState } from 'react'

import { endCookFoot, type StepListRow, type TickState } from './stepPage'
import type { ActionDescriptor } from './viewModel'

/** Circle and name per row state (V2StepList): done = sage with a tick and a grey name;
 * viewed = terracotta circle on a peach row, bold name; running and to do = peach circle. */
const CIRCLE: Record<TickState, string> = {
  done: 'bg-home-sage text-home-sage-chip-text',
  viewed: 'bg-home-terracotta text-home-ground',
  running: 'bg-home-peach text-home-terracotta-text',
  todo: 'bg-home-peach text-home-terracotta-text',
}

const RIGHT: Record<TickState, string> = {
  done: 'text-home-ink-2',
  viewed: 'text-home-terracotta-text',
  running: 'text-home-sage-chip-text',
  todo: 'text-home-ink-2',
}

function Tick() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

/**
 * PR 2 CP3: the All steps sheet, opened from "Step N of M". From 150px below the top of
 * the screen, scrolling inside. Every page step with its recipe-page number; a tap views
 * that step (navigation only, never a completion) and closes; the viewed row just closes.
 * PR 2 CP4: a quiet "End this cook" at the foot (`endCookFoot`), confirmed in place; the
 * confirm resets when the sheet closes (it unmounts).
 */
export function StepListSheet({
  rows,
  onPick,
  onClose,
  onAction,
  confirmingEnd = false,
}: {
  rows: StepListRow[]
  onPick: (row: StepListRow) => void
  onClose: () => void
  /** "End cook" (`endAndExit`). */
  onAction: (action: ActionDescriptor) => void
  /** For the static render only: start with the confirm showing. */
  confirmingEnd?: boolean
}) {
  const [confirming, setConfirming] = useState(confirmingEnd)
  const foot = endCookFoot(confirming)
  return (
    <div className="absolute inset-0">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-home-ink/40" />
      <div
        role="dialog"
        aria-label="All steps"
        className="absolute inset-x-0 bottom-0 top-[150px] flex flex-col rounded-t-[24px] bg-home-ground px-3 pt-2.5"
      >
        <div aria-hidden="true" className="h-1 w-10 flex-none self-center rounded bg-home-rule" />
        <div className="flex-none px-2 pb-3 pt-3.5 text-[22px] font-extrabold text-home-ink">All steps</div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(24px+var(--safe-bottom))]">
          {rows.map((row) => (
            <button
              key={row.nodeId}
              type="button"
              onClick={() => (row.state === 'viewed' ? onClose() : onPick(row))}
              aria-current={row.state === 'viewed' ? 'step' : undefined}
              className={`flex min-h-14 w-full items-center gap-3.5 border-t border-home-rule px-2 text-left ${
                row.state === 'viewed' ? 'bg-home-peach' : 'bg-transparent'
              }`}
            >
              <span
                className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-bold ${CIRCLE[row.state]}`}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {row.state === 'done' ? <Tick /> : row.n}
                {row.state === 'done' && <span className="sr-only">{`Step ${row.n}, done`}</span>}
              </span>
              <span
                className={`min-w-0 flex-1 text-[17px] ${
                  row.state === 'viewed' ? 'font-bold text-home-ink' : row.state === 'done' ? 'font-medium text-home-ink-2' : 'font-medium text-home-ink'
                }`}
              >
                {row.name}
              </span>
              {row.right && (
                <span
                  className={`flex-none whitespace-nowrap text-[14px] font-semibold ${RIGHT[row.state]}`}
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {row.right}
                </span>
              )}
            </button>
          ))}
          <div data-end-cook="true" className="border-t border-home-rule px-2 pt-2">
            {foot.prompt && <p className="pb-2 pt-1 text-[16px] font-semibold text-home-ink">{foot.prompt}</p>}
            <div className="flex items-center gap-3">
              {foot.buttons.map((b) =>
                'action' in b ? (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => onAction(b.action)}
                    className="h-11 rounded-full bg-home-terracotta px-5 text-[16px] font-bold text-home-ground"
                  >
                    {b.label}
                  </button>
                ) : (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => setConfirming(b.confirm)}
                    className="h-11 px-1 text-[16px] text-home-ink-2 underline underline-offset-[3px]"
                  >
                    {b.label}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
