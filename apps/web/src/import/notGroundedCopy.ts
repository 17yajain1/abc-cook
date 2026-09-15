/**
 * A5: deterministic Tier-0 explanation, chosen from `ImportResult.sources` — never
 * generates a method, never calls the model a second time.
 *
 * A separate module from `ImportScreen.tsx` so this pure selection logic is testable
 * without pulling in `api/client.ts`'s browser-only module-scope `window` read.
 */
export function notGroundedCopy(sources: readonly string[]): string {
  const hasTranscript = sources.includes('transcript')
  const hasBlog = sources.includes('blog')
  if (hasTranscript) return "We read this video's captions but couldn't find the method in them."
  if (hasBlog) return 'The linked recipe page had no instructions we could use.'
  return "This video has no captions, and its description lists ingredients without saying how the dish is made."
}
