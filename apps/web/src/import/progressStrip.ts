import { canonicalUrlSourceKey } from '../library/sourceKey'
import type { ImportViewModel } from './importView'
import type { ImportStatus } from './phase'

/** What the source is, for the first segment's label: "Video read", "Page read" or "Text read". */
export type SourceKind = 'video' | 'page' | 'text'

/** A pasted text is text; a YouTube or Instagram link is a video; any other link is a page. */
export function sourceKindFor(url: string | null, isText: boolean): SourceKind {
  if (isText) return 'text'
  const key = url ? canonicalUrlSourceKey(url.trim()) : null
  return key?.startsWith('youtube:') || key?.startsWith('instagram:') ? 'video' : 'page'
}

export type SegmentState = 'done' | 'active' | 'pending'

export interface StripSegment {
  key: 'read' | 'ingredients' | 'steps' | 'plan'
  label: string
  state: SegmentState
}

export interface ProgressStrip {
  /** Names the active segment, never how long it will take. Derived from the segments, so the two cannot disagree. */
  headline: string
  segments: StripSegment[]
}

const HEADLINE: Record<StripSegment['key'], string> = {
  read: 'Getting the recipe…',
  ingredients: 'Reading the ingredients…',
  steps: 'Reading the steps…',
  plan: 'Building your cooking plan…',
}

const READ_LABEL: Record<SourceKind, string> = { video: 'Video read', page: 'Page read', text: 'Text read' }

/**
 * The four-part progress strip on the importing recipe page, derived only from fields the server
 * already sends: the job status and the view model (`importViewFor`). Nothing is estimated and
 * there is no time: a segment is done when its content is complete or came whole from the source,
 * and the first segment that is not done is the one in progress.
 *
 * - read: the job has left `acquiring`, or a blog page gave its recipe. The job's `acquired` title and channel are
 *   NOT the signal: the server publishes them as soon as yt-dlp answers, while captions and link probing still run.
 * - ingredients / steps: the draft marked the section complete, or the source's own lines gave it whole.
 *   Ingredients are also done once steps have begun (the draft streams them in that order), and both are done
 *   once the job is past extraction (a cache hit streams nothing).
 * - plan: the job is validating or building the plan; done only once the job is done.
 */
export function progressStripFor(
  view: ImportViewModel,
  status: ImportStatus,
  source: { kind: SourceKind; preview: boolean },
): ProgressStrip {
  const readDone = source.preview || status !== 'acquiring'
  const pastExtraction = status === 'validating' || status === 'plan_building' || status === 'done'
  const stepsStarted = view.method.kind === 'steps' || view.method.kind === 'sections'
  const ingredientsDone =
    pastExtraction ||
    stepsStarted ||
    view.ingredients.kind === 'lines' ||
    (view.ingredients.kind === 'items' && view.ingredients.complete)
  const stepsDone =
    pastExtraction || view.method.kind === 'sections' || (view.method.kind === 'steps' && view.method.complete)
  const planDone = status === 'done'

  const done: Record<StripSegment['key'], boolean> = {
    read: readDone,
    ingredients: ingredientsDone,
    steps: stepsDone,
    plan: planDone,
  }
  const labels: Record<StripSegment['key'], string> = {
    read: READ_LABEL[source.kind],
    ingredients: 'Ingredients',
    steps: 'Steps',
    plan: 'Your plan',
  }
  const order: StripSegment['key'][] = ['read', 'ingredients', 'steps', 'plan']
  const firstOpen = order.find((key) => !done[key])
  return {
    headline: HEADLINE[firstOpen ?? 'plan'],
    segments: order.map((key) => ({
      key,
      label: labels[key],
      state: done[key] ? 'done' : key === firstOpen ? 'active' : 'pending',
    })),
  }
}
