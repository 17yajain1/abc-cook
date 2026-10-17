/** Set when a pasted link matched a saved recipe, so the Cookbook copy was opened instead
 * of importing again. `onImportAgain` replaces that copy (never adds a second one). */
export interface AlreadySaved {
  onImportAgain: () => void
}

/**
 * The line shown when a pasted link was already in the Cookbook: what happened, and the one
 * action that overrides it. It follows `StalenessNotice` (plain secondary-ink text directly
 * under the title, the action as an underlined text button) rather than joining the two
 * with a middle dot, which `DESIGN_SYSTEM.md` Â§ Metadata and punctuation retires. Hidden
 * while the stale marker already offers Re-import, so one action never shows twice.
 */
export function AlreadySavedNotice({ alreadySaved }: { alreadySaved: AlreadySaved }) {
  return (
    <div className="mt-2 text-[13px] leading-[18px] text-home-ink-2">
      <p>Already in your Cookbook.</p>
      <button
        type="button"
        onClick={alreadySaved.onImportAgain}
        className="-mb-1 inline-flex min-h-[44px] items-center font-semibold text-home-ink underline underline-offset-4"
      >
        Import again
      </button>
    </div>
  )
}
