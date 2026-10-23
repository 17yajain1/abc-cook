import type { SavedRecipe } from '@abc-cook/schema'

import type { FindSaved } from './duplicate'
import type { ImportHandlers } from './handOff'
import { ImportProgress, isProgressPhase } from './ImportProgress'
import { useImportJob } from './useImportJob'

/**
 * Paste-a-link import flow (design doc §4.5/§12 step 12): submit a URL, poll the job,
 * and hand a finished plan back to `App` — the same `RenderPlan` shape
 * `fetchPlan` produces, so it reaches the existing `PlanScreen` unchanged. A Tier 0
 * (`method_not_grounded`) result renders inline here instead, since there is no plan
 * to hand off.
 */
export function ImportScreen({
  importHandlers,
  onCancel,
  initialUrl,
  findSaved,
  onDuplicate,
  skipDuplicateCheck,
}: {
  importHandlers: ImportHandlers
  onCancel: () => void
  /** Prefills the field (Re-import). The user still taps "Get the plan": an LLM spend is
   * never started by a mount. */
  initialUrl?: string
  /** Duplicate check for a pasted URL, and what to do on a match (open the saved entry). */
  findSaved?: FindSaved
  onDuplicate?: (saved: SavedRecipe) => void
  /** Re-import and Import again: the source is already saved, import it anyway. */
  skipDuplicateCheck?: boolean
}) {
  const job = useImportJob(importHandlers, { initialUrl, findSaved, onDuplicate, skipDuplicateCheck })
  const { phase, url, setUrl, setPhase, submit } = job

  if (isProgressPhase(phase)) return <ImportProgress job={job} onCancel={onCancel} />

  return (
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">Add a recipe</h1>
      <p className="mt-1 text-[15px] text-ink-2">Paste a link to a recipe video or a recipe page.</p>

      <input
        type="url"
        inputMode="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="YouTube, Instagram or recipe page link…"
        className="mt-8 rounded-control border border-rule bg-paper px-3.5 py-3 text-[16px] text-ink outline-none focus:border-ink-3"
      />

      {phase.kind === 'error' && (
        <p className="mt-3 text-[13px] text-signal">{phase.message}</p>
      )}
      <button
        type="button"
        onClick={() => submit()}
        disabled={!url.trim()}
        className="mt-4 rounded-control bg-signal py-3 text-[15px] font-semibold text-paper disabled:opacity-40"
      >
        Get the plan
      </button>

      <button
        type="button"
        onClick={() => setPhase({ kind: 'paste', error: null })}
        className="mt-6 self-center text-[15px] text-ink-2 underline underline-offset-4"
      >
        Paste the recipe text instead
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
