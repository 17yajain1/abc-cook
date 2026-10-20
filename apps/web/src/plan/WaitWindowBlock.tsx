import { attentionLine } from '@/lib/attention'
import { stageColor } from '@/lib/stageColor'

import type { RenderWindow } from './derive'
import { useStepOpen } from './stepEditContext'
import { StepInstruction, StepPencil } from './StepRow'
import { taskDurationText } from './StageCard'

// Re-exported: this was `attentionLine`'s home before the pure outline code needed it.
export { attentionLine }

/**
 * The signature component — Direction 3, "Two Kinds of Minute" (docs/DESIGN_SYSTEM.md
 * § WaitWindowBlock, § Direction 3). A scheduler wait window renders as a panel nested
 * inside its host's own stage, directly beneath the host's ordinary task row — never in
 * place of it, never full-bleed. The panel sits on `--color-field`, with a 12px radius
 * and no edge mark (R1: the 2px host-tint edge curved into a "(" at rounded corners, and
 * the white stage card already says which stage hosts it). No shadow.
 *
 * The head states the relationship in words — "Meanwhile, do these" plus a line derived
 * from the host's `attention` — never a numeral; the host's own duration already lives
 * one row above, in its `TaskRow`. Then the ranked borrowed tasks, each with its
 * instruction, then one qualitative footer line that carries no second number.
 *
 * Every value here is the scheduler's or the graph's, looked up by id. Nothing is added.
 */
export function WaitWindowBlock({ window }: { window: RenderWindow }) {
  const [first, ...rest] = window.tasks
  const ranked = window.tasks.length > 1
  const showTintBar = hasMultiHomeStage(window.tasks)

  const attentionText = attentionLine(window.hostAttention)

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
    <div className="mt-2 mb-2 rounded-home-mini bg-field">
      <div className="p-3">
        <p className="text-[15px] font-bold text-home-ink">Meanwhile, do these</p>
        <p className="mt-1 text-[13px] text-home-ink-2">{attentionText}</p>

        <ul className="mt-3">
          {first && <WindowTask task={first} primary={ranked} showTintBar={showTintBar} />}
          {rest.map((task) => (
            <WindowTask key={task.nodeId} task={task} primary={false} showTintBar={showTintBar} />
          ))}
        </ul>

        <p className="mt-1 border-t border-home-rule pt-3 text-[13px] leading-[1.42] text-home-ink-2">
          {footer}
        </p>
      </div>
    </div>
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

/**
 * One borrowed task. The ranked first task (`primary`) sits on its own white card inside
 * the field, with `Start with this` above its name (R1, as in the recipe-page study):
 * terracotta text on the field was 4.25:1, under AA at 12px; on white it is 5.8:1. The
 * row after the card drops its top rule, since the card's own edge already separates them.
 */
function WindowTask({
  task,
  primary,
  showTintBar,
}: {
  task: RenderWindow['tasks'][number]
  primary: boolean
  showTintBar: boolean
}) {
  const open = useStepOpen(task.nodeId)
  return (
    <li
      className={`relative flex items-baseline gap-3 py-3 ${
        primary
          ? 'mb-1 overflow-hidden rounded-home-mini bg-home-surface pr-3 [&+li]:border-t-0'
          : 'border-t border-home-rule'
      } ${showTintBar || primary ? 'pl-3' : ''}`}
    >
      {showTintBar && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ background: stageColor(task.homeStageIndex) }}
        />
      )}
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        {primary && (
          <span className="mb-0.5 block text-[12px] font-semibold text-home-terracotta-text">
            Start with this
          </span>
        )}
        <span
          className={`block text-[15px] text-home-ink ${primary ? 'font-semibold' : 'font-medium'} ${open ? 'pr-16' : ''}`}
        >
          {task.label}
        </span>
        <StepInstruction task={task} />
        {task.addedLabel != null && (
          <span className="mt-0.5 block text-[13px] text-home-ink-2">{task.addedLabel}</span>
        )}
      </div>
      <span
        className={`tabular flex flex-shrink-0 flex-col items-end text-[13px] font-medium text-home-ink-2 ${open ? `absolute top-3 ${primary ? 'right-3' : 'right-0'}` : ''}`}
      >
        {taskDurationText(task)}
        <StepPencil task={task} />
      </span>
    </li>
  )
}
