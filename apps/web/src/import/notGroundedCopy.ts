/**
 * A5/A1.1: deterministic Tier-0 explanation, chosen from `ImportResult.sources` plus
 * whether any ingredients were actually found — never generates a method, never calls
 * the model a second time.
 *
 * `hasIngredients` must come from the same evidence the shopping-list display uses
 * (`groups.length > 0`), not from `sources.includes('description')` alone — a non-empty
 * description source does not mean any ingredient was parsed out of it.
 *
 * A separate module from `ImportScreen.tsx` so this pure selection logic is testable
 * without pulling in `api/client.ts`'s browser-only module-scope `window` read.
 */
export function notGroundedCopy(sources: readonly string[], hasIngredients: boolean): string {
  const hasTranscript = sources.includes('transcript')
  const hasBlog = sources.includes('blog')
  if (hasTranscript) return "We read this video's captions but couldn't find the method in them."
  if (hasBlog) return 'The linked recipe page had no instructions we could use.'
  if (hasIngredients) {
    return "This video has no captions, and its description lists ingredients without saying how the dish is made."
  }
  return "We couldn't find usable ingredients or instructions for this recipe."
}
