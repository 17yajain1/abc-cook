import { Fragment } from 'react'

import type { StageSpan } from '@abc-cook/schema'

import { uniqueDisplayNames } from '@/lib/displayNames'
import { formatMinutes } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderStage } from './derive'
import { useStepEdit } from './stepEditContext'
import { StepCard } from './StepCard'
import { WaitWindowBlock } from './WaitWindowBlock'

/**
 * One stage on the recipe page, drawn in the Home register (D7, docs/DESIGN_SYSTEM.md § Register).
 *
 * The stage is a white card with a 1px rule and a 16px radius, spanning the full content width. Stage
 * identity is the filled ordinal badge in the stage's own tint plus the title weight (§ Stage identity).
 * Every card starts open (D2); the chevron collapses one on its own. A wait window the stage hosts renders
 * as a panel directly beneath its host's own step, never in place of it.
 *
 * A controlled component: `PlanScreen` owns which stages are open. `numbers` gives every step its
 * page-wide number (`stepNumbers`), and `factor` is the servings factor, which turns quantity bolding off.
 */
export function StageCard({
  stage,
  expanded,
  onToggle,
  ordinal,
  numbers,
  factor,
}: {
  stage: RenderStage
  expanded: boolean
  onToggle: () => void
  /** The badge number: 1..N over the cards that render (`stageOrdinals`). The tint stays the graph index. */
  ordinal: number
  numbers: ReadonlyMap<string, number>
  factor: number
}) {
  const tint = stageColor(stage.index)
  // R6b (W1 pick f): a collapsed card says so when it holds an edited step, window tasks included.
  const edited = useStepEdit()?.edited
  const holdsEdit = edited != null && stageHoldsEdit(stage, edited)

  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
  const chain = stage.inlineTasks.map((t) => t.label).join(' → ')
  const meanwhile = meanwhileLabels(stage)
  // A card whose whole-stage figure wouldn't match what's visibly inside it — either
  // because it absorbed a foreign row (`hasForeignRows`) or because one of its own
  // rows was absorbed into a different card (`rowsAbsorbedElsewhere`) — omits the
  // figure, same reasoning as the pre-existing `repeated` case (§R1).
  const showsStageDuration = !stage.repeated && !stage.hasForeignRows && !stage.rowsAbsorbedElsewhere

  return (
    <div className="mb-3 rounded-home-card border border-home-rule bg-home-surface px-4 pb-1.5 pt-3.5">
      {/* The ring is for keyboard focus only (`focus-visible`). A tap focuses the button
       * too, and the browser's default ring on that focus was the black box left behind
       * on a tapped header. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${stage.label}`}
        className="flex w-full items-center gap-2.5 rounded-home-mini pb-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-home-ink"
      >
        {/* Numerals are white, not the ground colour: 4.55:1 or better on every tint. */}
        <span
          className="tabular flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold leading-none text-home-surface"
          style={{ background: tint }}
        >
          {ordinal}
        </span>
        <span className="min-w-0 flex-1 text-[18px] font-extrabold leading-[24px] text-home-ink">{stage.label}</span>
        {!expanded && holdsEdit && (
          <span className="flex-shrink-0 text-[13px] font-normal leading-[18px] text-home-ink-2">Edited</span>
        )}
        {showsStageDuration && (
          <span className="tabular flex-shrink-0 whitespace-nowrap text-[13px] leading-[18px] text-home-ink-2">
            {collapsedStageDurationText(stage.span)}
          </span>
        )}
        <span aria-hidden className="flex h-8 w-6 flex-shrink-0 items-center justify-center text-home-ink-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d={expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
          </svg>
        </span>
      </button>

      {!expanded && (
        <div className="pb-2">
          {chain && <p className="line-clamp-2 text-[13px] text-home-ink-2">{chain}</p>}
          {meanwhile.length > 0 && (
            <p className="mt-1 text-[13px] text-home-ink-2">
              <span className="font-medium text-home-ink">Meanwhile: </span>
              {meanwhile.join(', ')}
            </p>
          )}
        </div>
      )}

      {expanded && (
        <ol>
          {stage.inlineTasks.map((task) => {
            const win = windowByHost.get(task.nodeId)
            const foreign = task.homeStageIndex !== stage.index
            return (
              <Fragment key={task.nodeId}>
                <StepCard task={task} number={numbers.get(task.nodeId) ?? 0} factor={factor} foreign={foreign} />
                {win && <WaitWindowBlock window={win} numbers={numbers} factor={factor} />}
              </Fragment>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/** Whether any step this card draws (inline or in a window) is one of the `edited` ids. */
export function stageHoldsEdit(stage: RenderStage, edited: ReadonlySet<string>): boolean {
  return stage.inlineTasks.some((t) => edited.has(t.nodeId)) || stage.windows.some((w) => w.tasks.some((t) => edited.has(t.nodeId)))
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
  return uniqueDisplayNames(stage.ingredients.map((i) => i.name)).join(', ')
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

export { taskDurationText } from './taskDuration'
