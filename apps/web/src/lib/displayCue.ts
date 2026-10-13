/** Any letter whose script is not Latin (Devanagari, Tamil, Arabic, …). Digits,
 *  punctuation and accented Latin letters (`sauté`) don't match. */
const NON_LATIN_LETTER = /(?!\p{Script=Latin})\p{L}/u

/**
 * The doneness cue as the recipe page may show it, or `null` to hide it.
 *
 * A stopgap (Sabudana investigation, decision D4, 2026-10-13): the extractor sometimes
 * quotes a Hindi cue verbatim from the transcript, and an English page can't use it. Any
 * non-Latin letter hides the whole cue; it is never partly shown. The real fix is at the
 * source (prompt v8). Recipe page only: Cooking mode reads the raw cue, and
 * `cooking/select.ts` treats cue presence as "can be judged by eye".
 */
export function displayCue(cue: string | null): string | null {
  if (cue == null || cue.trim() === '') return null
  return NON_LATIN_LETTER.test(cue) ? null : cue
}
