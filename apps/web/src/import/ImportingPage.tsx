import type { MutableRefObject, ReactNode } from 'react'

import { sourceLink } from '@/lib/source'

import { BackButton } from '../plan/BackButton'
import { IngredientList } from '../plan/IngredientList'
import { RecipePage } from '../plan/RecipePage'
import { RecipeThumbnail } from '../plan/RecipeThumbnail'
import { previewIngredientGroups } from './draftView'
import type { ImportViewModel } from './importView'
import { ProgressStripCard } from './ProgressStripCard'
import type { ProgressStrip as Strip } from './progressStrip'
import { anchorFrom, measureSections, type ScrollAnchor } from './scrollAnchor'

/** What the page's footer offers. Working: a disabled "Planning your cook…". Failed: the failure's primary action. */
export type ImportingFooter = { kind: 'working' } | { kind: 'action'; label: string; onClick: () => void }

const SECTION_TITLE = 'text-[20px] font-extrabold leading-[1.2] text-home-ink'
const PRIMARY =
  'flex h-14 w-full items-center justify-center rounded-full bg-home-terracotta text-[17px] font-bold text-home-ground'

/**
 * The recipe page while the import fills it in (D1): the same header, What you need and Steps as the
 * finished page, in the `importing` mode of `RecipePage`. The extraction's draft takes the place of the
 * plan: ingredients in full, steps as a plain numbered list in the source's wording, and skeletons where
 * the scheduler's figures will go.
 *
 * Source text and draft text only, rendered as received: no durations, no timers, no start-time advice, no
 * shimmer and no animation. This page sits *before* the scheduler and must not borrow its authority
 * (CLAUDE.md: the frontend renders `CookingPlan`, nothing more). The draft lists are append-only, so a row
 * on screen never moves while it streams.
 *
 * `slot` replaces the progress strip with a failure card (or the "taking longer" line), and on a failure the
 * footer button becomes that card's primary action; `ImportProgress` builds both.
 */
