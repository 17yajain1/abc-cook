/**
 * "Does this text contain a number?" in the three scripts recipes use: ASCII digits,
 * the vulgar fractions (¼ ½ ¾ and ⅐–⅞) and Devanagari digits (०–९). One definition,
 * shared by the ingredient marker (`quantity.ts`) and the step note (`stepNote.ts`), so
 * the two can never disagree about what counts as a number.
 */
const NUMBER_CHAR = /[0-9०-९¼-¾⅐-⅞]/u

export function hasNumber(text: string | null | undefined): boolean {
  return text != null && NUMBER_CHAR.test(text)
}
