import { useEffect, useRef, useState } from 'react'

import type {
  ImportJobResponse,
  ImportMeta,
  ImportResult,
  RecipePlanResponse,
  SourcePreview,
} from '@abc-cook/schema'

import { ApiError, pollImport, startImport, startImportText } from '../api/client'
import { derivePlan, type RenderPlan } from '../plan/derive'

/** No standalone `ImportStatus` export exists in the generated package (it's inlined
 * as a literal union on `ImportJobResponse.status`) — derive it rather than duplicate
 * the status union by hand, which CLAUDE.md's schema rule forbids. */
export type ImportStatus = ImportJobResponse['status']

const POLL_INTERVAL_MS = 1200
const MAX_POLLS = 250
/** ~5 min before asking the user. Measured 2026-09-24: a clean GPT-5-mini import took
 * 124s (112s in the one extraction call), and a repair pass adds a Sonnet call on top.
 * Hitting the ceiling never abandons the job — the `slow` phase keeps its id so
 * "Keep waiting" resumes polling; the server's own per-call timeouts are what end a
 * genuinely stuck job (as `failed`). */

export type Phase =
  | { kind: 'entry' }
  | { kind: 'polling'; status: ImportStatus; preview: SourcePreview | null }
  | { kind: 'not_grounded'; job: ImportJobResponse }
  | { kind: 'no_recipe' }
  | { kind: 'paste'; error: string | null }
  | { kind: 'error'; message: string; preview: SourcePreview | null }
  | { kind: 'slow'; jobId: string; token: number; status: ImportStatus; preview: SourcePreview | null }

export type OnImported = (
  plan: RenderPlan,
  payload: RecipePlanResponse,
  importMeta: ImportMeta,
) => void

/**
 * The import state machine, shared by `ImportScreen` and the Home Copy sheet: submit a
 * URL or pasted text, poll the job, and hand a finished plan to `onImported`. The token
 * and timer refs make a stale poll chain (previous submit, or one outliving the
 * component) unable to overwrite newer state.
 */
export function useImportJob(onImported: OnImported) {
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

  /** `override` lets a caller submit a value that isn't in the hook's own `url` state
   * (the Copy sheet owns its field). Call from a click handler, never a mount effect. */
  const submit = (override?: string) => {
    const trimmed = (override ?? url).trim()
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

  return { phase, setPhase, url, setUrl, text, setText, submit, submitText, keepWaiting, reset }
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
