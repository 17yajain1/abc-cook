import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import { stageColor } from '@/lib/stageColor'

import { hostAttentionSentence, joinLabels, type LaneBar } from './laneGeometry'
import type { RenderPlan } from './derive'
import { taskDurationText } from './StageCard'

const pct = (n: number): string => `${(n * 100).toFixed(2)}%`

/** A host's bar with its step name inside, over up to two lines, shown only when the whole name fits: a
 * clipped "Coâ€¦" says nothing, and the sentence below names every host anyway. */
function HostBar({ bar, place }: { bar: LaneBar; place: CSSProperties }) {
  const label = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const el = label.current
    if (el) setFits(el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight + 1)
  }, [bar.label, bar.from, bar.to])
  return (
    <span
      title={bar.label}
      className="absolute inset-y-0 flex items-center overflow-hidden rounded-[8px] bg-field px-2 text-[12px] font-bold leading-[13px] text-home-ink"
      style={place}
    >
      <span ref={label} className={`block max-h-[26px] min-w-0 flex-1 overflow-hidden ${fits ? '' : 'invisible'}`}>
        {bar.label}
      </span>
    </span>
  )
}

function Bar({ bar }: { bar: LaneBar }) {
  const place = { left: pct(bar.from), width: pct(bar.to - bar.from), minWidth: 4 }
  if (bar.kind === 'meanwhile') {
    return <span className="absolute inset-y-0 rounded-[8px] border-2 border-home-terracotta bg-home-peach" style={place} />
  }
  if (bar.kind === 'host') return <HostBar bar={bar} place={place} />
  return <span className="absolute inset-y-0 rounded-[8px]" style={{ ...place, background: stageColor(bar.stageIndex) }} />
}

/**
 * D5 "How this cook goes": shown only when the scheduler put something in a wait window
 * (`plan.lanes` is `null` otherwise). A two-lane picture, "You" above the host steps that are going, and
 * one sentence per window naming what to do meanwhile. The picture is geometry from the scheduler's own
 * times (`cookLanes.ts`); the words name no stove, since the graph can't say what is on a heat.
 */
export function CookLanes({ plan }: { plan: RenderPlan }) {
  const lanes = plan.lanes
  if (!lanes) return null
  const windows = plan.stages.flatMap((stage) =>
    stage.windows.map((w) => ({ w, host: stage.inlineTasks.find((t) => t.nodeId === w.hostNodeId) })),
  )
  return (
    <section className="px-5 pt-[22px]" aria-labelledby="goes-heading">
      <h2 id="goes-heading" className="text-[20px] font-extrabold leading-[1.2] text-home-ink">
        How this cook goes
      </h2>
      <div className="mt-2.5 rounded-home-card border border-home-rule bg-home-surface px-4 py-3.5">
        <div aria-hidden className="flex items-start gap-3">
          <span className="w-9 flex-shrink-0 pt-1.5 text-[13px] font-bold leading-4 text-home-ink-2">You</span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="relative h-7">
              {lanes.you.map((bar) => (
                <Bar key={`${bar.kind}-${bar.id}`} bar={bar} />
              ))}
            </div>
            {lanes.hosts.map((row, i) => (
              <div key={i} className="relative h-9">
                {row.map((bar) => (
                  <Bar key={bar.id} bar={bar} />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 space-y-2.5">
          {windows.map(({ w, host }) => {
            const line = hostAttentionSentence(w.hostAttention)
            return (
              <p key={w.id} className="text-[15px] leading-[1.45] text-home-ink">
                While <b className="font-bold">{w.hostLabel}</b> is going{host ? ` (${taskDurationText(host)})` : ''}, you can do:{' '}
                {joinLabels(w.tasks.map((t) => t.label))}.{line ? <span className="text-home-ink-2"> {line}</span> : null}
              </p>
            )
          })}
        </div>
      </div>
    </section>
  )
}
