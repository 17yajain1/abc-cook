import type { Node } from '@abc-cook/schema'

import type { EditContext } from './ingredientEditor'
import { isServingWaitNode } from './recipeEdits'

/**
 * R6b D9: the note after an ingredient is renamed. A step's text keeps the name the recipe was
 * imported with unless the cook edited it, so the page can say "the step text still says the old
 * name" and offer a way to fix it. Pure; the page only draws what these return.
 */

export const RENAME_NOTE_COPY = 'Step text still says the old name. Edit the step if you like.'
export const EDIT_THE_STEP = 'Edit the step'

const WORD_START = '(?<![\\p{L}\\p{M}\\p{N}])'
const WORD_END = '(?![\\p{L}\\p{M}\\p{N}])'
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The spellings of `name` a step might use (B11): the whole name and its head before the first "("
 * or ",", each also with a simple plural (+s, +es).
 */
export function nameVariants(name: string): string[] {
  const full = name.trim()
  const head = full.split(/[(,]/)[0].trim()
  const bases = [...new Set([full, head].filter((b) => b !== ''))]
  return [...new Set(bases.flatMap((b) => [b, `${b}s`, `${b}es`]))]
}

/** Whether `text` has `name` (any variant) as a whole word, ignoring case. Devanagari-safe: a letter or mark either side is not a boundary. */
export function textMentionsName(text: string, name: string): boolean {
  const hay = text.normalize('NFC')
  return nameVariants(name.normalize('NFC')).some((v) => new RegExp(`${WORD_START}${escapeRegex(v)}${WORD_END}`, 'iu').test(hay))
}

/** B4: "old name" is either the imported name or the name before this Save; the first matches steps the cook never edited. */
export function renameOldNames(importedName: string | null, beforeSave: string): string[] {
  return [...new Set([importedName, beforeSave].filter((n): n is string => n != null && n.trim() !== '').map((n) => n.trim()))]
}

/**
 * The ids of the steps that consume ingredient `rowId` and whose text, as it reads now (overlaid), still
 * has one of `oldNames`. The serving-wait node never counts: its text is generated.
 */
export function renameNoteSteps(ctx: EditContext, rowId: string, oldNames: readonly string[]): string[] {
  if (oldNames.length === 0) return []
  return (ctx.overlay.payload.graph.nodes as Node[])
    .filter((n) => !isServingWaitNode(n) && (n.consumes ?? []).includes(rowId) && oldNames.some((name) => textMentionsName(n.instruction, name)))
    .map((n) => n.id)
}
