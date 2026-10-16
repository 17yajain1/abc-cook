import type { ImportJobResponse, NormalizedIngredient } from '@abc-cook/schema'

import { notGroundedCopy } from './notGroundedCopy'
import { RecipePreview } from './RecipePreview'
import { useImportJob, type ImportStatus, type OnImported, type Phase } from './useImportJob'

/** A7: one line per real pipeline stage (design doc §4.5), in the words the cook would use.
 * No percentages or invented progress — a line changes only when the server's status does.
 * `plan_building` has no entry: with a preview on screen it gets `PreviewFooter`. */
const WORKING_OUT = 'Working out what can happen at the same time…'
const STATUS_COPY: Partial<Record<ImportStatus, string>> = {
  acquiring: 'Getting the recipe…',
  extracting: WORKING_OUT,
  validating: 'Building your cooking plan…',
}

/** Under the preview: what has happened (the page gave us its recipe) and what is happening. */
function PreviewFooter() {
  return (
    <>
      <p className="text-ink">Found the recipe on the page.</p>
      <p>{WORKING_OUT}</p>
    </>
  )
}

const NO_RECIPE_COPY = 'That page doesn’t have a recipe we can read.'

/** Phases `ImportProgress` takes over the whole screen for. `entry`, `slow` and `error`
 * without a preview stay inline wherever the entry form lives (here, or the Home Copy sheet). */
export function isProgressPhase(phase: Phase): boolean {
  return (
    phase.kind === 'polling' ||
    phase.kind === 'no_recipe' ||
    phase.kind === 'paste' ||
    phase.kind === 'not_grounded' ||
    (phase.kind === 'error' && phase.preview != null)
  )
}

/** The non-entry branches of the import flow: polling, no recipe, paste, error with a
 * preview, no method found. Render only when `isProgressPhase(job.phase)`. */