export function ImportingPage({
  view,
  strip,
  slot,
  footer,
  sourceKey,
  sourceUrl,
  isText,
  addedLabel,
  anchorRef,
  stopped,
  onBack,
  onThumbnailLoaded,
}: {
  view: ImportViewModel
  /** The progress strip, while the job runs. */
  strip: Strip | null
  /** Replaces the strip: the failure card, or the "taking longer" line. */
  slot?: ReactNode
  footer: ImportingFooter
  /** The thumbnail's source key (a YouTube link only). */
  sourceKey: string | null
  sourceUrl: string | null
  isText: boolean
  addedLabel?: string
  /** Receives where the cook is reading, for the swap to the plan. */
  anchorRef: MutableRefObject<ScrollAnchor | null>
  /** The import has stopped: "Importing…" is no longer true, and the sections that never filled are dropped. */
  stopped: boolean
  onBack: () => void
  onThumbnailLoaded?: () => void
}) {
  const header = view.header
  const source = sourceLink(sourceUrl)
  const sourceName = isText ? 'pasted text' : source?.name
  const sourceLine = [header?.channel, sourceName ? `From ${sourceName}` : null].filter(Boolean).join(' · ')
  let stepNumber = 0

  return (
    <RecipePage
      mode="importing"
      bottomPad="pb-[calc(8rem+var(--safe-bottom))]"
      onScroll={(e) => {
        const el = e.currentTarget
        const measured = measureSections(el)
        anchorRef.current = measured
          ? anchorFrom(el.scrollTop, measured.tops)
          : { section: 'top', offset: Math.max(0, el.scrollTop) }
      }}
      footer={
        footer.kind === 'action' ? (
          <button type="button" onClick={footer.onClick} className={PRIMARY}>
            {footer.label}
          </button>
        ) : (
          <button
            type="button"
            disabled
            className={`${PRIMARY} disabled:bg-home-disabled disabled:text-home-disabled-ink`}
          >
            Planning your cook…
          </button>
        )
      }
    >
      <header className="flex-shrink-0 px-5 pb-4 pt-[calc(12px+var(--safe-top))]">
        <div className="-ml-2 mb-3 flex items-center justify-between gap-3">
          <BackButton onClick={onBack} circled />
          {!stopped && <span className="text-[13px] font-medium text-home-ink-2">Importing…</span>}
        </div>
        <RecipeThumbnail sourceKey={sourceKey} onLoaded={onThumbnailLoaded} />
        {header?.title ? (
          <h1 className="line-clamp-3 text-[30px] font-extrabold leading-[1.35] tracking-[-0.3px] text-home-ink">
            {header.title}
          </h1>
        ) : (
          // Two lines of the title's own line height, so the strip below does not move when a typical title lands.
          !stopped && (
            <div aria-hidden="true" className="flex h-[81px] flex-col justify-center gap-3">
              <div className="h-[22px] w-full rounded-full bg-home-skeleton-1" />
              <div className="h-[22px] w-3/5 rounded-full bg-home-skeleton-1" />
            </div>
          )
        )}
        {sourceLine && <p className="mt-1.5 text-[14px] text-home-ink-2">{sourceLine}</p>}

        {slot ?? (strip && <ProgressStripCard strip={strip} />)}

        {!stopped && (
          <>
            <div aria-hidden="true" className="mt-3.5 grid grid-cols-3 gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex min-h-[62px] flex-col justify-center gap-2 rounded-home-mini bg-home-skeleton-1 px-3"
                >
                  <div className="h-3 w-3/4 rounded-full bg-home-skeleton-2" />
                  <div className="h-2.5 w-1/2 rounded-full bg-home-skeleton-2" />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-[1.4] text-home-ink-2">
              Time and servings appear when your plan is ready.
            </p>
          </>
        )}
      </header>

      {view.ingredients.kind !== 'none' && (
        <section className="px-5 pt-[22px]" aria-labelledby="need-heading" data-anchor="need">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="need-heading" className={SECTION_TITLE}>
              What you need
            </h2>
            {view.ingredients.kind !== 'pending' && (
              <span className="tabular text-[13px] text-home-ink-2">{ingredientCount(view)}</span>
            )}
          </div>
          <div className="mt-2.5">
            {view.ingredients.kind === 'items' ? (
              <IngredientList groups={view.ingredients.groups} />
            ) : view.ingredients.kind === 'lines' ? (
              <IngredientList groups={previewIngredientGroups(view.ingredients.lines)} />
            ) : (
              <Pending />
            )}
          </div>
        </section>
      )}

      {view.method.kind !== 'none' && (
        <section className="px-5 pt-[22px]" aria-labelledby="steps-heading" data-anchor="steps">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="steps-heading" className={SECTION_TITLE}>
              Steps
            </h2>
            <span className="text-[13px] text-home-ink-2">Still being worked out</span>
          </div>
          <div className="mt-2.5">
            {view.method.kind === 'steps' ? (
              <ol>
                {view.method.steps.map((line, i) => (
                  <Step
                    key={i}
                    number={i + 1}
                    text={line}
                    note={view.method.kind === 'steps' && view.method.added?.[i] ? addedLabel : undefined}
                  />
                ))}
              </ol>
            ) : view.method.kind === 'sections' ? (
              view.method.sections.map((section, s) => (
                <div key={`${s}-${section.heading ?? ''}`} className="mt-3 first:mt-0">
                  {section.heading && (
                    <h3 className="mb-1 text-[15px] font-semibold text-home-ink-2">{section.heading}</h3>
                  )}
                  <ol>
                    {section.lines.map((line, i) => {
                      stepNumber += 1
                      return <Step key={`${i}-${line}`} number={stepNumber} text={line} />
                    })}
                  </ol>
                </div>
              ))
            ) : null}
            {(view.method.kind === 'pending' ||
              (view.method.kind === 'steps' && !view.method.complete && !stopped)) && <Pending />}
          </div>
        </section>
      )}
    </RecipePage>
  )
}

/** "N ingredients", from the rows on screen. */
function ingredientCount(view: ImportViewModel): string {
  const n =
    view.ingredients.kind === 'items'
      ? view.ingredients.groups.reduce((sum, g) => sum + g.items.length, 0)
      : view.ingredients.kind === 'lines'
        ? view.ingredients.lines.length
        : 0
  return `${n} ${n === 1 ? 'ingredient' : 'ingredients'}`
}

function Step({ number, text, note }: { number: number; text: string; note?: string }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span className="tabular w-5 flex-shrink-0 pt-px text-[15px] font-bold text-home-ink-2">{number}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-[1.55] text-home-ink-2">{text}</span>
        {note && <span className="block text-[13px] leading-[1.4] text-home-ink-2">{note}</span>}
      </span>
    </li>
  )
}

/** Two static bars where a section will appear: no shimmer, no promise of how long. */
const PENDING_WIDTHS = ['72%', '56%']
function Pending() {
  return (
    <div className="mt-1 space-y-3" aria-hidden="true">
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
