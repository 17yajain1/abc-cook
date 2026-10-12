import type { FeedFilter } from './types'

/** One row of chips that scrolls sideways (the last one is allowed to run off the edge).
 * Emoji is allowed here, and only here (docs/DESIGN_SYSTEM.md § Register: Home). */
export function FilterChips({
  filters,
  value,
  onChange,
}: {
  filters: FeedFilter[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5">
      {filters.map((f) => {
        const active = f.id === value
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            aria-pressed={active}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${
              active
                ? 'border-home-ink bg-home-ink text-home-ground'
                : 'border-home-rule bg-home-surface text-home-ink'
            }`}
          >
            {f.emoji && <span aria-hidden="true">{f.emoji}</span>}
            {f.label}
          </button>
        )
      })}
    </div>
  )
}
