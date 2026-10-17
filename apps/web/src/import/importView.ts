import type { AcquiredSource, ImportJobResponse, PreviewSection, SourcePreview } from '@abc-cook/schema'

import type { InstantHeader } from './instantPreview'

export type ImportStatus = ImportJobResponse['status']

/**
 * What the import screen shows while a job runs, decided in one pure place.
 *
 * Source text only — title, channel, thumbnail, description, and the source's own
 * ingredient and method lines, each rendered as the source wrote it. No durations, no
 * timers, no start-time advice: this screen sits *before* the scheduler and must not
 * borrow its authority (CLAUDE.md: the frontend renders `CookingPlan`, nothing more).
 *
 * Built to be extended, not replaced: a later streamed draft adds an `items` variant to
 * `ingredients` and a `steps` variant to `method`.
 */
export interface ImportViewModel {
  header: {
    title: string | null
    channel: string | null
    thumbnailUrl: string | null
    description: string | null
  } | null
  ingredients: { kind: 'pending' } | { kind: 'lines'; lines: string[] }
  method: { kind: 'pending' } | { kind: 'sections'; sections: PreviewSection[] }
  status: ImportStatus
}

export interface ImportViewInput {
  /** Set synchronously at submit for a YouTube link; `title`/`channel` fill in from oEmbed. */
  instant: InstantHeader | null
  /** From the job status, once the server's acquire step has returned. */
  acquired: AcquiredSource | null
  /** The blog page's own recipe (JSON-LD), when the source has one. */
  preview: SourcePreview | null
  status: ImportStatus
}

const nonEmpty = (value: string | null | undefined): string | null =>
  value && value.trim() ? value : null

export function importViewFor({ instant, acquired, preview, status }: ImportViewInput): ImportViewModel {
  // Title precedence: oEmbed (earliest), then the server's acquired title, then the
  // page's recipe name. oEmbed and `acquired` carry the same raw video title, so the text
  // does not change when the later one arrives; it is never replaced once set.
  const title = nonEmpty(instant?.title) ?? nonEmpty(acquired?.title) ?? nonEmpty(preview?.title)
  const channel = nonEmpty(instant?.channel) ?? nonEmpty(acquired?.channel)
  const thumbnailUrl = instant?.thumbnailUrl ?? null
  const description = nonEmpty(acquired?.description)

  const hasHeader = title != null || channel != null || thumbnailUrl != null || description != null

  const lines = preview?.ingredients.filter((line) => line.trim()) ?? []
  const sections = (preview?.instructions ?? []).filter((s) => s.lines.length > 0)

  return {
    header: hasHeader ? { title, channel, thumbnailUrl, description } : null,
    ingredients: lines.length > 0 ? { kind: 'lines', lines } : { kind: 'pending' },
    method: sections.length > 0 ? { kind: 'sections', sections } : { kind: 'pending' },
    status,
  }
}
