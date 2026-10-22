import { attentionLine } from '@/lib/attention'

import type { RenderWindow } from './derive'
import { StepCard } from './StepCard'

// Re-exported: this was `attentionLine`'s home before the pure outline code needed it.
export { attentionLine }

/**
 * The signature component — Direction 3, "Two Kinds of Minute" (docs/DESIGN_SYSTEM.md
 * § WaitWindowBlock, § Direction 3). A scheduler wait window renders as a panel nested
 * inside its host's own stage, directly beneath the host's ordinary step — never in
 * place of it, never full-bleed. The panel sits on `--color-field`, with a 12px radius
 * and no edge mark (R1: the 2px host-tint edge curved into a "(" at rounded corners, and
 * the white stage card already says which stage hosts it). No shadow.
 *
 * The head states the relationship in words — "Meanwhile, do these" plus a line derived
 * from the host's `attention` — never a numeral; the host's own duration already lives
 * one row above, in its step. Then the ranked borrowed tasks, each numbered in the page's one
 * sequence and keeping its instruction and time (a window task appears nowhere else), then one
 * qualitative footer line that carries no second number.
 *
 * Every value here is the scheduler's or the graph's, looked up by id. Nothing is added.
 */
export function WaitWindowBlock({
  window,
  numbers,
  factor,
}: {
  window: RenderWindow
  numbers: ReadonlyMap<string, number>
  factor: number
}) {
  const ranked = window.tasks.length > 1
  const showTintBar = hasMultiHomeStage(window.tasks)

  // Qualitative — no number, so it cannot contradict the host's own duration one row up.
  // Wording is category B (DESIGN_SYSTEM.md § Still open #2): provisional until seen
  // against a 0-slack and a 50-min-slack window side by side.
  const footer =
    window.slackMin <= 2
      ? 'Start as soon as it is underway — the timing is tight.'
      : window.slackMin >= window.hostDurationTypical / 2
        ? 'Plenty of time — no need to rush.'
        : 'There is room to spare.'

  return (
    <li className="mb-2 mt-1 list-none rounded-home-mini bg-field px-3.5 pb-3 pt-3">
      <p className="text-[16px] font-extrabold text-home-ink">Meanwhile, do these</p>
      <p className="mt-0.5 text-[13px] text-home-ink-2">{sentence(attentionLine(window.hostAttention))}.</p>

      <ol className="mt-2">
        {window.tasks.map((task, i) => (
          <StepCard
            key={task.nodeId}
            task={task}
            number={numbers.get(task.nodeId) ?? 0}
            factor={factor}
            window
            foreign={showTintBar}
            startWithThis={ranked && i === 0}
          />
        ))}
      </ol>

      <p className="mt-1 border-t border-home-rule pt-2.5 text-[13px] leading-[1.42] text-home-ink-2">{footer}</p>
    </li>
  )
}

/**
 * Whether this window's borrowed tasks come from more than one home stage. The 3px
 * home-stage bar on each task row is drawn only when this is true — in both shipped
 * fixtures every task in a window shares one home stage, so the bar would otherwise be
 * one colour repeated, carrying no information (§ WaitWindowBlock).
 */
export function hasMultiHomeStage(tasks: readonly { homeStageIndex: number }[]): boolean {
  return new Set(tasks.map((t) => t.homeStageIndex)).size > 1
}

/** "your hands are free" -> "Your hands are free". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
