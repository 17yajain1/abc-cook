import type { ReactNode, Ref, UIEventHandler } from 'react'

/**
 * The one frame of the recipe page, in two modes (D1). `plan` is a finished recipe (`PlanScreen`);
 * `importing` is the same page while the import fills it in (`ImportingPage`). Both are one scroll area
 * above a sticky footer, on the Home ground, so the draft -> plan swap changes the content and not the
 * page. The frame owns only the layout; the modes pass their own header, sections, overlay and footer.
 *
 * `relative` matters: the footer and the compact bar are absolutely positioned, and without a positioned
 * ancestor they would resolve against the viewport and escape the 390px column at any wider width.
 * `overflow-x-clip` guards a sub-390px viewport. `h-screen-dynamic` (index.css) is 100dvh, so the page
 * tracks Safari's toolbars.
 */
export function RecipePage({
  mode,
  scrollRef,
  onScroll,
  bottomPad,
  overlay,
  footer,
  children,
}: {
  mode: 'plan' | 'importing'
  scrollRef?: Ref<HTMLDivElement>
  onScroll?: UIEventHandler<HTMLDivElement>
  /** Space under the last section so it clears the footer. */
  bottomPad: string
  /** Laid over the scroll area (the compact bar and its measuring spacer). */
  overlay?: ReactNode
  /** The footer's content: the primary action, and under it any one-line note. */
  footer: ReactNode
  children: ReactNode
}) {
  return (
    <div data-mode={mode} className="h-screen-dynamic relative overflow-x-clip bg-home-ground text-home-ink">
      <div ref={scrollRef} onScroll={onScroll} className={`no-scrollbar h-full overflow-y-auto ${bottomPad}`}>
        {children}
      </div>
      {overlay}
      {/* z-20 keeps this footer above the scrolled content beneath it. The bottom padding is at least the
          home-indicator inset, so the pill clears Safari's bottom toolbar. */}
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-home-rule bg-home-ground px-5 pb-[max(24px,var(--safe-bottom))] pt-3.5">
        {footer}
      </div>
    </div>
  )
}
