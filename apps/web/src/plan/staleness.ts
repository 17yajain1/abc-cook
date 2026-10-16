/** What the open path found about a saved plan (`library/openSaved.ts`). `onReimport` is
 * set only when a URL exists to prefill, so the button follows the line only then. */
export interface StalenessMarker {
  kind: 'stale' | 'unchecked'
  onReimport?: () => void
}

/** The staleness line. It sits directly under the title (`StalenessNotice`), and while it
 * shows the A6 status line stays hidden: A6 describes the plan about to be replaced. */
export function stalenessLineFor(kind: StalenessMarker['kind']): string {
  return kind === 'stale'
    ? 'This plan may be out of date.'
    : "Couldn't check for updates. Showing your saved plan."
}
