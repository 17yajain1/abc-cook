/**
 * "Your plan is ready", floated just above the footer. Positioned off the footer (`bottom-full`), so it
 * shifts nothing and follows the footer's height. The region is always mounted; only its text comes and
 * goes, which is what lets a screen reader announce it politely.
 */
export function ReadyPill({ visible }: { visible: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-full left-0 right-0 mb-3 flex justify-center"
    >
      {visible && (
        <span className="rounded-full bg-home-ink px-4 py-2 text-[13px] font-semibold text-home-ground">
          Your plan is ready
        </span>
      )}
    </div>
  )
}
