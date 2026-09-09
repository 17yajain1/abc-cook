import { useState } from 'react'

import { roundMin } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderStage } from './derive'
import { WaitWindowBlock } from './WaitWindowBlock'

/**
 * One stage in the vertical plan. Collapsed by default: badge, label, a `~N min` pill,
 * and a one-line summary of the tasks it still owns. Expanded shows those tasks in full
 * plus any "while this cooks" window it hosts.
 *
 * `~N min` is `span.inline_work_min` — the work this card still shows after the
 * scheduler moved some of it into another stage's window. The frontend does not add
 * that up; it comes from `abc_cook/schedule/rollup.py`.
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
      <div className="flex flex-shrink-0 flex-col items-center" style={{ width: 32 }}>
        <span
          className="tabular flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-ground"
          style={{ background: tint }}
        >
          {position}
        </span>
        {!isLast && (
          <span
            aria-hidden
            className="mt-1 w-0.5 flex-1"
            style={{ background: 'linear-gradient(to bottom, var(--color-line-strong), var(--color-line))', minHeight: 24 }}
          />
        )}
      </div>

      <div className="min-w-0 flex-1 pb-5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-start gap-2 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-ink">{stage.label}</span>
              <span className="tabular rounded-full bg-surface-raised px-2 py-0.5 text-xs text-ink-muted">
                ~{roundMin(stage.span.inline_work_min)} min
              </span>
            </span>
            {summary && !expanded && (
              <span className="mt-1 block truncate text-xs text-ink-dim">{summary}</span>
            )}
          </span>
          <span
            aria-hidden
            className="mt-1 flex-shrink-0 text-ink-dim transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          >
            ›
          </span>
        </button>

        {expanded && (
          <>
            <ul className="mt-3 space-y-2">
              {stage.inlineTasks.map((task) => (
                <li key={task.nodeId} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-0.5 h-4 w-1 flex-shrink-0 rounded-full"
                    style={{ background: tint }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-ink">{task.label}</span>
                    <span className="tabular ml-2 text-xs text-ink-dim">
                      {task.durationTypical} min
                    </span>
                    {task.donenessCue && (
                      <span className="mt-0.5 block text-xs italic text-ink-dim">
                        until {task.donenessCue}
                      </span>
                    )}
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
