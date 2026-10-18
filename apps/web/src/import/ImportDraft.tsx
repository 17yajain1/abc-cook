import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { IngredientList } from '../plan/IngredientList'
import { previewIngredientGroups } from './draftView'
import type { ImportViewModel } from './importView'

/** YouTube serves a 120px-wide grey placeholder (HTTP 200) for an id with no thumbnail. */
const YT_PLACEHOLDER_WIDTH = 120

/** The label on a section while it shows the draft, not the source's own text. */
const DRAFT_LABEL = 'Draft'

/**
 * The reading screen while a job runs: what the source itself has said so far, and the
 * extraction's draft of the recipe as it streams in.
 *
 * Home register (`DESIGN_SYSTEM.md` § Register: Home): the same ground as the Copy sheet
 * and the recipe page, so nothing flips at the hand-off. Order, top to bottom: thumbnail,
 * channel, title, Ingredients, Steps, then "About this video". The description sits last
 * so the recipe arrives under the cook's thumb first; before the draft starts, the two
 * recipe sections are a few static bars, so the description still shows on the first
 * screen.
 *
 * The title is the source's raw one, at Home's screen-title size (22 / 700) and clamped to
 * three lines: a real video title runs 60-100 characters, which at the recipe page's 30px
 * is four or five lines and pushes the description off the first screen. The leading is 30,
 * not the spec's 26: the clamp clips overflow, and a Devanagari title loses its top marks
 * (a "की" reads as "को") below about 1.35. The recipe page after the tap shows the plan's
 * own title in full.
 *
 * Source text and draft text only, rendered exactly as received: no durations, no timers,
 * no start-time advice, no shimmer. This screen sits *before* the scheduler and must not
 * borrow its authority (CLAUDE.md: the frontend renders `CookingPlan`, nothing more). The
 * draft lists are append-only, so a row on screen never moves while it streams.
 */
export function ImportDraft({
  view,
  footer,
  working = false,
  failure,
  onCancel,
  cancelLabel = 'Cancel',
  onThumbnailLoaded,
}: {
  view: ImportViewModel
  /** The job is still running: a small pulsing dot sits beside the footer line. It does not
   * pulse for people who ask for reduced motion, and is not shown once the job has ended. */
  working?: boolean
  /** The quiet line pinned under the page, e.g. "Reading the steps…". Absent in a failed
   * state, where the message lives in `failure` and must not appear twice. */
  footer?: ReactNode
  /** A failed job's message and its actions, under the header and above the sections. */
  failure?: ReactNode
  onCancel: () => void
  /** "Close" once the plan is ready and saved: nothing is being cancelled any more. */
  cancelLabel?: string
  onThumbnailLoaded?: () => void
}) {
  let stepNumber = 0
  const header = view.header
  // The bar is the Home ground and sits above the scroller, so the page never scrolls under
  // it; its hairline appears only once something has scrolled beneath.
  const [scrolled, setScrolled] = useState(false)

  return (
    <div className="flex h-full flex-col bg-home-ground text-home-ink">
      <div
        className={`flex h-12 flex-shrink-0 items-center justify-end border-b bg-home-ground px-5 ${scrolled ? 'border-home-rule' : 'border-transparent'}`}
      >
        <button
          type="button"
          onClick={onCancel}
          className="-mr-3 flex min-h-[44px] items-center px-3 text-[13px] text-home-ink-2 underline underline-offset-[3px]"
        >
          {cancelLabel}
        </button>
      </div>

      <div
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
      >
        {header && (
          <header>
            {header.thumbnailUrl && (
              <Thumbnail url={header.thumbnailUrl} onLoaded={onThumbnailLoaded} />
            )}
            {header.channel && (
              <p className="mt-3 text-[13px] font-normal text-home-ink-2">{header.channel}</p>
            )}
            {header.title && (
              <h1
                className={`${header.channel ? 'mt-1' : 'mt-3'} line-clamp-3 text-[22px] font-bold leading-[30px] tracking-[-0.3px] text-home-ink`}
              >
                {header.title}
              </h1>
            )}
          </header>
        )}

        {failure && <section className="mt-8">{failure}</section>}

        {view.ingredients.kind !== 'none' && (
          <section className="mt-8">
            <SectionHead title="Ingredients" draft={view.ingredients.kind === 'items'} />
            {view.ingredients.kind === 'items' ? (
              <div className="mt-2">
                <IngredientList groups={view.ingredients.groups} />
              </div>
            ) : view.ingredients.kind === 'lines' ? (
              <div className="mt-2">
                <IngredientList groups={previewIngredientGroups(view.ingredients.lines)} />
              </div>
            ) : (
              <Pending />
            )}
          </section>
        )}

        {view.method.kind !== 'none' && (
          <section className="mt-8">
            <SectionHead title="Steps" draft={view.method.kind === 'steps'} />
            {view.method.kind === 'steps' ? (
              <ol className="mt-2">
                {view.method.steps.map((line, i) => (
                  <Step key={i} number={i + 1} text={line} />
                ))}
              </ol>
            ) : view.method.kind === 'sections' ? (
              view.method.sections.map((section, s) => (
                <div key={`${s}-${section.heading ?? ''}`} className="mt-3">
                  {section.heading && (
                    <h3 className="mb-1 text-[15px] font-semibold text-home-ink-2">
                      {section.heading}
                    </h3>
                  )}
                  <ol>
                    {section.lines.map((line, i) => {
                      stepNumber += 1
                      return <Step key={`${i}-${line}`} number={stepNumber} text={line} />
                    })}
                  </ol>
                </div>
              ))
            ) : (
              <Pending />
            )}
          </section>
        )}

        {header?.description && (
          <section className="mt-8">
            <h2 className={HEADING}>About this video</h2>
            <Description text={header.description} />
          </section>
        )}
      </div>

      {footer != null && (
        <div
          className="flex flex-shrink-0 items-center gap-3 border-t border-home-rule bg-home-ground px-5 pb-6 pt-4 text-[15px] text-home-ink-2"
          role="status"
          aria-live="polite"
        >
          {working && (
            <span
              aria-hidden="true"
              className="h-2 w-2 flex-shrink-0 rounded-full bg-home-terracotta motion-safe:animate-pulse"
            />
          )}
          <div className="min-w-0 flex-1">{footer}</div>
        </div>
      )}
    </div>
  )
}

