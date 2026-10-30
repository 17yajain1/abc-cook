import type { ReactNode } from 'react'

import type { ImportJobResponse } from '@abc-cook/schema'

import { IngredientList } from '../plan/IngredientList'
import { addedStepLabel } from '@/lib/addedStep'
import { canonicalUrlSourceKey } from '@/library/sourceKey'
import { useHomeSurface } from '@/shell/useHomeSurface'

import { draftIngredientGroups } from './draftView'
import { ImportingPage, type ImportingFooter } from './ImportingPage'
import { importViewFor } from './importView'
import { notGroundedCopy } from './notGroundedCopy'
import { FAILURE_COPY, FAILURE_HINT, type ImportFailure } from './phase'
import { progressStripFor, sourceKindFor } from './progressStrip'
import { useImportJob, type Phase } from './useImportJob'

/** Home's primary button: a terracotta pill, sentence case (DESIGN_SYSTEM.md, Register: Home). */
const PRIMARY =
  'h-14 w-full rounded-full bg-home-terracotta text-[15px] font-semibold text-home-ground disabled:bg-home-disabled disabled:text-home-disabled-ink'
const LINK =
  'flex min-h-[44px] items-center justify-center text-[15px] text-home-ink-2 underline underline-offset-4'
/** Home's screen title: 22 / 700 / 26. */
const TITLE = 'text-[22px] font-bold leading-[26px] tracking-[-0.3px] text-home-ink'

const NO_RECIPE_COPY = 'That page doesn’t have a recipe we can read.'

/** Phases `ImportProgress` takes over the whole screen for. `entry` and `error` with nothing read
 * stay inline wherever the entry form lives (the Cookbook's form, or the Home Copy sheet). `slow`
 * is a running job that has outlasted the poll ceiling, so the page stays up with "Keep waiting". */
export function isProgressPhase(phase: Phase): boolean {
  return (
    phase.kind === 'polling' ||
    phase.kind === 'slow' ||
    phase.kind === 'no_recipe' ||
    phase.kind === 'paste' ||
    phase.kind === 'failed' ||
    phase.kind === 'not_grounded' ||
    (phase.kind === 'error' &&
      (phase.preview != null || phase.acquired != null || phase.draft != null))
  )
}

/**
 * The non-entry branches of the import flow: reading (polling, slow), failed, error with something read,
 * no recipe, paste, no method found. Render only when `isProgressPhase(job.phase)`. Reading, failed and
 * error are the importing mode of the recipe page itself (`ImportingPage`): the finished plan replaces
 * its draft in place, so there is no ready screen. Every branch is the Home register, the same ground as
 * the Copy sheet and the recipe page, so nothing flips at the hand-off.
 */
