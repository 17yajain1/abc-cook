import type { ImportJobResponse } from '@abc-cook/schema'

import { IngredientList } from '../plan/IngredientList'
import { useHomeSurface } from '@/shell/useHomeSurface'

import { draftIngredientGroups } from './draftView'
import { ImportDraft } from './ImportDraft'
import { footerFor, importViewFor } from './importView'
import { notGroundedCopy } from './notGroundedCopy'
import { FAILURE_COPY } from './phase'
import { useImportJob, type Phase } from './useImportJob'

/** Home's primary button: a terracotta pill, sentence case (DESIGN_SYSTEM.md, Register: Home). */
const PRIMARY =
  'h-14 w-full rounded-full bg-home-terracotta text-[15px] font-semibold text-home-ground disabled:bg-[#f1e7de] disabled:text-[#8c7a6f]'
const LINK =
  'flex min-h-[44px] items-center justify-center text-[15px] text-home-ink-2 underline underline-offset-4'
/** Home's screen title: 22 / 700 / 26. */
const TITLE = 'text-[22px] font-bold leading-[26px] tracking-[-0.3px] text-home-ink'

const WORKING_OUT = 'Working out what can happen at the same time…'

/** Under a blog page's recipe: what has happened (the page gave us its recipe) and what is happening. */
function PreviewFooter() {
  return (
    <>
      <p className="text-home-ink">Found the recipe on the page.</p>
      <p>{WORKING_OUT}</p>
    </>
  )
}

const NO_RECIPE_COPY = 'That page doesn’t have a recipe we can read.'

/** Phases `ImportProgress` takes over the whole screen for. `entry`, `slow` and `error`
 * with nothing read stay inline wherever the entry form lives (the Cookbook's form, or the
 * Home Copy sheet). */
export function isProgressPhase(phase: Phase): boolean {
  return (
    phase.kind === 'polling' ||
    phase.kind === 'ready' ||
    phase.kind === 'no_recipe' ||
    phase.kind === 'paste' ||
    phase.kind === 'failed' ||
    phase.kind === 'not_grounded' ||
    (phase.kind === 'error' &&
      (phase.preview != null || phase.acquired != null || phase.draft != null))
  )
}

/**
 * The non-entry branches of the import flow: reading (polling), ready, no recipe, paste,
 * failed, error with something read, no method found. Render only when
 * `isProgressPhase(job.phase)`. Every branch is the Home register, the same ground as the
 * Copy sheet and the recipe page, so nothing flips at the hand-off.
 */
export function ImportProgress({
  job,
  onCancel,
}: {
  job: ReturnType<typeof useImportJob>
  onCancel: () => void
}) {
  const { phase, setPhase, text, setText, submitText, reset, retry, instant, isText, markThumbnail, openReady } =
    job
  // The page behind the app is the Home ground too (safe-area strip, over-scroll).
  useHomeSurface(true)

  if (phase.kind === 'polling') {
    // Whatever the source has said so far (thumbnail and title at once for a YouTube link,
    // then its description, a blog page's own recipe, and the extraction's draft as it
    // streams) is shown, with one quiet line underneath naming what is being read. A pasted
    // text has no header, but the sections are there from the start; for a link with nothing
    // known yet, the plain status word.
    const view = importViewFor({
      instant,
      acquired: phase.acquired,
      preview: phase.preview,
      draft: phase.draft,
      status: phase.status,
    })
    const footer = footerFor(view, phase.status)
    if (view.header || phase.preview || phase.draft || isText) {
      return (
        <ImportDraft
          view={view}
          footer={phase.preview ? <PreviewFooter /> : <p>{footer}</p>}
          working
          onCancel={reset}
          onThumbnailLoaded={markThumbnail}
        />
      )
    }
    return <Centered>{footer}</Centered>
  }

  if (phase.kind === 'ready') {
    // The plan is built and already saved. The reading screen stays exactly as it was (the
    // draft stays readable) and a button, not a page change, says so: the cook may be mid-line.
    return (
      <ImportDraft
        view={importViewFor({
          instant,
          acquired: phase.acquired,
          preview: phase.preview,
          draft: phase.draft,
          status: 'done',
        })}
        footer={
          <button type="button" onClick={openReady} className={PRIMARY}>
            Your plan is ready
          </button>
        }
        cancelLabel="Close"
        onCancel={reset}
        onThumbnailLoaded={markThumbnail}
      />
    )
  }

  if (phase.kind === 'failed') {
    // The header stays (thumbnail, channel, title, description) and so does whatever was
    // read: the message and what to do about it sit above it, the draft below under its label.
    // With nothing read, the sections that were never going to fill are dropped. No footer,
    // so the message appears once.
    return (
      <ImportDraft
        view={importViewFor({
          instant,
          acquired: phase.acquired,
          preview: phase.preview,
          draft: phase.draft,
          status: 'failed',
        })}
        failure={
          <FailureBody
            failure={phase.failure}
            onTryAgain={retry}
            onPaste={() => setPhase({ kind: 'paste', error: null })}
            onTryAnother={reset}
          />
        }
        onCancel={onCancel}
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

  if (phase.kind === 'error' && (phase.preview || phase.acquired || phase.draft)) {
    // The import broke, but what was read is still worth reading. With a draft, the message
    // sits above it (like a failed job); without one, today's layout: the message in the footer.
    const view = importViewFor({
      instant,
      acquired: phase.acquired,
      preview: phase.preview,
      draft: phase.draft,
      status: 'failed',
    })
    if (phase.draft) {
      return (
        <ImportDraft
          view={view}
          failure={
            <div role="alert">
              <p className="text-[15px] leading-[1.45] text-home-ink">{phase.message}</p>
              <button type="button" onClick={reset} className={`mt-5 ${PRIMARY}`}>
                Try again
              </button>
            </div>
          }
          onCancel={onCancel}
          onThumbnailLoaded={markThumbnail}
        />
      )
    }
    return (
      <ImportDraft
        view={view}
        footer={
          <>
            <span className="text-home-nonveg">{phase.message}</span>{' '}
            <button type="button" onClick={reset} className="-my-3 py-3 underline underline-offset-4">
              Try again
            </button>
          </>
        }
        onCancel={onCancel}
        onThumbnailLoaded={markThumbnail}
      />
    )
  }

  if (phase.kind === 'not_grounded') {
    return <NotGroundedResult job={phase.job} onTryAnother={reset} onCancel={onCancel} />
  }

  return null
}

/** What a failed import says and offers. `unavailable` is the provider's fault, so trying
 * again is reasonable; `incomplete` would most likely fail the same way, so it offers the
 * other two routes in. */
function FailureBody({
  failure,
  onTryAgain,
  onPaste,
  onTryAnother,
}: {
  failure: 'unavailable' | 'incomplete'
  onTryAgain: () => void
  onPaste: () => void
  onTryAnother: () => void
}) {
  return (
    <div role="alert">
      <p className="text-[15px] leading-[1.45] text-home-ink">{FAILURE_COPY[failure]}</p>
      {failure === 'unavailable' ? (
        <button type="button" onClick={onTryAgain} className={`mt-5 ${PRIMARY}`}>
          Try again
        </button>
      ) : (
        <>
          <button type="button" onClick={onPaste} className={`mt-5 ${PRIMARY}`}>
            Paste the recipe text
          </button>
          <button type="button" onClick={onTryAnother} className={`mt-2 w-full ${LINK}`}>
            Try another link
          </button>
        </>
      )}
    </div>
  )
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
        {notGroundedCopy(result?.sources ?? [], groups.length > 0)}
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