/** Home's tile / card title: 18 / 700 / 22. */
const HEADING = 'text-[18px] font-bold leading-[22px] text-home-ink'

/** A section heading, with the "Draft" label beside it only while the content is the draft. */
function SectionHead({ title, draft }: { title: string; draft: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className={HEADING}>{title}</h2>
      {draft && (
        <span className="rounded-full border border-home-rule bg-home-surface px-2 py-0.5 text-[12px] font-semibold text-home-ink-2">
          {DRAFT_LABEL}
        </span>
      )}
    </div>
  )
}

function Step({ number, text }: { number: number; text: string }) {
  return (
    <li className="flex gap-3 py-2">
      <span className="tabular w-5 flex-shrink-0 pt-px text-right text-[13px] text-home-ink-2">
        {number}
      </span>
      <span className="text-[15px] leading-[1.55] text-home-ink">{text}</span>
    </li>
  )
}

/** Two static bars where a section will appear: no shimmer, no promise of how long. Kept to
 * two so "About this video" is still on the first screen while the draft is being read. */
const PENDING_WIDTHS = ['72%', '56%']
function Pending() {
  return (
    <div className="mt-3 space-y-3" aria-hidden="true">
      {PENDING_WIDTHS.map((width, i) => (
        <div
          key={width}
          className={`h-3 rounded-full ${i % 2 === 0 ? 'bg-home-skeleton-1' : 'bg-home-skeleton-2'}`}
          style={{ width }}
        />
      ))}
    </div>
  )
}

/**
 * 16:9, hidden outright if the image fails or is YouTube's grey placeholder. The box holds
 * its space (the Home thumbnail ground) while the image loads, so nothing shifts under the
 * cook's thumb when it paints.
 */
function Thumbnail({ url, onLoaded }: { url: string; onLoaded?: () => void }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  return (
    <div className="aspect-video w-full overflow-hidden rounded-home-card border border-home-rule bg-home-thumb">
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

/** The source's own description, clamped to two lines; "More" only when it is cut. */
function Description({ text: raw }: { text: string }) {
  // Blank lines are collapsed: inside a two-line clamp each one would cost a whole line.
  const text = raw.replace(/\n\s*\n+/g, '\n').trim()
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const ref = useRef<HTMLParagraphElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && !expanded) setClamped(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  return (
    <div className="mt-2">
      <p
        ref={ref}
        className={`whitespace-pre-line break-words text-[15px] leading-[1.5] text-home-ink-2 ${expanded ? '' : 'line-clamp-2'}`}
      >
        {text}
      </p>
      {clamped && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 min-h-[44px] text-[13px] font-semibold text-home-ink underline underline-offset-4"
        >
          More
        </button>
      )}
    </div>
  )
}
