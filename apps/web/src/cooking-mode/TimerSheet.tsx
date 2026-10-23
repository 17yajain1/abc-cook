import type { TimerRow, TimerSheetView } from './timers'
import type { ActionDescriptor } from './viewModel'

/** What the timer sheet shows: one timer (V2TimerSheet), or every running timer (the
 * Timers list behind "N more timers", owner answer 1). */
export type TimerSheetContent = { mode: 'one'; sheet: TimerSheetView } | { mode: 'all'; rows: TimerRow[] }

const OUTLINE =
  'h-[52px] rounded-full border-[1.5px] border-home-rule bg-home-surface text-[16px] font-bold text-home-ink'

/**
 * PR 2 CP3: the timer sheet. Cream panel with a 24px top radius and a grab bar over a
 * scrim; tapping the scrim closes it. One timer: name, "Go to step N" (or "Step N" when
 * the cook is already there), minutes left (rounded up, never seconds), "Ready around
 * ...", a thin bar, "Add 5 min" + "Stop timer", and "It's done". Every action closes the
 * sheet (the screen's `runEngine`). List mode: one row per running timer, soonest first;
 * a row switches the sheet to that timer.
 */
export function TimerSheet({
  content,
  onAction,
  onPick,
  onClose,
}: {
  content: TimerSheetContent
  onAction: (action: ActionDescriptor) => void
  onPick: (nodeId: string) => void
  onClose: () => void
}) {
  const label = content.mode === 'one' ? `${content.sheet.name} timer` : 'Timers'
  return (
    <div className="absolute inset-0">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-home-ink/40" />
      <div
        role="dialog"
        aria-label={label}
        className="absolute inset-x-0 bottom-0 flex max-h-[calc(100%-150px)] flex-col gap-3.5 overflow-y-auto rounded-t-[24px] bg-home-ground px-5 pb-[calc(24px+var(--safe-bottom))] pt-2.5"
      >
        <div aria-hidden="true" className="h-1 w-10 flex-none self-center rounded bg-home-rule" />
        {content.mode === 'one' ? <OneTimer sheet={content.sheet} onAction={onAction} /> : <AllTimers rows={content.rows} onPick={onPick} />}
      </div>
    </div>
  )
}

function OneTimer({ sheet, onAction }: { sheet: TimerSheetView; onAction: (action: ActionDescriptor) => void }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[22px] font-extrabold leading-[1.2] text-home-ink">{sheet.name}</span>
        {sheet.goTo ? (
          <button
            type="button"
            onClick={() => sheet.goTo && onAction(sheet.goTo.action)}
            className="-my-3 h-11 flex-none whitespace-nowrap text-[14px] font-semibold text-home-terracotta-text underline underline-offset-[3px]"
          >
            {sheet.goTo.label}
          </button>
        ) : (
          <span className="flex-none whitespace-nowrap text-[14px] text-home-ink-2">{sheet.stepRef}</span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span className="text-[52px] font-bold leading-none text-home-ink">{sheet.big}</span>
        {sheet.unit && <span className="text-[18px] font-semibold text-home-ink-2">{sheet.unit}</span>}
      </div>
      {sheet.readyAt && <div className="text-[15px] text-home-ink-2">{sheet.readyAt}</div>}
      <div aria-hidden="true" className="flex h-1 bg-home-rule">
        <div className="bg-home-terracotta" style={{ width: `${Math.round(sheet.fraction * 1000) / 10}%` }} />
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2.5">
        {sheet.add && (
          <button type="button" onClick={() => sheet.add && onAction(sheet.add.action)} className={OUTLINE}>
            {sheet.add.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => onAction(sheet.stop.action)}
          className={`${OUTLINE} ${sheet.add ? '' : 'col-span-2'}`}
        >
          {sheet.stop.label}
        </button>
      </div>
      <button
        type="button"
        onClick={() => onAction(sheet.done.action)}
        className="h-[60px] rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground"
      >
        {sheet.done.label}
      </button>
    </>
  )
}

function AllTimers({ rows, onPick }: { rows: TimerRow[]; onPick: (nodeId: string) => void }) {
  return (
    <>
      <div className="text-[22px] font-extrabold text-home-ink">Timers</div>
      <div>
        {rows.map((row) => (
          <button
            key={row.nodeId}
            type="button"
            onClick={() => onPick(row.nodeId)}
            className="flex min-h-14 w-full items-center gap-3 border-t border-home-rule text-left"
          >
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-home-terracotta" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[17px] font-bold text-home-ink">{row.name}</span>
              <span className="block text-[14px] text-home-ink-2">{row.stepRef}</span>
            </span>
            <span
              className="flex-none whitespace-nowrap text-[14px] font-semibold text-home-sage-chip-text"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {row.left}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}
