import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { IngredientRow } from '../plan/IngredientRow'
import type { ImportViewModel } from './importView'

/** YouTube serves a 120px-wide grey placeholder (HTTP 200) for an id with no thumbnail. */
const YT_PLACEHOLDER_WIDTH = 120

/**
 * The import screen while a job runs: what the source itself has said so far (ported from
 * `RecipePreview`, which this replaces).
 *
 * Source text only, rendered exactly as received — no durations, no timers, no start-time
 * advice, no shimmer. This screen sits *before* the scheduler and must not borrow its
 * authority (CLAUDE.md: the frontend renders `CookingPlan`, nothing more). Presentation
 * follows `DESIGN_SYSTEM.md`: paper, ink, hairline rules, no cards, no pills. The
 * masthead uses the recipe page's title scale (30 / 700 / 34) so the hand-off to the plan
 * doesn't change the type.
 */
export function ImportDraft({
  view,
  footer,
  failure,
  onCancel,
  onThumbnailLoaded,
}: {
  view: ImportViewModel
  /** The quiet line pinned under the page, e.g. "Building your cooking plan…". Absent in a
   * failed state, where the message lives in `failure` and must not appear twice. */
  footer?: ReactNode
  /** A failed job's message and its actions, in the body where Ingredients would be. */
  failure?: ReactNode
  onCancel: () => void
  onThumbnailLoaded?: () => void
}) {
  let stepNumber = 0
  const header = view.header

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex flex-shrink-0 justify-end px-5 pt-3.5" style={{ minHeight: 32 }}>
        <button
          type="button"
          onClick={onCancel}
          className="-my-3 py-3 pl-3 text-[13px] text-ink-3 underline underline-offset-[3px]"
        >
          Cancel
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        {header && (
          <header>
            {header.thumbnailUrl && (
              <Thumbnail url={header.thumbnailUrl} onLoaded={onThumbnailLoaded} />
            )}
            {header.channel && (
              <p className="mt-3 text-[13px] font-medium text-ink-3">{header.channel}</p>
            )}
            {header.title && (
              <h1
                className={`${header.channel ? 'mt-1' : 'mt-3'} text-[30px] font-bold leading-[34px] tracking-[-0.5px] text-ink`}
              >
                {header.title}
              </h1>
            )}
            {header.description && <Description text={header.description} />}
          </header>
        )}

        {failure && <section className="mt-8">{failure}</section>}

        {view.ingredients.kind !== 'none' && (
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold text-ink">Ingredients</h2>
            {view.ingredients.kind === 'lines' ? (
              <ul className="mt-2 border-t border-rule">
                {view.ingredients.lines.map((line, i) => (
                  <IngredientRow key={`${i}-${line}`} tone="plan" primary={line} />
                ))}
              </ul>
            ) : (
              <Pending />
            )}
          </section>
        )}

        {view.method.kind !== 'none' && (
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold text-ink">Method</h2>
            {view.method.kind === 'sections' ? (
              view.method.sections.map((section, s) => (
                <div key={`${s}-${section.heading ?? ''}`} className="mt-3">
                  {section.heading && (
                    <h3 className="mb-1 text-[15px] font-medium text-ink-2">{section.heading}</h3>
                  )}
                  <ol>
                    {section.lines.map((line, i) => {
                      stepNumber += 1
                      return (
                        <li key={`${i}-${line}`} className="flex gap-3 py-2">
                          <span className="tabular w-5 flex-shrink-0 pt-px text-right text-[13px] text-ink-3">
                            {stepNumber}
                          </span>
                          <span className="text-[15px] leading-[1.55] text-ink">{line}</span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              ))
            ) : (
              <Pending />
            )}
          </section>
        )}
      </div>

      {footer != null && (
        <div
          className="flex-shrink-0 border-t border-rule px-5 pb-6 pt-4 text-[15px] text-ink-2"
          role="status"
          aria-live="polite"
        >
          {footer}
        </div>
      )}
    </div>
  )
}

/** A section the source hasn't filled yet: one quiet line, no shimmer, no skeleton. */
function Pending() {
  return <p className="mt-2 text-[13px] text-ink-3">Appears once the recipe is read.</p>
}

/**
 * 16:9, hidden outright if the image fails or is YouTube's grey placeholder. The box holds
 * its space (paper-sunk, a recessed band) while the image loads, so nothing shifts under
 * the cook's thumb when it paints.
 */
function Thumbnail({ url, onLoaded }: { url: string; onLoaded?: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="aspect-video w-full overflow-hidden border border-rule bg-paper-sunk">
      <img
        key={url}
        src={url}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setHidden(true)}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth === YT_PLACEHOLDER_WIDTH) setHidden(true)
          else onLoaded?.()
        }}
      />
    </div>
  )
}

/** The source's own description, clamped to four lines; "More" only when it is cut. */
function Description({ text: raw }: { text: string }) {
  // Blank lines are collapsed: inside a four-line clamp each one would cost a whole line.
  const text = raw.replace(/\n\s*\n+/g, '\n').trim()
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  return (
    <div className="mt-3">
      <p
        ref={ref}
        className={`whitespace-pre-line break-words text-[15px] leading-[1.5] text-ink-2 ${expanded ? '' : 'line-clamp-4'}`}
      >
        {text}
      </p>
      {clamped && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 min-h-[44px] text-[13px] font-semibold text-ink underline underline-offset-4"
        >
          More
        </button>
      )}
    </div>
  )
}
