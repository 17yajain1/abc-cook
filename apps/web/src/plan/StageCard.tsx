import { useState } from 'react'

import { roundMin } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderStage } from './derive'
import { WaitWindowBlock } from './WaitWindowBlock'

/**
 * One stage in the vertical plan. Collapsed by default: the rail, label, `~N min`, and a
 * one-line summary of the tasks it still owns. Expanded shows those tasks in full plus
 * any "while this cooks" window it hosts.
 *
 * `~N min` is `span.inline_work_min` — the work this card still shows after the
 * scheduler moved some of it into another stage's window. The frontend does not add
 * that up; it comes from `abc_cook/schedule/rollup.py`.
 *
 * The rail stays **ordinal** (M2.5 decision): ordinal answers "where am I in the
 * recipe?", the time axis answers "when does this happen?", and the time axis belongs to
 * the Map. The number is quiet and structural — neutral ink, no fill, no circle — and
 * the stage tint moved onto the 3px lane rule beneath it. In M2 the number came from
 * render position while the tint came from the graph index, so the two counters could
 * disagree; now only one of them claims to identify the stage.
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
  const [expanded, setExpanded] = useState(defaultExpanded)
  const tint = stageColor(stage.index)
  const summary = stage.inlineTasks.map((t) => t.label).join(' → ')

  return (
    <div className="flex gap-3">
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: 24 }}>
        <span className="tabular text-[13px] font-medium leading-5 text-ink-3">
          {position}
        </span>
        <span
          aria-hidden
          className="mt-1 flex-1"
          style={{ width: 3, background: tint, minHeight: isLast ? 12 : 24 }}
        />
      </div>

      <div className="min-w-0 flex-1 pb-6">
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
          <>
            <ul className="mt-3">
              {stage.inlineTasks.map((task) => (
                <li
                  key={task.nodeId}
                  className="flex items-baseline gap-3 border-b border-rule py-2 last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-ink">
                      {task.label}
                    </span>
                    {task.donenessCue && (
                      <span className="mt-0.5 block text-[13px] text-ink-2">
                        until {task.donenessCue}
                      </span>
                    )}
                  </span>
                  <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
                    {task.durationTypical} min
                  </span>
                </li>
              ))}
            </ul>

            {stage.windows.map((window) => (
              <WaitWindowBlock key={window.id} window={window} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
