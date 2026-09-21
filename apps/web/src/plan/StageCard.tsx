import { Fragment } from 'react'

import type { StageSpan } from '@abc-cook/schema'

import { attentionNote } from '@/lib/attention'
import { formatMinutes, roundMin } from '@/lib/duration'
import { stageColor, stageGround } from '@/lib/stageColor'

import type { RenderStage, RenderTask } from './derive'
import { WaitWindowBlock } from './WaitWindowBlock'

/**
 * One stage in the vertical plan — Direction 3 (docs/DESIGN_SYSTEM.md § Register).
 *
 * Stage identity is a filled ordinal badge in the stage's own tint, sitting at the head
 * of the stage's 18%-alpha tint ground (§ Stage identity, § Avoid generated-design
 * tells' knowing exception). The ground runs behind everything the stage contains —
 * header, task rows, and any wait-window panel nested inside it. A wait window the stage
 * hosts renders as a panel directly beneath its host's own task row, never in place of
 * it, never full-bleed.
 *
 * M3.2: a controlled component. `PlanScreen` owns which stages are open — the overview
 * starts every stage collapsed, and "Show full recipe" / "Show overview" toggle them
 * all at once, neither of which a stage can know about from inside itself.
 */
export function StageCard({
  stage,
  expanded,
  onToggle,
}: {
  stage: RenderStage
  expanded: boolean
  onToggle: () => void
}) {
  const tint = stageColor(stage.index)
  const ordinal = stageOrdinal(stage)

  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
  const chain = stage.inlineTasks.map((t) => t.label).join(' → ')
  const meanwhile = meanwhileLabels(stage)

  return (
    <div className="mb-6 flex gap-3">
      <div className="flex flex-shrink-0 items-start justify-center pt-0.5" style={{ width: 24 }}>
        <span
          className="tabular flex h-[22px] w-[22px] items-center justify-center rounded-full text-[12px] font-semibold leading-none text-paper"
          style={{ background: tint }}
        >
          {ordinal}
        </span>
      </div>

      <div
        className="min-w-0 flex-1"
        style={{ background: stageGround(stage.index), padding: '10px 12px 8px' }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-baseline gap-3 text-left"
        >
          <span className="expanded min-w-0 flex-1 text-[18px] font-semibold text-ink">
            {stage.label}
          </span>
          <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
            {expanded ? stageDurationText(stage.span) : collapsedStageDurationText(stage.span)}
          </span>
          <span
            aria-hidden
            className="flex-shrink-0 text-[15px] font-medium leading-none text-ink-2"
          >
            {expanded ? '−' : '+'}
          </span>
        </button>

        {!expanded && (
          <div className="mt-1">
            {chain && (
              <p className="line-clamp-2 text-[13px] text-ink-2">{chain}</p>
            )}
            {meanwhile.length > 0 && (
              <p className="mt-1 text-[13px] text-ink-2">
                <span className="font-medium text-ink">Meanwhile: </span>
                {meanwhile.join(', ')}
              </p>
            )}
          </div>
        )}

        {expanded && (
          <div className="mt-3">
            {stage.inlineTasks.map((task) => {
              const win = windowByHost.get(task.nodeId)
              return (
                <Fragment key={task.nodeId}>
                  <TaskRow task={task} />
                  {win && <WaitWindowBlock window={win} hostStageIndex={stage.index} />}
                </Fragment>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Badge number and badge tint both come from `stage.index` — the M2 defect the doc
 *  records was mixing a filtered render position with the raw graph index. */
export function stageOrdinal(stage: RenderStage): number {
  return stage.index + 1
}

/**
 * The collapsed stage figure (M3.2). Always `~`, even when the stage is entirely
 * hands-on: unlike `stageDurationText`'s expanded split, this single numeral is
 * already a rollup of possibly-several tasks, so it is never a plain fact the way one
 * task's own duration is.
 */
export function collapsedStageDurationText(span: StageSpan): string {
  return `~${formatMinutes(span.inline_work_min)}`
}

/** The stage's window tasks, host-time order then rank order — same order the "Start
 *  with this" promotion inside the expanded `WaitWindowBlock` uses (§ StageCard). */
export function meanwhileLabels(stage: RenderStage): string[] {
  return stage.windows.flatMap((w) => w.tasks).map((t) => t.label)
}

/**
 * The stage header's duration text (C1). Splits into hands-on / waiting minutes when
 * the rollup provided both — `StageSpan.hands_on_min` / `unattended_min`, a partition of
 * `inline_work_min` computed in `abc_cook/schedule/rollup.py` (never summed here). Falls
 * back to today's single `~N min` figure when the stage is all hands-on
 * (`unattended_min === 0`) or the fields are absent (a plan saved before this field
 * existed — CLAUDE.md backward-compatibility). No `~` on the split: `~` keeps its one
 * meaning, the fallback rollup figure.
 */
export function stageDurationText(span: StageSpan): string {
  const { hands_on_min, unattended_min } = span
  if (hands_on_min != null && unattended_min != null && unattended_min > 0) {
    return `${formatMinutes(hands_on_min)} hands-on · ${formatMinutes(unattended_min)} waiting`
  }
  return `~${roundMin(span.inline_work_min)} min`
}

/**
 * A task row's duration text (C1 long-duration formatting, C2 estimate cue, M3.2
 * three-way). Three mutually exclusive cases, checked in order:
 *  - hands-on: `~N min` — the cook is doing this themselves, so it's a rough figure
 *    the way the collapsed stage figure is, never a promise.
 *  - not hands-on and the duration's provenance is `inferred`: `about N min` — never
 *    for `defaulted` (`graph.py`: a defaulted number must never be presented as an
 *    estimate the model made).
 *  - otherwise: `N min`, plain.
 */
export function taskDurationText(task: RenderTask): string {
  const formatted = formatMinutes(task.durationTypical)
  if (task.attention === 'hands_on') return `~${formatted}`
  if (task.durationProvenance === 'inferred') return `about ${formatted}`
  return formatted
}

function TaskRow({ task }: { task: RenderTask }) {
  const note = attentionNote(task.attention)
  return (
    <div className="flex items-baseline gap-3 border-b border-rule py-3 last:border-b-0">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block text-[15px] font-medium text-ink">{task.label}</span>
        {task.donenessCue && (
          <span className="mt-0.5 block text-[13px] leading-[1.42] text-ink-2">
            until {task.donenessCue}
          </span>
        )}
        {note && <span className="mt-0.5 block text-[13px] text-ink-2">{note}</span>}
      </span>
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
        {taskDurationText(task)}
      </span>
    </div>
  )
}
