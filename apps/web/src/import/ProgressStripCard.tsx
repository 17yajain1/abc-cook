import type { ProgressStrip as Strip, SegmentState } from './progressStrip'

const BAR: Record<SegmentState, string> = {
  done: 'bg-home-terracotta',
  active: 'bg-home-peach-rule',
  pending: 'bg-home-rule',
}

/**
 * The importing page's progress card (D1): a headline naming what is being read, over four parts. Static:
 * no animation and no time, because the server says which part it is on and nothing about how long it
 * will take. The headline is the live region, so a screen reader hears each change once.
 */
export function ProgressStripCard({ strip }: { strip: Strip }) {
  return (
    <div className="mt-4 rounded-home-card border border-home-rule bg-home-surface px-4 pb-3 pt-3.5">
      <div className="flex items-center gap-2.5" role="status" aria-live="polite">
        <span aria-hidden="true" className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-home-terracotta" />
        <p className="text-[16px] font-bold leading-[1.25] text-home-ink">{strip.headline}</p>
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-1.5">
        {strip.segments.map((segment) => (
          <li key={segment.key} className="min-w-0">
            <div aria-hidden="true" className={`h-1 rounded-full ${BAR[segment.state]}`} />
            <p
              className={`mt-2 truncate text-[12px] leading-[1.25] ${
                segment.state === 'active' ? 'font-bold text-home-terracotta-text' : 'text-home-ink-2'
              }`}
            >
              {segment.label}
              <span className="sr-only">{segment.state === 'done' ? ', done' : segment.state === 'active' ? ', in progress' : ''}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}
