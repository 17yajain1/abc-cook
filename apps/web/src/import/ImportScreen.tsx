import { useEffect, useRef, useState } from 'react'

import type {
  ImportJobResponse,
  ImportMeta,
  ImportResult,
  NormalizedIngredient,
  RecipePlanResponse,
  SourcePreview,
} from '@abc-cook/schema'

import { ApiError, pollImport, startImport, startImportText } from '../api/client'
import { layoutMap, type MapLayout } from '../map/layout'
import { derivePlan, type RenderPlan } from '../plan/derive'
import { notGroundedCopy } from './notGroundedCopy'
import { RecipePreview } from './RecipePreview'

/** No standalone `ImportStatus` export exists in the generated package (it's inlined
 * as a literal union on `ImportJobResponse.status`) — derive it rather than duplicate
 * the status union by hand, which CLAUDE.md's schema rule forbids. */
type ImportStatus = ImportJobResponse['status']

const POLL_INTERVAL_MS = 1200
const MAX_POLLS = 250
/** ~5 min before asking the user. Measured 2026-09-24: a clean GPT-5-mini import took
 * 124s (112s in the one extraction call), and a repair pass adds a Sonnet call on top.
 * Hitting the ceiling never abandons the job — the `slow` phase keeps its id so
 * "Keep waiting" resumes polling; the server's own per-call timeouts are what end a
 * genuinely stuck job (as `failed`). */

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

type Phase =
  | { kind: 'entry' }
  | { kind: 'polling'; status: ImportStatus; preview: SourcePreview | null }
  | { kind: 'not_grounded'; job: ImportJobResponse }
  | { kind: 'no_recipe' }
  | { kind: 'paste'; error: string | null }
  | { kind: 'error'; message: string; preview: SourcePreview | null }
  | { kind: 'slow'; jobId: string; token: number; status: ImportStatus; preview: SourcePreview | null }

/**
 * Paste-a-link import flow (design doc §4.5/§12 step 12): submit a URL, poll the job,
 * and hand a finished plan back to `App` — the same `RenderPlan`/`MapLayout` shape
 * `fetchPlan` produces, so it reaches the existing `PlanScreen` unchanged. A Tier 0
 * (`method_not_grounded`) result renders inline here instead, since there is no plan
 * to hand off.
 */
export function ImportScreen({
  onImported,
  onCancel,
}: {
  onImported: (
    plan: RenderPlan,
    map: MapLayout,
    payload: RecipePlanResponse,
    importMeta: ImportMeta,
  ) => void
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'entry' })
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')

  // Bumped on every new submit and on unmount, so a stale poll chain (from a previous
  // submit, or one that outlives the component) can never overwrite newer state.
  const tokenRef = useRef(0)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      tokenRef.current += 1
      window.clearTimeout(timerRef.current)
    },
    [],
  )

  const poll = (jobId: string, token: number, attempt: number) => {
    pollImport(jobId)
      .then((job) => {
        if (tokenRef.current !== token) return

        if (job.status === 'done' && job.result?.graph && job.result.plan && job.result.stages) {
          const payload = {
            graph: job.result.graph,
            plan: job.result.plan,
            stages: job.result.stages,
            summary: job.result.summary ?? null,
          }
          onImported(
            derivePlan(payload, job.result.provenance ?? null),
            layoutMap(payload),
            payload,
            importMetaFrom(job.result),
          )
          return
        }
        if (job.status === 'method_not_grounded') {
          setPhase({ kind: 'not_grounded', job })
          return
        }
        if (job.status === 'no_recipe_found') {
          setPhase({ kind: 'no_recipe' })
          return
        }
        if (job.status === 'failed') {
          setPhase({
            kind: 'error',
            message: job.error ?? 'The import failed.',
            preview: job.preview ?? null,
          })
          return
        }
        const preview = job.preview ?? null
        if (attempt >= MAX_POLLS) {
          setPhase({ kind: 'slow', jobId, token, status: job.status, preview })
          return
        }
        setPhase({ kind: 'polling', status: job.status, preview })
        timerRef.current = window.setTimeout(
          () => poll(jobId, token, attempt + 1),
          POLL_INTERVAL_MS,
        )
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        setPhase({ kind: 'error', message: messageFor(err), preview: null })
      })
  }

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const token = ++tokenRef.current
    setPhase({ kind: 'polling', status: 'acquiring', preview: null })
    startImport(trimmed)
      .then(({ job_id }) => {
        if (tokenRef.current !== token) return
        poll(job_id, token, 0)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        setPhase({ kind: 'error', message: messageFor(err), preview: null })
      })
  }

  const submitText = () => {
    if (!text.trim()) return
    const token = ++tokenRef.current
    setPhase({ kind: 'polling', status: 'acquiring', preview: null })
    startImportText(text)
      .then(({ job_id }) => {
        if (tokenRef.current !== token) return
        poll(job_id, token, 0)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        // A too-short / too-long paste is the API's own 422 sentence: show it where the
        // text still is, so the user can fix it rather than start over.
        setPhase({ kind: 'paste', error: messageFor(err) })
      })
  }

  const keepWaiting = () => {
    if (phase.kind !== 'slow' || tokenRef.current !== phase.token) return
    setPhase({ kind: 'polling', status: phase.status, preview: phase.preview })
    poll(phase.jobId, phase.token, 0)
  }

  const reset = () => {
    tokenRef.current += 1
    window.clearTimeout(timerRef.current)
    setUrl('')
    setText('')
    setPhase({ kind: 'entry' })
  }

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
        className="mt-8 rounded-control border border-rule bg-paper px-3.5 py-3 text-[15px] text-ink outline-none focus:border-ink-3"
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
        onClick={submit}
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
        className="mt-6 min-h-0 flex-1 resize-none rounded-control border border-rule bg-paper px-3.5 py-3 text-[15px] leading-[1.5] text-ink outline-none focus:border-ink-3"
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

/** A6: import-status fields the frozen `RecipePlanResponse` doesn't carry, computed
 * once here so App/PlanScreen/the saved-library entry all thread the same value
 * rather than re-deriving `degraded` at each hop. */
function importMetaFrom(result: ImportResult): ImportMeta {
  const warnings = result.warnings ?? []
  return {
    warnings,
    review_recommended: result.review_recommended ?? false,
    sources: result.sources ?? [],
    provenance: result.provenance ?? null,
    degraded: warnings.includes('degraded'),
  }
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.status === 422) return err.message
    return `The server had a problem (${err.status}).`
  }
  return 'Something went wrong starting the import.'
}
