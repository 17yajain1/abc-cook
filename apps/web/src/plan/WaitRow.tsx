import { approxDurationPhrase } from '@/lib/duration'

import type { RenderWaitRow } from './derive'

/**
 * A sitting-boundary gap (M3.2) — a rule-style line between two stages, not a card.
 * No timer, no action, no state: the app isn't tracking this wait, it's just telling
 * the cook it exists before they wonder why the plan jumped ahead in time.
 */
export function WaitRow({ row }: { row: RenderWaitRow }) {
  const phrase = approxDurationPhrase(row.waitMin)
  const text =
    row.hostLabels.length === 1
      ? `${row.hostLabels[0]} · about ${phrase}`
      : `Wait about ${phrase}`

  return (
    <p className="my-4 border-t border-rule pt-4 text-[13px] text-ink-3">{text}</p>
  )
}
