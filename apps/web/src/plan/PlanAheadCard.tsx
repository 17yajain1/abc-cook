/**
 * R2: the plan-ahead card: the one fact a long cook must not bury, when it will be ready if you start now.
 * Ink on peach, no signal colour. D5: the same card carries the multitask note and its "See which" link to
 * the first Meanwhile block. When both apply it is one card: the plan-ahead bold line first, then one grey
 * line per detail, then the link; never two cards.
 *
 * The caller builds the strings (`readyAroundText` with the clock, `multitaskNote`); this only lays them out.
 */
export function PlanAheadCard({
  ahead,
  multitask,
  onSeeWhich,
}: {
  /** The bold "Start now and it's ready around ..." line and its grey detail. */
  ahead: { bold: string; detail: string } | null
  multitask: { bold: string; detail: string | null } | null
  /** Scrolls to the first Meanwhile block. Shown with the multitask note. */
  onSeeWhich: () => void
}) {
  if (!ahead && !multitask) return null
  // Alone, the multitask line is the bold one; beside the plan-ahead line it is detail, so the card has one
  // bold line.
  const greys = [
    ...(ahead ? [ahead.detail] : []),
    ...(multitask && ahead ? [multitask.bold] : []),
    ...(multitask?.detail ? [multitask.detail] : []),
  ]
  const bold = ahead ? ahead.bold : multitask!.bold
  return (
    <div className="mt-4 rounded-home-mini border border-home-peach-rule bg-home-peach px-4 py-3">
      <p className="text-[15px] font-bold leading-[1.3] text-home-ink">{bold}</p>
      {greys.map((line) => (
        <p key={line} className="mt-0.5 text-[13px] leading-[1.4] text-home-ink-2">
          {line}
        </p>
      ))}
      {multitask && (
        <button
          type="button"
          onClick={onSeeWhich}
          className="relative mt-1 text-[13px] font-medium text-home-ink-2 underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
        >
          See which ↓
        </button>
      )}
    </div>
  )
}
