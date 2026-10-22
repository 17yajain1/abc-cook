import { attentionTag } from '@/lib/attention'
import { cueShownWith } from '@/lib/doneness'
import { stageColor } from '@/lib/stageColor'

import type { RenderTask } from './derive'
import { useStepOpen } from './stepEditContext'
import { StepInstruction, StepPencil } from './StepRow'
import { taskDurationText } from './taskDuration'

/**
 * One numbered step on the recipe page (D7): the number, the name and its time, the instruction with its
 * key things in bold (D6), the doneness cue when the text doesn't already say it, a Hands-off pill, the
 * tip and the added-by label. `window` draws it inside a wait-window field (a plain terracotta number, no
 * circle, and a rule between steps instead of a card edge); `startWithThis` marks the window's first task.
 *
 * `foreign`: a row absorbed from another stage's run keeps its own stage colour as a 3px left edge
 * (`groupIntoRuns`), so it reads as belonging elsewhere rather than as a wait-window relationship.
 */
export function StepCard({
  task,
  number,
  factor,
  foreign = false,
  window = false,
  startWithThis = false,
}: {
  task: RenderTask
  number: number
  /** The servings factor: quantity bolding is off at a factor other than 1. */
  factor: number
  foreign?: boolean
  window?: boolean
  startWithThis?: boolean
}) {
  const tag = attentionTag(task.attention)
  const cue = cueShownWith(task.instruction, task.donenessCue)
  // B25: with the editor open the time moves to the corner and the text column takes the whole row.
  const open = useStepOpen(task.nodeId)
  return (
    <li
      className={`relative flex items-start gap-3 border-t border-home-rule py-3 first:border-t-0 ${foreign ? 'pl-3' : ''}`}
    >
      {foreign && (
        <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ background: stageColor(task.homeStageIndex) }} />
      )}
      {window ? (
        <span className="tabular w-6 flex-shrink-0 pt-px text-[15px] font-bold leading-6 text-home-terracotta-text">{number}</span>
      ) : (
        <span className="tabular flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-home-peach text-[12px] font-bold text-home-terracotta-text">
          {number}
        </span>
      )}
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className={`block text-[16px] font-bold leading-6 text-home-ink ${open ? 'pr-16' : ''}`}>
          {task.label}
          {startWithThis && <span className="ml-2 text-[12px] font-medium text-home-ink-2">start with this</span>}
        </span>
        <StepInstruction task={task} factor={factor} />
        {cue && <span className="mt-0.5 block text-[13px] leading-[1.42] text-home-ink-2">{cue}</span>}
        {tag && (
          <span className="mt-1.5 inline-block rounded-full bg-home-sage px-2.5 py-[3px] text-[12px] font-bold text-home-sage-chip-text">
            {tag}
          </span>
        )}
        {task.addedLabel != null && <span className="mt-0.5 block text-[13px] text-home-ink-2">{task.addedLabel}</span>}
        {task.tip != null && (
          <span className="mt-0.5 block text-[13px] text-home-ink-2">
            <span className="font-medium text-home-ink">Tip: </span>
            {task.tip}
          </span>
        )}
      </div>
      {/* The time sits on the name's line; the edit pencil hangs under it, in the same column, so it never
          pushes the instruction down. */}
      <span
        className={`tabular flex flex-shrink-0 flex-col items-end whitespace-nowrap text-[13px] leading-6 text-home-ink-2 ${open ? 'absolute right-0 top-3' : ''}`}
      >
        {taskDurationText(task)}
        <StepPencil task={task} />
      </span>
    </li>
  )
}
