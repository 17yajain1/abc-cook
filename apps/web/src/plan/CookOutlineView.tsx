import type { CookOutline as CookOutlineData } from './cookOutline'

const HATCH =
  'repeating-linear-gradient(135deg, var(--color-home-ink-2) 0 1.5px, transparent 1.5px 5px)'

/**
 * R2: "How this cook goes" — a broken-axis mini bar over a stretch → wait → stretch list.
 * Renders `CookOutline` (built in `cookOutline.ts`) and nothing else: no figure here is
 * computed. The bar is `aria-hidden`; the rows below carry the same facts as text.
 */
export function CookOutlineView({ outline }: { outline: CookOutlineData }) {
  return (
    <section className="mt-5" aria-label="How this cook goes">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-home-ink">How this cook goes</h2>
        {outline.savedPill && (
          <span className="tabular flex-shrink-0 rounded-full bg-home-sage px-3 py-1 text-[13px] font-semibold text-home-sage-chip-text">
            {outline.savedPill}
          </span>
        )}
      </div>

      <MiniBar outline={outline} />

      <ol className="mt-3">
        {outline.stretches.map((stretch, i) => (
          <li key={i}>
            <div className="flex items-baseline gap-3 py-2">
              <span className="w-10 flex-shrink-0 text-[12px] font-semibold text-home-terracotta-text">
                {stretch.tag}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[15px] font-semibold leading-[1.3] text-home-ink">
                  {stretch.title}
                </p>
                {stretch.taskLines.map((line) => (
                  <p key={line} className="mt-0.5 text-[13px] leading-[1.4] text-home-ink-2">
                    {line}
                  </p>
                ))}
              </div>
              {stretch.time && (
                <span className="tabular flex-shrink-0 text-[13px] font-medium text-home-ink-2">
                  {stretch.time}
                </span>
              )}
            </div>
            {outline.waits[i] && (
              <div className="flex items-center gap-3 py-2">
                <span className="flex w-10 flex-shrink-0 items-center">
                  <span
                    aria-hidden
                    className="h-[10px] w-[28px] rounded-[2px] border border-home-ink-2"
                    style={{ backgroundImage: HATCH }}
                  />
                </span>
                <p className="text-[13px] text-home-ink-2">{outline.waits[i].text}</p>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Broken axis: stretches are proportional to each other; every wait is one fixed-width
 * hatched gap, so a 19-hour wait cannot flatten a 10-minute stretch to nothing. */
function MiniBar({ outline }: { outline: CookOutlineData }) {
  return (
    <div aria-hidden className="mb-5 mt-3 flex items-start">
      {outline.stretches.map((stretch, i) => (
        <div key={i} className="contents">
          <div
            className="h-[10px] rounded-[2px] bg-home-ink"
            style={{ flex: `${stretch.barWeight} 1 0`, minWidth: 6 }}
          />
          {outline.waits[i] && (
            <div className="relative w-[56px] flex-shrink-0 px-1">
              <div
                className="h-[10px] w-full border-y border-home-ink-2"
                style={{ backgroundImage: HATCH }}
              />
              <span className="tabular absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap text-[11px] leading-[1.15] text-home-ink-2">
                {outline.waits[i].barLabel}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
