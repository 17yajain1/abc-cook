import type { FinishedImport } from './handOff'
import type {
  AcquiredSource,
  ImportJobResponse,
  ImportResult,
  SourcePreview,
  StreamedDraft,
} from '@abc-cook/schema'

/** No standalone `ImportStatus` export exists in the generated package (it's inlined
 * as a literal union on `ImportJobResponse.status`) — derive it rather than duplicate
 * the status union by hand, which CLAUDE.md's schema rule forbids. */
export type ImportStatus = ImportJobResponse['status']

/** Why a job failed when the server knows (`ImportResult.failure`). */
export type ImportFailure = NonNullable<ImportResult['failure']>

export type Phase =
  | { kind: 'entry' }
  | {
      kind: 'polling'
      status: ImportStatus
      preview: SourcePreview | null
      acquired: AcquiredSource | null
      /** What the extraction has streamed so far; kept on every later phase. */
      draft: StreamedDraft | null
    }
  /** The plan is built and already saved; the reading screen stays as it was and offers a tap
   * to open it. Carries what the screen last showed, so the draft stays readable. */
  | {
      kind: 'ready'
      preview: SourcePreview | null
      acquired: AcquiredSource | null
      draft: StreamedDraft | null
      finished: FinishedImport
    }
  | { kind: 'not_grounded'; job: ImportJobResponse }
  | { kind: 'no_recipe' }
  | { kind: 'paste'; error: string | null }
  | {
      kind: 'error'
      message: string
      preview: SourcePreview | null
      acquired: AcquiredSource | null
      draft: StreamedDraft | null
    }
  /** The server said why: its provider was unavailable, or the extraction came back
   * incomplete. `url` is what Try again resubmits (`null` for a pasted text). */
  | {
      kind: 'failed'
      failure: ImportFailure
      url: string | null
      preview: SourcePreview | null
      acquired: AcquiredSource | null
      draft: StreamedDraft | null
    }
  | {
      kind: 'slow'
      jobId: string
      token: number
      status: ImportStatus
      preview: SourcePreview | null
      acquired: AcquiredSource | null
      draft: StreamedDraft | null
    }

/** The screen's own sentence for each failure kind. The server sends an equivalent one in
 * `job.error` for older web builds; this build reads `failure` and writes its own. */
export const FAILURE_COPY: Record<ImportFailure, string> = {
  unavailable: 'We couldn’t reach our recipe reader. Try again in a minute.',
  incomplete: 'We couldn’t finish reading this recipe.',
  refused: 'We couldn’t read this recipe.',
}

/** A second line under the sentence, for the failure kinds that have one. */
export const FAILURE_HINT: Partial<Record<ImportFailure, string>> = {
  refused: 'Paste the recipe text, or try another link.',
}

export type PollDecision =
  | { kind: 'done' }
  | { kind: 'phase'; phase: Phase; keepPolling: boolean }

/**
 * What one poll response means. Pure, so each branch tests without a browser; the hook
 * only carries the decision out. `done` is left to the hook (it builds the plan).
 *
 * A `failed` job with `result.failure` becomes the `failed` phase. A `failed` job without
 * one (an older server, or the last-resort handler) keeps today's `error` path.
 */
export function phaseFor(
  job: ImportJobResponse,
  ctx: { jobId: string; token: number; attempt: number; maxPolls: number; url: string | null },
): PollDecision {
  if (job.status === 'done' && job.result?.graph && job.result.plan && job.result.stages) {
    return { kind: 'done' }
  }
  const preview = job.preview ?? null
  const acquired = job.acquired ?? null
  const draft = job.draft ?? null
  switch (job.status) {
    case 'method_not_grounded':
      return { kind: 'phase', phase: { kind: 'not_grounded', job }, keepPolling: false }
    case 'no_recipe_found':
      return { kind: 'phase', phase: { kind: 'no_recipe' }, keepPolling: false }
    case 'failed': {
      const failure = job.result?.failure
      const phase: Phase = failure
        ? { kind: 'failed', failure, url: ctx.url, preview, acquired, draft }
        : { kind: 'error', message: job.error ?? 'The import failed.', preview, acquired, draft }
      return { kind: 'phase', phase, keepPolling: false }
    }
    default:
      if (ctx.attempt >= ctx.maxPolls) {
        return {
          kind: 'phase',
          phase: {
            kind: 'slow',
            jobId: ctx.jobId,
            token: ctx.token,
            status: job.status,
            preview,
            acquired,
            draft,
          },
          keepPolling: false,
        }
      }
      return {
        kind: 'phase',
        phase: { kind: 'polling', status: job.status, preview, acquired, draft },
        keepPolling: true,
      }
  }
}
