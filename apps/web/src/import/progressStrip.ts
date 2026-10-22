import { canonicalUrlSourceKey } from '../library/sourceKey'
import { footerFor, type ImportViewModel } from './importView'
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
  /** The existing `footerFor` sentence: it names what is being read, never how long it will take. */
  headline: string
  segments: StripSegment[]
}

const READ_LABEL: Record<SourceKind, string> = { video: 'Video read', page: 'Page read', text: 'Text read' }

/**
 * The four-part progress strip on the importing recipe page, derived only from fields the server
 * already sends: the job status and the view model (`importViewFor`). Nothing is estimated and
 * there is no time: a segment is done when its content is complete or came whole from the source,
 * and the first segment that is not done is the one in progress.
 *
 * - read: the server has acquired the source (or a blog page gave its recipe), or has moved on.
 * - ingredients / steps: the draft marked the section complete, or the source's own lines gave it whole.
 * - plan: the job is validating or building the plan; done only once the job is done.
 */
export function progressStripFor(
  view: ImportViewModel,
  status: ImportStatus,
  source: { kind: SourceKind; acquired: boolean; preview: boolean },
): ProgressStrip {
  const readDone = source.acquired || source.preview || status !== 'acquiring'
  const ingredientsDone =
    view.ingredients.kind === 'lines' || (view.ingredients.kind === 'items' && view.ingredients.complete)
  const stepsDone =
    view.method.kind === 'sections' || (view.method.kind === 'steps' && view.method.complete)
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
    headline: footerFor(view, status),
    segments: order.map((key) => ({
      key,
      label: labels[key],
      state: done[key] ? 'done' : key === firstOpen ? 'active' : 'pending',
    })),
  }
}
