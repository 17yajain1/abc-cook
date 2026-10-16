import { stalenessLineFor, type StalenessMarker } from './staleness'

/**
 * One calm line, plus a Re-import text button when the source is a URL. It renders inside
 * `RecipeHeader`, directly under the title, so it is on screen without scrolling even with
 * a long title and a plan-ahead card (a status slot below the header was off-screen there).
 * Text-only in the Home register's secondary ink: no icon, no banner, no new colour.
 */
export function StalenessNotice({ marker }: { marker: StalenessMarker }) {
  return (
    <div className="mt-2 text-[13px] leading-[18px] text-home-ink-2">
      <p>{stalenessLineFor(marker.kind)}</p>
      {marker.onReimport && (
        <button
          type="button"
          onClick={marker.onReimport}
          className="-mb-1 inline-flex min-h-[44px] items-center font-semibold text-home-ink underline underline-offset-4"
        >
          Re-import
        </button>
      )}
    </div>
  )
}
