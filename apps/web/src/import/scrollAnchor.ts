/**
 * Keeping the cook's place across the draft -> plan swap. The importing page and the plan page are
 * different React trees with different heights, so pixels do not carry over; a section and an offset
 * inside it do. Pure: the page measures the section tops and these two functions do the arithmetic.
 */
export type AnchorSection = 'top' | 'need' | 'steps'

export interface ScrollAnchor {
  section: AnchorSection
  /** Pixels below the section's top (`top`: below the top of the page). */
  offset: number
}

/** Where each section starts, in pixels from the top of the scroll content. */
export interface SectionTops {
  need: number
  steps: number
}

/** The scrolled distance, as a section and an offset inside it. */
export function anchorFrom(scrollTop: number, tops: SectionTops): ScrollAnchor {
  const top = Math.max(0, scrollTop)
  if (top < tops.need) return { section: 'top', offset: top }
  if (top < tops.steps) return { section: 'need', offset: top - tops.need }
  return { section: 'steps', offset: top - tops.steps }
}

/**
 * The scroll position that puts the cook back where the anchor says, on a page laid out as `tops`.
 * - `top` keeps the same pixel offset, held inside the header (it never lands past What you need).
 * - `need` keeps the offset inside What you need, clamped to that section's height.
 * - `steps` lands with the Steps heading just under the sticky bar (`inset`, the bar's height): the draft's steps are the source's wording and the
 *   plan's are a rewrite, so there is no line to line counterpart to hold.
 */
export function scrollTopFor(
  anchor: ScrollAnchor,
  tops: SectionTops,
  heights: { need: number },
  inset = 0,
): number {
  switch (anchor.section) {
    case 'top':
      return Math.min(Math.max(0, anchor.offset), tops.need)
    case 'need':
      return tops.need + Math.min(Math.max(0, anchor.offset), Math.max(0, heights.need))
    case 'steps':
      return Math.max(0, tops.steps - inset)
  }
}

/** Measures the two sections inside a scroll container: elements carrying `data-anchor="need"` and
 * `data-anchor="steps"`. Both the importing page and the plan page mark theirs. `null` when either is
 * missing (the importing page shows its sections only once something has arrived to fill them). */
export function measureSections(scroller: HTMLElement): { tops: SectionTops; heights: { need: number } } | null {
  const need = scroller.querySelector<HTMLElement>('[data-anchor="need"]')
  const steps = scroller.querySelector<HTMLElement>('[data-anchor="steps"]')
  if (!need || !steps) return null
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const needTop = need.getBoundingClientRect().top - base
  const stepsTop = steps.getBoundingClientRect().top - base
  return { tops: { need: needTop, steps: stepsTop }, heights: { need: need.getBoundingClientRect().height } }
}
