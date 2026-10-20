import type { Node, RecipeEdit } from '@abc-cook/schema'

import { stepAmountHint } from '@/lib/stepNote'

import type { CommitDeps, EditContext } from './ingredientEditor'
import { isServingWaitNode, resolveStep, stepAnchor, STEP_TEXT_MAX } from './recipeEdits'

/**
 * R6b: the step-text editor as pure state, beside the ingredient editor. The React layer draws a
 * `StepFieldState`; every rule (what is normalised, what is refused, what is written) is here.
 *
 * What the cook types is kept exactly as typed while they type. Whitespace is normalised once,
 * at commit (B2/D3); a stored text is applied verbatim by the overlay.
 */

export const STEP_COPY = {
  empty: 'Enter the step.',
  tooLong: 'Keep the step to 1000 characters.',
} as const

export interface StepFieldState {
  target: { kind: 'step'; nodeId: string }
  /** Exactly what is in the field. */
  text: string
  errors: { text?: string }
  /** The text when the editor opened, to tell whether the cook changed anything. */
  initial: string
}

/** Trim, then collapse every whitespace run (newlines included) to one space: the page shows one paragraph anyway. */
export function normaliseStepText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ')
}

/** The inline error for `text` as it would be stored, or null. Counts code points, matching Pydantic. */
export function validateStepText(text: string): string | null {
  const normal = normaliseStepText(text)
  if (normal === '') return STEP_COPY.empty
  if ([...normal].length > STEP_TEXT_MAX) return STEP_COPY.tooLong
  return null
}

export function isStepDirty(f: StepFieldState): boolean {
  return f.text !== f.initial
}

/** The editor for step `nodeId` as it reads now (overlaid). Throws for a node the overlay lacks, or the serving-wait node (Q2). */
export function openStep(ctx: EditContext, nodeId: string): StepFieldState {
  const node = (ctx.overlay.payload.graph.nodes as Node[]).find((n) => n.id === nodeId)
  if (!node || isServingWaitNode(node)) throw new Error(`no editable step ${nodeId}`)
  return { target: { kind: 'step', nodeId }, text: node.instruction, errors: {}, initial: node.instruction }
}

export type CommitStepResult =
  | { ok: true; edits: RecipeEdit[]; amountHint: boolean }
  | { ok: false; errors: { text?: string } }

/** The set_step_text edits whose anchor resolves to `nodeId` in the raw payload, with their positions. */
function stepEditsOn(ctx: EditContext, nodeId: string): Array<{ at: number; edit: RecipeEdit }> {
  const nodes = ctx.payload.graph.nodes as Node[]
  const found: Array<{ at: number; edit: RecipeEdit }> = []
  ctx.edits.forEach((edit, at) => {
    const e = edit as unknown as { op?: unknown; anchor?: { index?: unknown; expected?: { text?: unknown } } }
    if (e.op !== 'set_step_text' || typeof e.anchor?.index !== 'number' || typeof e.anchor.expected?.text !== 'string') return
    const hit = resolveStep(nodes, { index: e.anchor.index, expected: { text: e.anchor.expected.text } })
    if (hit != null && nodes[hit].id === nodeId) found.push({ at, edit })
  })
  return found
}

/**
 * The edits after the cook commits `f`: `ctx.edits` itself when nothing changed, otherwise the
 * array with this step's `set_step_text` written (replacing an earlier one in place), or deleted
 * when the text is back to the imported text. The anchor always carries the imported index and
 * text, taken from the raw payload (never the overlay), so it still resolves after an edit.
 */
export function commitStep(ctx: EditContext, f: StepFieldState, deps: CommitDeps): CommitStepResult {
  const error = validateStepText(f.text)
  if (error) return { ok: false, errors: { text: error } }
  if (f.text === f.initial) return { ok: true, edits: ctx.edits, amountHint: false }

  const nodes = ctx.payload.graph.nodes as Node[]
  const index = nodes.findIndex((n) => n.id === f.target.nodeId)
  if (index < 0) return { ok: true, edits: ctx.edits, amountHint: false }
  const imported = nodes[index].instruction
  const text = normaliseStepText(f.text)
  const existing = stepEditsOn(ctx, f.target.nodeId)
  const others = ctx.edits.filter((_, at) => !existing.some((x) => x.at === at))

  if (text === normaliseStepText(imported)) {
    return { ok: true, edits: existing.length === 0 ? ctx.edits : others, amountHint: false }
  }

  const edit = {
    id: deps.newId(),
    created_at: deps.now,
    op: 'set_step_text',
    anchor: stepAnchor(ctx.payload, index),
    value: { text },
  } as RecipeEdit
  const edits = [...ctx.edits]
  if (existing.length > 0) {
    edits.splice(existing[0].at, 1, edit)
    for (const x of existing.slice(1).reverse()) edits.splice(x.at, 1)
  } else {
    edits.push(edit)
  }
  return { ok: true, edits, amountHint: stepAmountHint(imported, text, nodes[index].consumes) }
}

/** Restore original: the edits without any that resolve to `nodeId`. */
export function restoreStep(ctx: EditContext, nodeId: string): RecipeEdit[] {
  const existing = stepEditsOn(ctx, nodeId)
  return existing.length === 0 ? ctx.edits : ctx.edits.filter((_, at) => !existing.some((x) => x.at === at))
}
