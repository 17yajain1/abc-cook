/**
 * The doneness cue as its own line, or `null` when the step's text already says it.
 *
 * The cue is the node's `doneness_cue` and often repeats how the instruction ends ("...Bring to one
 * boil and take off the fire." with the cue "bring to one boil"). Printed after "until" it also read
 * as broken grammar ("until bring to one boil"). So the recipe page prints it only when the text
 * doesn't contain it, and then as a sentence of its own. It runs after `displayCue`, which decides
 * whether a cue is showable at all.
 *
 * Presentational only: a miss means the cue shows twice, never that anything is wrongly timed.
 */

/** Lower-case, punctuation to spaces, whitespace collapsed: the comparison form of a sentence. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The cue as a sentence ("Golden brown."), or `null` when `instruction` already contains it. */
export function cueShownWith(instruction: string, cue: string | null): string | null {
  if (cue == null) return null
  const wanted = normalise(cue)
  if (wanted === '') return null
  // Padded with spaces so "boil" is not found inside "boiling".
  if (` ${normalise(instruction)} `.includes(` ${wanted} `)) return null
  const bare = cue.trim().replace(/[.!?…\s]+$/u, '')
  if (bare === '') return null
  return `${bare.charAt(0).toUpperCase()}${bare.slice(1)}.`
}
