/**
 * D3: names to show where the same ingredient can appear twice (a recipe lists "Roasted
 * peanuts" once in the main list and again under "Chutney" — two real portions). Display
 * only: quantities, `consumes` and the Ingredients tab are never touched.
 *
 * Deduplicates on the exact name after trim and case-fold, and nothing looser — no plural
 * or stem matching, so "Green chilli" and "Green chillies" stay separate. Keeps the first
 * occurrence's spelling and order.
 */
export function uniqueDisplayNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}