export function ImportProgress({
  job,
  onCancel,
}: {
  job: ReturnType<typeof useImportJob>
  onCancel: () => void
}) {
  const { phase, setPhase, text, setText, submitText, reset, retry, canRetry, keepWaiting, instant, isText, markThumbnail, anchorRef, url } =
    job
  // FGC-3: the line under a step the model added; the wording follows the source being read.
  const addedLabel = addedStepLabel(isText ? { kind: 'text', value: '' } : { kind: 'url', value: url })
  // The page behind the app is the Home ground too (safe-area strip, over-scroll).
  useHomeSurface(true)

  if (phase.kind === 'polling' || phase.kind === 'slow') {
    // Whatever the source has said so far (thumbnail and title at once for a YouTube link, then a blog
    // page's own recipe, and the extraction's draft as it streams) fills the recipe page in place. A pasted
    // text has no header, but the sections are there from the start; for a link with nothing known yet,
    // the plain status word.
    const view = importViewFor({
      instant,
      acquired: phase.acquired,
      preview: phase.preview,
      draft: phase.draft,
      status: phase.status,
    })
    const strip = progressStripFor(view, phase.status, {
      kind: sourceKindFor(url, isText),
      preview: phase.preview != null,
    })
    if (phase.kind === 'polling' && !(view.header || phase.preview || phase.draft || isText)) {
      return <Centered>{strip.headline}</Centered>
    }
    return (
      <ImportingPage
        view={view}
        strip={strip}
        slot={
          phase.kind === 'slow' ? (
            <div role="status" className="mt-3 border-t border-home-rule pt-3">
              <p className="text-[15px] leading-[1.4] text-home-ink">This is taking longer than expected.</p>
              <button
                type="button"
                onClick={keepWaiting}
                className="-mb-2 mt-1 min-h-[44px] text-[15px] font-semibold text-home-ink underline underline-offset-4"
              >
                Keep waiting
              </button>
            </div>
          ) : undefined
        }
        footer={{ kind: 'working' }}
        sourceKey={sourceKeyFor(instant != null, url)}
        sourceUrl={isText ? null : url}
        isText={isText}
        addedLabel={addedLabel}
        anchorRef={anchorRef}
        stopped={false}
        onBack={reset}
        onThumbnailLoaded={markThumbnail}
      />
    )
  }

  if (phase.kind === 'failed' || (phase.kind === 'error' && (phase.preview || phase.acquired || phase.draft))) {
    // The page stays: header, thumbnail, and whatever was read. The message takes the progress strip's
    // slot, and the footer button is the card's primary action, so each action is on screen once. With
    // nothing read, the sections that were never going to fill are dropped.
    const view = importViewFor({
      instant,
      acquired: phase.acquired,
      preview: phase.preview,
      draft: phase.draft,
      status: 'failed',
    })
    const { card, footer } =
      phase.kind === 'failed'
        ? failureFor(phase.failure, { retry, canRetry, paste: () => setPhase({ kind: 'paste', error: null }), another: reset })
        : errorFor(phase.message, retry, canRetry)
    return (
      <ImportingPage
        view={view}
        strip={null}
        slot={card}
        footer={footer}
        sourceKey={sourceKeyFor(instant != null, url)}
        sourceUrl={isText ? null : url}
        isText={isText}
        addedLabel={addedLabel}
        anchorRef={anchorRef}
        stopped
        onBack={onCancel}
        onThumbnailLoaded={markThumbnail}
      />
    )
  }

  if (phase.kind === 'no_recipe') {
    return (
      <NoRecipeResult
        onPaste={() => setPhase({ kind: 'paste', error: null })}
        onTryAnother={reset}
        onCancel={onCancel}
      />
    )
  }

  if (phase.kind === 'paste') {
    return (
      <PasteScreen
        text={text}
        onChange={setText}
        error={phase.error}
        onSubmit={submitText}
        onBack={() => setPhase({ kind: 'entry' })}
      />
    )
  }

  if (phase.kind === 'not_grounded') {
    return <NotGroundedResult job={phase.job} onTryAnother={reset} onCancel={onCancel} />
  }

  return null
}

/** The thumbnail's key: only a link the instant header recognised (YouTube) has a picture to show. */
function sourceKeyFor(hasInstant: boolean, url: string): string | null {
  return hasInstant ? canonicalUrlSourceKey(url.trim()) : null
}

const CARD = 'mt-4 rounded-home-card border border-home-rule bg-home-surface px-4 py-3.5'

/** What a failed import says and offers. `unavailable` is the provider's fault, so trying again is
 * reasonable; `incomplete` and `refused` would most likely fail the same way, so they offer the other two
 * routes in: paste the text (the footer's button) or another link (under the message). */
function failureFor(
  failure: ImportFailure,
  on: { retry: () => void; canRetry: boolean; paste: () => void; another: () => void },
): { card: ReactNode; footer: ImportingFooter } {
  const card = (
    <div role="alert" className={CARD}>
      <p className="text-[15px] leading-[1.45] text-home-ink">{FAILURE_COPY[failure]}</p>
      {FAILURE_HINT[failure] && (
        <p className="mt-1 text-[15px] leading-[1.45] text-home-ink-2">{FAILURE_HINT[failure]}</p>
      )}
      {failure !== 'unavailable' && (
        <button type="button" onClick={on.another} className={`-mb-2 mt-1 w-full justify-start ${LINK}`}>
          Try another link
        </button>
      )}
    </div>
  )
  const footer: ImportingFooter =
    failure === 'unavailable'
      ? { kind: 'action', ...retryAction(on.canRetry), onClick: on.retry }
      : { kind: 'action', label: 'Paste the recipe text', onClick: on.paste }
  return { card, footer }
}

