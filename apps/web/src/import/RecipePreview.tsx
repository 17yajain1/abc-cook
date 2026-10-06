import type { SourcePreview } from '@abc-cook/schema'

/**
 * The page's own recipe, shown while the cooking plan is still being built (A2).
 *
 * Source text only — every string is rendered exactly as the API sent it. No durations,
 * no quantities parsed out of the lines, no "time saved": this screen sits *before* the
 * scheduler and must not borrow its authority (CLAUDE.md: the frontend renders
 * `CookingPlan`, nothing more). Presentation follows `DESIGN_SYSTEM.md`: paper, ink,
 * hairline rules, no cards, no pills; numbering is plain tabular numerals because the
 * method genuinely is a sequence.
 */
export function RecipePreview({
  preview,
  footer,
  onCancel,
}: {
  preview: SourcePreview
  /** The quiet line pinned under the page, e.g. "Building your cooking plan…". */
  footer: React.ReactNode
  onCancel: () => void
}) {
  let stepNumber = 0

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex flex-shrink-0 justify-end px-5 pt-3.5" style={{ minHeight: 32 }}>
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] text-ink-3 underline underline-offset-[3px]"
        >
          Cancel
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4">
        <h1
          className="text-[26px] font-semibold leading-[1.15] text-ink"
          style={{ fontStretch: '88%' }}
        >
          {preview.title}
        </h1>

        {preview.ingredients.length > 0 && (
          <section className="mt-8">
            <h2 className="text-[15px] font-semibold text-ink">Ingredients</h2>
            <ul className="mt-2 border-t border-rule">
              {preview.ingredients.map((line, i) => (
                <li
                  key={`${i}-${line}`}
                  className="border-b border-rule py-2.5 text-[15px] leading-[1.45] text-ink"
                >
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-ink">Method</h2>
          {preview.instructions.map((section, s) => (
            <div key={`${s}-${section.heading ?? ''}`} className="mt-3">
              {section.heading && (
                <h3 className="mb-1 text-[15px] font-medium text-ink-2">{section.heading}</h3>
              )}
              <ol>
                {section.lines.map((line, i) => {
                  stepNumber += 1
                  return (
                    <li key={`${i}-${line}`} className="flex gap-3 py-2">
                      <span className="tabular w-5 flex-shrink-0 pt-px text-right text-[13px] text-ink-3">
                        {stepNumber}
                      </span>
                      <span className="text-[15px] leading-[1.55] text-ink">{line}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </section>
      </div>

      <div
        className="flex-shrink-0 border-t border-rule px-5 pb-6 pt-4 text-[15px] text-ink-2"
        role="status"
        aria-live="polite"
      >
        {footer}
      </div>
    </div>
  )
}
