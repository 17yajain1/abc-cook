import { useEffect, useRef, useState } from 'react'

import type {
  AcquiredSource,
  SavedRecipe,
  ImportJobResponse,
  ImportMeta,
  ImportResult,
  RecipePlanResponse,
  SourcePreview,
} from '@abc-cook/schema'

import { ApiError, pollImport, startImport, startImportText } from '../api/client'
import { fetchOEmbed } from '../api/oembed'
import { derivePlan, type RenderPlan } from '../plan/derive'
import { importExtrasFrom, type ImportExtras } from './importExtras'
import { createImportTimer } from './importTiming'
import type { FindSaved } from './duplicate'
import type { InstantHeader } from './instantPreview'
import { runSubmit } from './submitFlow'

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
  | {
      kind: 'polling'
      status: ImportStatus
      preview: SourcePreview | null
      acquired: AcquiredSource | null
    }
  | { kind: 'not_grounded'; job: ImportJobResponse }
  | { kind: 'no_recipe' }
  | { kind: 'paste'; error: string | null }
  | {
      kind: 'error'
      message: string
      preview: SourcePreview | null
      acquired: AcquiredSource | null
    }
  | {
      kind: 'slow'
      jobId: string
      token: number
      status: ImportStatus
      preview: SourcePreview | null
      acquired: AcquiredSource | null
    }

export type OnImported = (
  plan: RenderPlan,
  payload: RecipePlanResponse,
  importMeta: ImportMeta,
  extras: ImportExtras,
) => void

/**
 * The import state machine, shared by `ImportScreen` and the Home Copy sheet: submit a
 * URL or pasted text, poll the job, and hand a finished plan to `onImported`. The token
 * and timer refs make a stale poll chain (previous submit, or one outliving the
 * component) unable to overwrite newer state.
 */
export interface ImportJobOptions {
  /** Prefills the field (Re-import, Import again). */
  initialUrl?: string
  /** Looks a pasted URL up among the saved recipes. Absent: no duplicate check. */
  findSaved?: FindSaved
  /** A pasted URL is already saved: open that entry instead of importing it again. */
  onDuplicate?: (saved: SavedRecipe) => void
  /** Set by Re-import and Import again, which import a source that is already saved. */
  skipDuplicateCheck?: boolean
}

export function useImportJob(onImported: OnImported, options: ImportJobOptions = {}) {
  const { initialUrl = '' } = options
  const [phase, setPhase] = useState<Phase>({ kind: 'entry' })
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState('')
  // The header a YouTube link can show before the API has answered (thumbnail at once,
  // title and channel when oEmbed does). Held beside the phase, not in it, because oEmbed
  // lands while polling is already running and every poll replaces the phase.
  const [instant, setInstant] = useState<InstantHeader | null>(null)
  const timerObj = useRef(createImportTimer())

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
          timerObj.current.mark('plan')
          console.info('[import-timing]', timerObj.current.report())
          onImported(
            derivePlan(payload, job.result.provenance ?? null),
            payload,
            importMetaFrom(job.result),
            importExtrasFrom(job.result),
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
            acquired: job.acquired ?? null,
          })
          return
        }
        const preview = job.preview ?? null
        const acquired = job.acquired ?? null
        if (acquired) timerObj.current.mark('acquired')
        if (attempt >= MAX_POLLS) {
          setPhase({ kind: 'slow', jobId, token, status: job.status, preview, acquired })
          return
        }
        setPhase({ kind: 'polling', status: job.status, preview, acquired })
        timerRef.current = window.setTimeout(
          () => poll(jobId, token, attempt + 1),
          POLL_INTERVAL_MS,
        )
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        setPhase({ kind: 'error', message: messageFor(err), preview: null, acquired: null })
      })
  }

  /** `override` lets a caller submit a value that isn't in the hook's own `url` state
   * (the Copy sheet owns its field). Call from a click handler, never a mount effect.
   * The order is fixed in `runSubmit`: duplicate check, then the instant header, then
   * the network call. */
  const submit = (override?: string) => {
    const trimmed = (override ?? url).trim()
    if (!trimmed) return
    const token = ++tokenRef.current
    runSubmit(
      trimmed,
      { findSaved: options.findSaved, skipDuplicateCheck: options.skipDuplicateCheck },
      {
        begin: (quick) => {
          timerObj.current = createImportTimer()
          timerObj.current.mark('submit')
          // Set before the network call, so the thumbnail is on screen while POST /import
          // is still in flight.
          setInstant(quick ? { thumbnailUrl: quick.thumbnailUrl, title: null, channel: null } : null)
          setPhase({ kind: 'polling', status: 'acquiring', preview: null, acquired: null })
        },
        // oEmbed runs in parallel with the POST, under the same token: a stale answer from
        // a previous submit is dropped, and a title that is already set is never replaced.
        fetchOEmbed: (oembedUrl) => fetchOEmbed(oembedUrl),
        onTitle: (found) => {
          if (tokenRef.current !== token) return
          timerObj.current.mark('title')
          setInstant((prev) => (prev && prev.title == null ? { ...prev, ...found } : prev))
        },
        startImport,
        onStarted: (jobId) => {
          if (tokenRef.current !== token) return
          poll(jobId, token, 0)
        },
        onStartFailed: (err) => {
          if (tokenRef.current !== token) return
          setInstant(null)
          setPhase({ kind: 'error', message: messageFor(err), preview: null, acquired: null })
        },
        onDuplicate: (saved) => options.onDuplicate?.(saved),
      },
    )
  }

  const submitText = () => {
    if (!text.trim()) return
    const token = ++tokenRef.current
    setInstant(null)
    setPhase({ kind: 'polling', status: 'acquiring', preview: null, acquired: null })
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
    setPhase({
      kind: 'polling',
      status: phase.status,
      preview: phase.preview,
      acquired: phase.acquired,
    })
    poll(phase.jobId, phase.token, 0)
  }

  const reset = () => {
    tokenRef.current += 1
    window.clearTimeout(timerRef.current)
    setUrl('')
    setText('')
    setInstant(null)
    setPhase({ kind: 'entry' })
  }

  const markThumbnail = () => timerObj.current.mark('thumbnail')

  return {
    phase,
    setPhase,
    instant,
    markThumbnail,
    url,
    setUrl,
    text,
    setText,
    submit,
    submitText,
    keepWaiting,
    reset,
  }
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
