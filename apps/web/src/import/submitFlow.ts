import type { SavedRecipe } from '@abc-cook/schema'

import type { OEmbed } from '../api/oembed'
import { submitPlan, type FindSaved } from './duplicate'
import type { InstantPreview } from './instantPreview'

/** The side effects of a URL submit, as callbacks, so the order they run in is testable
 * without a browser. `useImportJob` supplies the real ones. */
export interface SubmitIO {
  /** Shows the import screen: sets the instant header and the polling phase. Never called
   * for a duplicate, so a duplicate never flashes the draft. */
  begin(instant: InstantPreview | null): void
  fetchOEmbed(oembedUrl: string): Promise<OEmbed | null>
  onTitle(found: OEmbed): void
  startImport(url: string): Promise<{ job_id: string }>
  onStarted(jobId: string): void
  onStartFailed(err: unknown): void
  onDuplicate(saved: SavedRecipe): void
}

/**
 * Executes `submitPlan`: duplicate check, then the instant header, then `POST /import`
 * (oEmbed runs in parallel with it). On a duplicate it calls `onDuplicate` and returns
 * before anything else, so no header is set, no oEmbed is fetched and no import starts.
 */
export function runSubmit(
  url: string,
  options: { findSaved?: FindSaved; skipDuplicateCheck?: boolean },
  io: SubmitIO,
): void {
  const plan = submitPlan(url, options)
  if (plan.kind === 'duplicate') {
    io.onDuplicate(plan.saved)
    return
  }
  io.begin(plan.instant)
  if (plan.instant) void io.fetchOEmbed(plan.instant.oembedUrl).then((found) => found && io.onTitle(found))
  io.startImport(url).then(({ job_id }) => io.onStarted(job_id), io.onStartFailed)
}
