import { useEffect, useRef, useState } from 'react'

import type { SavedRecipe } from '@abc-cook/schema'

import { ApiError, pollImport, startImport, startImportText } from '../api/client'
import { fetchOEmbed } from '../api/oembed'
import { derivePlan } from '../plan/derive'
import type { FindSaved } from './duplicate'
import { completeImport, type ImportHandlers } from './handOff'
import { importExtrasFrom } from './importExtras'
import { importMetaFrom } from './importMeta'
import { createImportTimer } from './importTiming'
import type { InstantHeader } from './instantPreview'
import { phaseFor, type Phase } from './phase'
import type { ScrollAnchor } from './scrollAnchor'
import { runSubmit } from './submitFlow'

export type { ImportStatus, Phase } from './phase'

const POLL_INTERVAL_MS = 1200
const MAX_POLLS = 250
/** ~5 min before asking the user. Measured 2026-09-24: a clean GPT-5-mini import took
 * 124s (112s in the one extraction call), and a repair pass adds a Sonnet call on top.
 * Hitting the ceiling never abandons the job — the `slow` phase keeps its id so
 * "Keep waiting" resumes polling; the server's own per-call timeouts are what end a
 * genuinely stuck job (as `failed`). */

/**
 * The import state machine, shared by `ImportScreen` and the Home Copy sheet: submit a
 * URL or pasted text, poll the job, and hand a finished plan to `handlers` (saved, then opened
 * at once: the importing page is the recipe page, so nothing waits for a tap). The token
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

export function useImportJob(handlers: ImportHandlers, options: ImportJobOptions = {}) {
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

  // What Try again resubmits: the URL of the last URL submit, or null for a pasted text.
  const lastUrlRef = useRef<string | null>(null)
  // Where the cook is reading on the importing page; the plan page opens at the same place. Written by
  // the page on scroll, read once when the job is done.
  const anchorRef = useRef<ScrollAnchor | null>(null)
  // The last poll's source text and draft, so a network error mid-poll keeps what was read.
  const lastRef = useRef<Pick<Extract<Phase, { kind: 'polling' }>, 'preview' | 'acquired' | 'draft'>>({
    preview: null,
    acquired: null,
    draft: null,
  })
  const [isText, setIsText] = useState(false)

  const resetRead = (text: boolean) => {
    anchorRef.current = null
    lastRef.current = { preview: null, acquired: null, draft: null }
    setIsText(text)
  }

  const poll = (jobId: string, token: number, attempt: number) => {
    pollImport(jobId)
      .then((job) => {
        if (tokenRef.current !== token) return
        if (job.acquired) timerObj.current.mark('acquired')
        if (job.draft?.ingredients?.length) timerObj.current.mark('ingredients')
        if (job.draft?.steps?.length) timerObj.current.mark('firstStep')
        lastRef.current = {
          preview: job.preview ?? null,
          acquired: job.acquired ?? null,
          draft: job.draft ?? null,
        }

        const decision = phaseFor(job, {
          jobId,
          token,
          attempt,
          maxPolls: MAX_POLLS,
          url: lastUrlRef.current,
        })
        if (decision.kind === 'done') {
          // `phaseFor` only says `done` when graph, plan and stages are all present.
          const result = job.result!
          const payload = {
            graph: result.graph!,
            plan: result.plan!,
            stages: result.stages!,
            summary: result.summary ?? null,
          }
          timerObj.current.mark('plan')
          completeImport(
            {
              plan: derivePlan(payload, result.provenance ?? null),
              payload,
              importMeta: importMetaFrom(result),
              extras: importExtrasFrom(result),
              scrollAnchor: anchorRef.current,
            },
            handlers,
          )
          timerObj.current.mark('open')
          console.info('[import-timing]', timerObj.current.report())
          return
        }
        setPhase(decision.phase)
        if (decision.keepPolling) {
          timerRef.current = window.setTimeout(
            () => poll(jobId, token, attempt + 1),
            POLL_INTERVAL_MS,
          )
        }
      })
      .catch((err: unknown) => {
        if (tokenRef.current !== token) return
        // A lost connection keeps what had been read: the error shows above it.
        setPhase({ kind: 'error', message: messageFor(err), ...lastRef.current })
      })
  }

  const start = (trimmed: string, skipDuplicateCheck: boolean | undefined) => {
    const token = ++tokenRef.current
    lastUrlRef.current = trimmed
    resetRead(false)
    runSubmit(
      trimmed,
      { findSaved: options.findSaved, skipDuplicateCheck },
      {
        begin: (quick) => {
          timerObj.current = createImportTimer()
          timerObj.current.mark('submit')
          // Set before the network call, so the thumbnail is on screen while POST /import
          // is still in flight.
          setInstant(quick ? { thumbnailUrl: quick.thumbnailUrl, title: null, channel: null } : null)
          setPhase({ kind: 'polling', status: 'acquiring', preview: null, acquired: null, draft: null })
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
          setPhase({ kind: 'error', message: messageFor(err), preview: null, acquired: null, draft: null })
        },
        onDuplicate: (saved) => options.onDuplicate?.(saved),
      },
    )
  }

  /** `override` lets a caller submit a value that isn't in the hook's own `url` state
   * (the Copy sheet owns its field). Call from a click handler, never a mount effect.
   * The order is fixed in `runSubmit`: duplicate check, then the instant header, then
   * the network call. */
  const submit = (override?: string) => {
    const trimmed = (override ?? url).trim()
    if (!trimmed) return
    start(trimmed, options.skipDuplicateCheck)
  }

  /** Try again after a failure: the same input, resubmitted as a new import. Nothing was saved, so it
   * skips the duplicate check. A pasted text resubmits the text. An `error` (a lost connection, a server
   * fault) retries the last link or text; with neither known there is nothing to resubmit, so it starts over. */
  const retry = () => {
    if (phase.kind === 'failed') {
      if (phase.url) start(phase.url, true)
      else submitText()
      return
    }
    if (phase.kind !== 'error') return
    if (lastUrlRef.current) start(lastUrlRef.current, true)
    else if (text.trim()) submitText()
    else reset()
  }

  const submitText = () => {
    if (!text.trim()) return
    const token = ++tokenRef.current
    lastUrlRef.current = null
    resetRead(true)
    timerObj.current = createImportTimer()
    timerObj.current.mark('submit')
    setInstant(null)
    setPhase({ kind: 'polling', status: 'acquiring', preview: null, acquired: null, draft: null })
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
      draft: phase.draft,
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
    isText,
    markThumbnail,
    anchorRef,
    url,
    setUrl,
    text,
    setText,
    submit,
    retry,
    submitText,
    keepWaiting,
    reset,
  }
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.status === 422) return err.message
    return `The server had a problem (${err.status}).`
  }
  return 'Something went wrong starting the import.'
}
