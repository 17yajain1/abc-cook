import { useState } from 'react'

import { roundMin } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderStage, RenderTask } from './derive'
import { WaitWindowBlock } from './WaitWindowBlock'

/**
 * One stage in the vertical plan — Direction 3 (docs/DESIGN_SYSTEM.md § Register).
 *
 * The gutter carries a quiet ordinal (neutral ink, no badge) at the head of the stage's
 * 3px tint lane rule: the ordinal answers "where am I in the recipe?", and the tint says
 * "which stage" without competing with signal. Inline work is plain rows on paper. A wait
 * window the stage hosts becomes a full-bleed field, rendered where its host node sits in
 * the scheduled order.
 *
 * When the field would be the stage's *only* content — the host pulled into the field as
 * its subject, nothing left inline — the field **absorbs the stage header** rather than
 * leaving the title stranded on paper above an empty stage.
 */
export function StageCard({
  stage,
  position,
  isLast,
  defaultExpanded,
}: {
  stage: RenderStage
  position: number
  isLast: boolean
  defaultExpanded: boolean
}) {
  const tint = stageColor(stage.index)

  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
  // The host node still appears in `inlineTasks` (derive.ts keeps it there); here it is
  // represented by its field instead of a row.
  const inlineNonHost = stage.inlineTasks.filter((t) => !windowByHost.has(t.nodeId))
  const orphanAbsorb = stage.windows.length > 0 && inlineNonHost.length === 0

  const [expanded, setExpanded] = useState(defaultExpanded)
  const summary = inlineNonHost.map((t) => t.label).join(' → ')

  return (
    <div className="flex gap-3">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: 24 }}>
        {/* In the normal case the ordinal sits in the gutter (DESIGN_SYSTEM.md
            § WaitWindowBlock). In the absorb case the field bleeds across the whole
            gutter, so the ordinal would collide with the absorbed title — there it moves
            inline into the field header instead, same quiet treatment. */}
        {!orphanAbsorb && (
          <>
            <span className="tabular text-[13px] font-medium leading-5 text-ink-3">
              {position}
            </span>
            <span
              aria-hidden
              className="mt-1 flex-1"
              style={{ width: 3, background: tint, minHeight: isLast ? 12 : 24 }}
            />
          </>
        )}
      </div>

      <div className="min-w-0 flex-1 pb-6">
        {orphanAbsorb ? (
          stage.windows.map((window, i) => (
            <WaitWindowBlock
              key={window.id}
              window={window}
              stageLabel={i === 0 ? stage.label : undefined}
              stageOrdinal={i === 0 ? position : undefined}
            />
          ))
        ) : (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="flex w-full items-baseline gap-3 text-left"
            >
              <span className="expanded min-w-0 flex-1 text-[18px] font-semibold text-ink">
                {stage.label}
              </span>
              <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
                ~{roundMin(stage.span.inline_work_min)} min
              </span>
              <span
                aria-hidden
                className="flex-shrink-0 text-[15px] font-medium leading-none text-ink-3"
              >
                {expanded ? '−' : '+'}
              </span>
            </button>

            {summary && !expanded && (
              <p className="mt-1 truncate text-[13px] text-ink-3">{summary}</p>
            )}

            {expanded && (
              <div className="mt-3">
                {stage.inlineTasks.map((task) => {
                  const window = windowByHost.get(task.nodeId)
                  return window ? (
                    <WaitWindowBlock key={window.id} window={window} />
                  ) : (
                    <TaskRow key={task.nodeId} task={task} />
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
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
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
        {task.durationTypical} min
      </span>
    </div>
  )
}