/** The footer's label for `retry`: it only says "Try again" when there is something to resubmit. Otherwise the
 * same handler resets to the entry form, and the label says so (a primary button is never a no-op). */
function retryAction(canRetry: boolean): { label: string } {
  return { label: canRetry ? 'Try again' : 'Back to import' }
}

/** A broken import with something read (a lost connection, a server fault): the message, and Try again. */
function errorFor(message: string, retry: () => void, canRetry: boolean): { card: ReactNode; footer: ImportingFooter } {
  return {
    card: (
      <div role="alert" className={CARD}>
        <p className="text-[15px] leading-[1.45] text-home-ink">{message}</p>
      </div>
    ),
    footer: { kind: 'action', ...retryAction(canRetry), onClick: retry },
  }
}

function NotGroundedResult({
  job,
  onTryAnother,
  onCancel,
}: {
  job: ImportJobResponse
  onTryAnother: () => void
  onCancel: () => void
}) {
  const result = job.result
  const groups = draftIngredientGroups(result?.ingredients ?? [])
  const truncationWarning = result?.warnings?.find((w) => w.startsWith('Transcript truncated'))

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-home-ground px-5 pb-8 pt-16 text-home-ink">
      <h1 className={TITLE}>No method found</h1>
      <p className="mt-1 text-[15px] text-home-ink-2">
        {notGroundedCopy(result?.sources ?? [], groups.length > 0, result?.transcript_kind)}
        {groups.length > 0 ? ' — but here’s the shopping list.' : ''}
      </p>
      {truncationWarning && <p className="mt-1 text-[13px] text-home-ink-2">{truncationWarning}</p>}

      {groups.length > 0 && (
        <div className="mt-6">
          <IngredientList groups={groups} />
        </div>
      )}

      <button type="button" onClick={onTryAnother} className={`mt-8 ${PRIMARY}`}>
        Try another link
      </button>
      <button type="button" onClick={onCancel} className={`mt-2 w-full ${LINK}`}>
        Back to recipes
      </button>
    </div>
  )
}

function NoRecipeResult({
  onPaste,
  onTryAnother,
  onCancel,
}: {
  onPaste: () => void
  onTryAnother: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex h-full flex-col bg-home-ground px-5 pt-16 text-home-ink">
      <h1 className={TITLE}>No recipe found</h1>
      <p className="mt-1 text-[15px] text-home-ink-2">{NO_RECIPE_COPY}</p>
      <button type="button" onClick={onPaste} className={`mt-8 ${PRIMARY}`}>
        Paste the recipe text
      </button>
      <button type="button" onClick={onTryAnother} className={`mt-2 w-full ${LINK}`}>
        Try another link
      </button>
      <button type="button" onClick={onCancel} className={`w-full ${LINK}`}>
        Back to recipes
      </button>
    </div>
  )
}

function PasteScreen({
  text,
  onChange,
  error,
  onSubmit,
  onBack,
}: {
  text: string
  onChange: (value: string) => void
  error: string | null
  onSubmit: () => void
  onBack: () => void
}) {
  return (
    <div className="flex h-full flex-col bg-home-ground px-5 pt-16 text-home-ink">
      <h1 className={TITLE}>Paste the recipe text</h1>
      <p className="mt-1 text-[15px] text-home-ink-2">Include the ingredients and the steps.</p>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Recipe text"
        className="mt-6 min-h-0 flex-1 resize-none rounded-[14px] border border-home-rule bg-home-surface px-4 py-3 text-[16px] leading-[1.5] text-home-ink outline-none focus:border-home-ink-2"
      />
      {error && <p className="mt-3 text-[13px] text-home-nonveg">{error}</p>}
      <button type="button" onClick={onSubmit} disabled={!text.trim()} className={`mt-4 ${PRIMARY}`}>
        Get the plan
      </button>
      <button type="button" onClick={onBack} className={`mb-4 mt-1 w-full ${LINK}`}>
        Back
      </button>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-home-ground px-8 text-center text-[15px] text-home-ink-2">
      <span
        aria-hidden="true"
        className="mb-3 h-2 w-2 rounded-full bg-home-terracotta motion-safe:animate-pulse"
      />
      <div role="status" aria-live="polite">
        {children}
      </div>
    </div>
  )
}
