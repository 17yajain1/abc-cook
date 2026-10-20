import { useState } from 'react'

import { orphanNowLine, type Orphan } from '@/library/recipeEdits'

import { BackButton } from './BackButton'

/**
 * R6a (A22): the changes that could not be applied, one card each. They are kept until the cook
 * discards them; there is no "apply anyway", because the line they were made on is not the line
 * at that position any more.
 */
export function OrphanReview({
  orphans,
  onBack,
  onDiscard,
}: {
  orphans: readonly Orphan[]
  onBack: () => void
  /** Returns the failure message, or null once the change is gone. */
  onDiscard: (editId: string) => string | null
}) {
  const [errors, setErrors] = useState<Record<string, string>>({})
  return (
    <div className="px-5 pb-8">
      <div className="-ml-3 flex h-14 items-center">
        <BackButton onClick={onBack} />
      </div>
      <h1 className="text-[22px] font-bold leading-[26px] tracking-[-0.3px] text-home-ink">Changes that couldn't be applied</h1>
      <p className="mt-2 text-[13px] leading-[1.4] text-home-ink-2">
        The imported recipe changed, so these changes were not applied. They are kept until you discard them.
      </p>
      {orphans.length === 0 && <p className="mt-4 text-[15px] text-home-ink">Nothing left to review.</p>}
      {orphans.map((o) => (
        <div key={o.id} className="mt-4 rounded-home-card border border-home-rule bg-home-surface p-4">
          <div className="text-[15px] font-semibold text-home-ink">{o.label}</div>
          <p className="mt-1 text-[13px] text-home-ink-2">Your change: {o.yourChange}</p>
          <p className="text-[13px] text-home-ink-2">{orphanNowLine(o.nowSays)}</p>
          {errors[o.id] && <p className="mt-1 text-[13px] text-home-terracotta-text">{errors[o.id]}</p>}
          <button
            type="button"
            onClick={() => {
              const message = onDiscard(o.id)
              setErrors((e) => ({ ...e, [o.id]: message ?? '' }))
            }}
            className="mt-1 flex h-11 items-center text-[15px] font-medium text-home-ink underline underline-offset-2"
          >
            Discard this change
          </button>
        </div>
      ))}
    </div>
  )
}
