import type { AcquiredSource, PreviewSection, SourcePreview, StreamedDraft } from '@abc-cook/schema'

import type { IngredientListGroup } from '../plan/ingredientGroups'
import { draftIngredientGroups } from './draftView'
import type { InstantHeader } from './instantPreview'
import type { ImportStatus } from './phase'

/**
 * What the import screen shows while a job runs, decided in one pure place.
 *
 * Source text and the streamed draft only: title, channel, thumbnail, description, the
 * source's own ingredient and method lines, and the extraction's draft of both, each
 * rendered as written. No durations, no timers, no start-time advice, no servings maths:
 * this screen sits *before* the scheduler and must not borrow its authority (CLAUDE.md:
 * the frontend renders `CookingPlan`, nothing more).
 *
 * `lines` / `sections` come from a blog page's own recipe; `items` / `steps` are the
 * draft, and the screen labels them so. Per section the source's own text wins, then the
 * draft, then a placeholder.
 *
 * `none` is the failed variant: a section that was never filled is dropped rather than
 * left as a "pending" placeholder promising content that is not coming.
 */
export interface ImportViewModel {
  header: {
    title: string | null
    channel: string | null
    thumbnailUrl: string | null
    description: string | null
  } | null
  ingredients:
    | { kind: 'pending' }
    | { kind: 'none' }
    | { kind: 'lines'; lines: string[] }
    | { kind: 'items'; groups: IngredientListGroup[] }
  method:
    | { kind: 'pending' }
    | { kind: 'none' }
    | { kind: 'sections'; sections: PreviewSection[] }
    | { kind: 'steps'; steps: string[]; complete: boolean }
  status: ImportStatus
}

export interface ImportViewInput {
  /** Set synchronously at submit for a YouTube link; `title`/`channel` fill in from oEmbed. */
  instant: InstantHeader | null
  /** From the job status, once the server's acquire step has returned. */
  acquired: AcquiredSource | null
  /** The blog page's own recipe (JSON-LD), when the source has one. */
  preview: SourcePreview | null
  /** What the extraction has streamed so far, when the server sent one. */
  draft?: StreamedDraft | null
  status: ImportStatus
}

const nonEmpty = (value: string | null | undefined): string | null =>
  value && value.trim() ? value : null

export function importViewFor({
  instant,
  acquired,
  preview,
  draft = null,
  status,
}: ImportViewInput): ImportViewModel {
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
  const draftIngredients = draft?.ingredients ?? []
  const draftSteps = (draft?.steps ?? []).map((s) => s.text).filter((text) => text.trim())

  const failed = status === 'failed'
  const empty = (closedEmpty: boolean) =>
    failed || closedEmpty ? ({ kind: 'none' } as const) : ({ kind: 'pending' } as const)

  const ingredients: ImportViewModel['ingredients'] =
    lines.length > 0
      ? { kind: 'lines', lines }
      : draftIngredients.length > 0
        ? { kind: 'items', groups: draftIngredientGroups(draftIngredients) }
        : empty(draft?.ingredients_complete === true)

  const method: ImportViewModel['method'] =
    sections.length > 0
      ? { kind: 'sections', sections }
      : draftSteps.length > 0
        ? { kind: 'steps', steps: draftSteps, complete: draft?.steps_complete === true }
        : empty(draft?.steps_complete === true)

  return {
    header: hasHeader ? { title, channel, thumbnailUrl, description } : null,
    ingredients,
    method,
    status,
  }
}

/**
 * The quiet line under the page, keyed only on what the server has said: its status and
 * which sections have arrived. It names what is being read, never how long it will take.
 * A blog source keeps its own two-line footer (`PreviewFooter`), so this is not asked then.
 */
export function footerFor(view: ImportViewModel, status: ImportStatus): string {
  if (status === 'acquiring') return 'Getting the recipe…'
  if (status === 'extracting') {
    if (view.ingredients.kind === 'pending') return 'Reading the ingredients…'
    const stepsOpen =
      view.method.kind === 'pending' || (view.method.kind === 'steps' && !view.method.complete)
    if (stepsOpen) return 'Reading the steps…'
  }
  return 'Building your cooking plan…'
}
