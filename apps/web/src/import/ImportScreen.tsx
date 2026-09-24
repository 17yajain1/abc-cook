import { useEffect, useRef, useState } from 'react'

import type {
  ImportJobResponse,
  ImportMeta,
  ImportResult,
  NormalizedIngredient,
  RecipePlanResponse,
} from '@abc-cook/schema'

import { ApiError, pollImport, startImport } from '../api/client'
import { layoutMap, type MapLayout } from '../map/layout'
import { derivePlan, type RenderPlan } from '../plan/derive'
import { notGroundedCopy } from './notGroundedCopy'

/** No standalone `ImportStatus` export exists in the generated package (it's inlined
 * as a literal union on `ImportJobResponse.status`) — derive it rather than duplicate
 * the six-value union by hand, which CLAUDE.md's schema rule forbids. */
type ImportStatus = ImportJobResponse['status']

const POLL_INTERVAL_MS = 1200
const MAX_POLLS = 150
/** ~180s ceiling. Typical imports finish in 5-15s (design doc §4.5), but a job that
 * needs the one-repair-pass fallback (`CLAUDE.md`'s repair loop, a second LLM call)
 * reliably takes 90-100s+ end to end — observed directly, repeatedly, against the real
 * API: every repair-pass import finished successfully server-side, but the previous
 * 72s ceiling (`MAX_POLLS=60`) abandoned the poll before the result ever arrived, so
 * the screen reported failure on a request that was actually still going to succeed.
 * This only guards against a genuinely stuck job, not a slow-but-working one. */

/** design doc §4.5: the three-stage status maps directly onto this copy. */
const STATUS_COPY: Partial<Record<ImportStatus, string>> = {
  acquiring: 'Getting recipe…',
  extracting: 'Extracting…',
  validating: 'Building plan…',
}

type Phase =
  | { kind: 'entry' }
  | { kind: 'polling'; status: ImportStatus }
  | { kind: 'not_grounded'; job: ImportJobResponse }
  | { kind: 'error'; message: string }

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
        if (job.status === 'failed') {
          setPhase({ kind: 'error', message: job.error ?? 'The import failed.' })
          return
        }
        if (attempt >= MAX_POLLS) {
          setPhase({ kind: 'error', message: 'This is taking longer than expected.' })
          return
        }
        setPhase({ kind: 'polling', status: job.status })
        timerRef.current = window.setTimeout(
          () => poll(jobId, token, attempt + 1),
          POLL_INTERVAL_MS,
        )
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        setPhase({ kind: 'error', message: messageFor(err) })
      })
  }

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const token = ++tokenRef.current
    setPhase({ kind: 'polling', status: 'acquiring' })
    startImport(trimmed)
      .then(({ job_id }) => {
        if (tokenRef.current !== token) return
        poll(job_id, token, 0)
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        setPhase({ kind: 'error', message: messageFor(err) })
      })
  }

  const reset = () => {
    tokenRef.current += 1
    window.clearTimeout(timerRef.current)
    setUrl('')
    setPhase({ kind: 'entry' })
  }

  if (phase.kind === 'polling') {
    return <Centered>{STATUS_COPY[phase.status] ?? 'Working…'}</Centered>
  }

  if (phase.kind === 'not_grounded') {
    return <NotGroundedResult job={phase.job} onTryAnother={reset} onCancel={onCancel} />
  }

  return (
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">Add a recipe</h1>
      <p className="mt-1 text-[15px] text-ink-2">Paste a link to a recipe video.</p>

      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="https://youtube.com/watch?v=…"
        className="mt-8 rounded-control border border-rule bg-paper px-3.5 py-3 text-[15px] text-ink outline-none focus:border-ink-3"
      />

      {phase.kind === 'error' && (
        <p className="mt-3 text-[13px] text-signal">{phase.message}</p>
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
        onClick={onCancel}
        className="mt-6 self-center text-[13px] text-ink-3 underline underline-offset-4"
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
    if (err.status === 0) return err.message
    return `The server had a problem (${err.status}).`
  }
  return 'Something went wrong starting the import.'
}
