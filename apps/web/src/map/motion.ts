/**
 * Timing constants and pure delay math for the Map's one entry animation.
 *
 * The M2.75 handoff's animation brief describes "axis draws downward, then cards/arrows
 * fade in" — but the static grammar it was written against had a time axis, and the
 * shipped Map has none (`docs/DESIGN_SYSTEM.md` § *Resolved in M2.75, round 2*, item 4).
 * This file is the replacement: the cards themselves sweep top-to-bottom (their own `y`
 * already carries "when", per the grammar doc), landing at the brief's ~500ms, then
 * connectors and fold labels fade in as a second beat. See `docs/DESIGN_SYSTEM.md`
 * § *Map entry animation* for the full mark-by-mark spec.
 *
 * Pure, no DOM, no React — kept alongside `layout.ts`'s discipline so it can be unit
 * tested against every golden fixture's real geometry.
 */

/** Duration of every fade in this animation, card or connector alike. */
export const FADE_MS = 150

/** Delay of the card at the very bottom of the map. `SWEEP_MS + FADE_MS` = the last
 * card's landing time, ~500ms, matching the handoff's axis-sweep budget. */
export const SWEEP_MS = 350

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * A card's entry delay in milliseconds, proportional to its position in the map's own
 * height. `0` at the top, `SWEEP_MS` at the bottom — constant-speed sweep regardless of
 * how tall a given recipe's map is.
 */
export function entryDelayMs(y: number, mapHeight: number): number {
  if (mapHeight <= 0) return 0
  return Math.round(SWEEP_MS * clamp(y / mapHeight, 0, 1))
}

/**
 * When connectors (edges, brackets) and fold labels should fade in for a given map:
 * exactly when that map's own slowest card finishes landing — not a universal
 * constant. A short map (Kadai Paneer, cards landing by ~260ms) gets no dead hold
 * before its connectors appear; a tall map (Chicken Biryani, cards landing as late as
 * ~475ms) still gets its full sweep first. The "no connector before its endpoints
 * exist" invariant holds by construction (this *is* the last card's landing time),
 * not by picking a fixed number large enough to cover the worst case.
 */
export function connectorDelayMs(cards: { y: number }[], mapHeight: number): number {
  const lastCardDelay = cards.reduce((max, c) => Math.max(max, entryDelayMs(c.y, mapHeight)), 0)
  return lastCardDelay + FADE_MS
}