export function ImportProgress({
  job,
  onCancel,
}: {
  job: ReturnType<typeof useImportJob>
  onCancel: () => void
}) {
  const { phase, setPhase, text, setText, submitText, reset } = job

  if (phase.kind === 'polling') {
    // Once the source's own recipe is readable, show it and keep the plan-building line
    // quiet underneath (A2); until then, the plain status word.
    if (phase.preview) {
      return (
        <RecipePreview
          preview={phase.preview}
          footer={<PreviewFooter />}
          onCancel={reset}
        />
      )
    }
    return <Centered>{STATUS_COPY[phase.status] ?? 'Working…'}</Centered>
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

  if (phase.kind === 'error' && phase.preview) {
    // The plan failed but the source's own recipe is still worth reading (A2 fallback).
    return (
      <RecipePreview
        preview={phase.preview}
        footer={
          <>
            <span className="text-signal">{phase.message}</span>{' '}
            <button type="button" onClick={reset} className="underline underline-offset-4">
              Try again
            </button>
          </>
        }
        onCancel={onCancel}
      />
    )
  }

  if (phase.kind === 'not_grounded') {
    return <NotGroundedResult job={phase.job} onTryAnother={reset} onCancel={onCancel} />
  }

  return null
}

/**
 * Paste-a-link import flow (design doc §4.5/§12 step 12): submit a URL, poll the job,
 * and hand a finished plan back to `App` — the same `RenderPlan` shape
 * `fetchPlan` produces, so it reaches the existing `PlanScreen` unchanged. A Tier 0
 * (`method_not_grounded`) result renders inline here instead, since there is no plan
 * to hand off.
 */
export function ImportScreen({
  onImported,
  onCancel,
  initialUrl,
}: {
  onImported: OnImported
  onCancel: () => void
  /** Prefills the field (Re-import). The user still taps "Get the plan": an LLM spend is
   * never started by a mount. */
  initialUrl?: string
}) {
  const job = useImportJob(onImported, initialUrl)
  const { phase, url, setUrl, setPhase, submit, keepWaiting } = job

  if (isProgressPhase(phase)) return <ImportProgress job={job} onCancel={onCancel} />

  return (
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">Add a recipe</h1>
      <p className="mt-1 text-[15px] text-ink-2">Paste a link to a recipe video or a recipe page.</p>

      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="YouTube, Instagram or recipe page link…"
        className="mt-8 rounded-control border border-rule bg-paper px-3.5 py-3 text-[16px] text-ink outline-none focus:border-ink-3"
      />

      {phase.kind === 'error' && (
        <p className="mt-3 text-[13px] text-signal">{phase.message}</p>
      )}
      {phase.kind === 'slow' && (
        <p className="mt-3 text-[13px] text-signal">
          This is taking longer than expected.{' '}
          <button
            type="button"
            onClick={keepWaiting}
            className="font-semibold underline underline-offset-4"
          >
            Keep waiting
          </button>
        </p>
      )}

      <button
        type="button"
        onClick={() => submit()}
        disabled={!url.trim()}
        className="mt-4 rounded-control bg-signal py-3 text-[15px] font-semibold text-paper disabled:opacity-40"
      >
        Get the plan
      </button>

      <button
        type="button"
        onClick={() => setPhase({ kind: 'paste', error: null })}
        className="mt-6 self-center text-[15px] text-ink-2 underline underline-offset-4"
      >
        Paste the recipe text instead
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 self-center text-[13px] text-ink-3 underline underline-offset-4"
      >
        back to recipes
      </button>
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
  const groups = groupIngredients(result?.ingredients ?? [])
  const truncationWarning = result?.warnings?.find((w) => w.startsWith('Transcript truncated'))

  return (
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">No method found</h1>
      <p className="mt-1 text-[15px] text-ink-2">
        {notGroundedCopy(result?.sources ?? [], groups.length > 0)}
        {groups.length > 0 ? ' — but here’s the shopping list.' : ''}
      </p>
      {truncationWarning && (
        <p className="mt-1 text-[13px] text-ink-3">{truncationWarning}</p>
      )}

      {groups.length > 0 && (
        <div className="mt-6 border-t border-rule">
          {groups.map((group, i) => (
            <div key={group.group ?? `ungrouped-${i}`} className="py-3">
              {group.group && (
                <h3 className="mb-1 text-[13px] font-semibold text-ink">{group.group}</h3>
              )}
              <ul>
                {group.items.map((item, j) => (
                  <li
                    key={`${item.name}-${j}`}
                    className="flex items-baseline justify-between gap-3 border-b border-rule py-2 text-[15px] last:border-b-0"
                  >
                    <span className="text-ink">{item.name}</span>
                    {(item.qty != null || item.unit) && (
                      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
                        {[item.qty ?? '', item.unit ?? ''].join(' ').trim()}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onTryAnother}
        className="mt-8 rounded-control bg-signal py-3 text-[15px] font-semibold text-paper"
      >
        Try another link
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 self-center text-[13px] text-ink-3 underline underline-offset-4"
      >
        back to recipes
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
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">No recipe found</h1>
      <p className="mt-1 text-[15px] text-ink-2">{NO_RECIPE_COPY}</p>
      <button
        type="button"
        onClick={onPaste}
        className="mt-8 rounded-control bg-signal py-3 text-[15px] font-semibold text-paper"
      >
        Paste the recipe text
      </button>
      <button
        type="button"
        onClick={onTryAnother}
        className="mt-5 self-center text-[15px] text-ink-2 underline underline-offset-4"
      >
        Try another link
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 self-center text-[13px] text-ink-3 underline underline-offset-4"
      >
        back to recipes
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
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">Paste the recipe text</h1>
      <p className="mt-1 text-[15px] text-ink-2">Include the ingredients and the steps.</p>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Recipe text"
        className="mt-6 min-h-0 flex-1 resize-none rounded-control border border-rule bg-paper px-3.5 py-3 text-[16px] leading-[1.5] text-ink outline-none focus:border-ink-3"
      />
      {error && <p className="mt-3 text-[13px] text-signal">{error}</p>}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!text.trim()}
        className="mt-4 rounded-control bg-signal py-3 text-[15px] font-semibold text-paper disabled:opacity-40"
      >
        Get the plan
      </button>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 mt-4 self-center text-[13px] text-ink-3 underline underline-offset-4"
      >
        back
      </button>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-paper px-8 text-center text-[15px] text-ink-2">
      {children}
    </div>
  )
}

function groupIngredients(
  ingredients: readonly NormalizedIngredient[],
): { group: string | null; items: NormalizedIngredient[] }[] {
  const groups: { group: string | null; items: NormalizedIngredient[] }[] = []
  const seen = new Map<string | null, { group: string | null; items: NormalizedIngredient[] }>()
  for (const item of ingredients) {
    const key = item.group ?? null
    let bucket = seen.get(key)
    if (!bucket) {
      bucket = { group: key, items: [] }
      seen.set(key, bucket)
      groups.push(bucket)
    }
    bucket.items.push(item)
  }
  return groups
}

