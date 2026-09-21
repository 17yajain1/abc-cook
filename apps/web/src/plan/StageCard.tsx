import { Fragment } from 'react'

import type { StageSpan } from '@abc-cook/schema'

import { attentionNote } from '@/lib/attention'
import { formatMinutes } from '@/lib/duration'
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
          className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
        >
          {/* flex-auto (basis: auto), not flex-1 (basis: 0%): the flex-wrap decision
           * below sizes each item by its flex-basis, and a 0%-basis item counts as ~0
           * width for that check regardless of its actual text. That let a long
           * duration string fit "on the line" by the wrap algorithm's math while still
           * crushing the label's box past its own content width during layout — with no
           * min-w-0 here, the label's unbreakable text then overflowed the crushed box
           * with no visible gap before the duration. basis: auto makes the label's real
           * text width count, so wrap correctly moves the duration group to its own
           * line instead. */}
          <span className="expanded flex-auto text-[18px] font-semibold text-ink">
            {stage.label}
          </span>
          {/* Duration + toggle travel together as one flex-shrink-0 unit so a long
           * duration string (e.g. the expanded hands-on/waiting split) wraps whole onto
           * its own line under the label. */}
          <span className="flex flex-shrink-0 items-baseline gap-3">
            <span className="tabular text-[13px] font-medium text-ink-2">
              {expanded
                ? expandedStageDurationText(stage.span)
                : collapsedStageDurationText(stage.span)}
            </span>
            <span aria-hidden className="text-[15px] font-medium leading-none text-ink-2">
              {expanded ? '−' : '+'}
            </span>
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
            {stage.ingredients.length > 0 && (
              <p className="mb-3 text-[13px] text-ink-2">
                <span className="font-medium text-ink">{YOULL_NEED_LABEL}</span>
                {ingredientNames(stage)}
              </p>
            )}
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

const YOULL_NEED_LABEL = "You'll need: "

function ingredientNames(stage: RenderStage): string {
  return stage.ingredients.map((i) => i.name).join(', ')
}

/**
 * The expanded body's `You'll need:` line (M3.2) — names only, `stage.ingredients`'
 * graph order, comma-joined. `null` when the stage consumes no graph ingredients, so
 * the caller omits the line entirely rather than showing an empty lead-in. Quantities
 * stay on the Ingredients tab; this is the same "labelled secondary line" idiom as
 * `Meanwhile: ` on the collapsed card.
 */
export function youllNeedText(stage: RenderStage): string | null {
  if (stage.ingredients.length === 0) return null
  return `${YOULL_NEED_LABEL}${ingredientNames(stage)}`
}

/**
 * The expanded stage header's duration text (C1 split, M3.2 tilde). Splits into
 * hands-on / waiting minutes when the rollup provided both — `StageSpan.hands_on_min` /
 * `unattended_min`, a partition of `inline_work_min` computed in
 * `abc_cook/schedule/rollup.py` (never summed here). The hands-on part carries the same
 * `~` cue as every other hands-on figure (`taskDurationText`, `collapsedStageDurationText`)
 * — it's the cook's own rough figure, not a scheduler promise; the waiting part stays
 * plain, since a wait window's length is the one number here that isn't an estimate.
 * Falls back to the single `~N min` rollup figure, via `formatMinutes` so a long legacy
 * span reads `~1 hr 5 min` like the collapsed figure, when the stage is all hands-on
 * (`unattended_min === 0`) or the fields are absent (a plan saved before this field
 * existed — CLAUDE.md backward-compatibility).
 */
export function expandedStageDurationText(span: StageSpan): string {
  const { hands_on_min, unattended_min } = span
  if (hands_on_min != null && unattended_min != null && unattended_min > 0) {
    return `~${formatMinutes(hands_on_min)} hands-on · ${formatMinutes(unattended_min)} waiting`
  }
  return `~${formatMinutes(span.inline_work_min)}`
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
        {task.instruction && (
          <span className="mt-0.5 block text-[15px] leading-[1.5] text-ink-2">
            {task.instruction}
          </span>
        )}
        {task.donenessCue && (
          <span className="mt-0.5 block text-[13px] leading-[1.42] text-ink-2">
            until {task.donenessCue}
          </span>
        )}
        {note && <span className="mt-0.5 block text-[13px] text-ink-2">{note}</span>}
        {task.tip != null && (
          <span className="mt-0.5 block text-[13px] text-ink-2">
            <span className="font-medium text-ink">Tip: </span>
            {task.tip}
          </span>
        )}
      </span>
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
        {taskDurationText(task)}
      </span>
    </div>
  )
}
