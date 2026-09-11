import { Fragment, useState } from 'react'

import { roundMin } from '@/lib/duration'
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
 */
export function StageCard({
  stage,
  defaultExpanded,
}: {
  stage: RenderStage
  /**
   * Stages open expanded (M2.5 decision — previously an unrecorded `defaultExpanded`
   * default). The collapsed state stays specified and reachable; it is not the default.
   * Resolves § Authority conflict 7. Do not "clean this up" to a computed value.
   */
  defaultExpanded: boolean
}) {
  const tint = stageColor(stage.index)
  const ordinal = stageOrdinal(stage)
  const freeMin = freeMinForStage(stage)

  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))

  const [expanded, setExpanded] = useState(defaultExpanded)
  const summary = stage.inlineTasks.map((t) => t.label).join(' → ')

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
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-baseline gap-3 text-left"
        >
          <span className="expanded min-w-0 flex-1 text-[18px] font-semibold text-ink">
            {stage.label}
          </span>
          {!expanded && freeMin > 0 ? (
            <span className="tabular flex-shrink-0 text-right text-[13px] font-medium text-ink-2">
              <span className="block">{freeMin} free</span>
              <span className="block">~{roundMin(stage.span.inline_work_min)} min</span>
            </span>
          ) : (
            <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
              ~{roundMin(stage.span.inline_work_min)} min
            </span>
          )}
          <span
            aria-hidden
            className="flex-shrink-0 text-[15px] font-medium leading-none text-ink-2"
          >
            {expanded ? '−' : '+'}
          </span>
        </button>

        {summary && !expanded && (
          <p className="mt-1 truncate text-[13px] text-ink-2">{summary}</p>
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

/** Sum of `duration_typical` across the stage's window hosts — the stage's free minutes,
 *  shown in the duration column only while collapsed (§ StageCard). */
export function freeMinForStage(stage: RenderStage): number {
  return stage.windows.reduce((sum, w) => sum + w.hostDurationTypical, 0)
}

function TaskRow({ task }: { task: RenderTask }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-rule py-3 last:border-b-0">
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span className="block text-[15px] font-medium text-ink">{task.label}</span>
        {task.donenessCue && (
          <span className="mt-0.5 block text-[13px] leading-[1.42] text-ink-2">
            until {task.donenessCue}
          </span>
        )}
      </span>
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
        {task.durationTypical} min
      </span>
    </div>
  )
}
