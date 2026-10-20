import type { Ingredient, Node, RecipeEdit, RecipePlanResponse, SavedRecipe, StepAnchor } from '@abc-cook/schema'

import { joinQtyUnit, quantityTrailingScaled } from '@/lib/quantity'
import { formatAmountRange } from '@/lib/scaleQuantity'

export type { RecipeEdit } from '@abc-cook/schema'

/**
 * R6: the cook's edits, applied as an overlay on a finished plan.
 *
 * Pure, and never mutates what it is given. An edit changes ingredient rows (R6a) and the text
 * of a step, and links an added ingredient to a step (R6b). The plan, the stages, the summary and
 * every node's id, edges and durations come back untouched, which is what keeps a cook in
 * progress, the timers and the scheduler's figures valid: of a node, only `instruction` (an edited
 * step) and `consumes` (a linked add) can differ. Ingredient edits are anchored by index into
 * `graph.ingredients` plus the line expected there. A step edit is anchored by the text it was made
 * on (`resolveStep`). One whose anchor no longer matches (the imported recipe was refreshed and a
 * line moved) is *orphaned*: kept, counted, shown as the imported row, never dropped and never
 * forced onto another line.
 *
 * Anything this does not recognise (an unknown op, a malformed item) is *ignored*: not applied,
 * not counted, and left in the stored array verbatim. A stored step text is applied verbatim;
 * only the editor normalises whitespace (B2).
 */

export const ADDED_GROUP = 'Added by you'

const ADDED_ID_PREFIX = 'ing_user_'

export type EditStatus = 'applied' | 'orphaned' | 'ignored'

/** An edit that could not be applied, described for the review screen. */
export interface Orphan {
  id: string
  edit: RecipeEdit
  /** An ingredient edit, a step edit, or the link of an added ingredient to a step that is gone (Q3 (a)). */
  kind: 'ingredient' | 'step' | 'link'
  /** The name of the line it was made on (a link: the added ingredient). */
  label: string
  /** "1 tbsp", "Fresh ginger" or "Remove"; a step: the cook's text, in full. */
  yourChange: string
  /** What the imported recipe has at that position now (an amount, or a name), or null if nothing. */
  nowSays: string | null
  /** A step or a link: the step text the edit was made on, in full (B17); otherwise null. */
  importedText: string | null
}

export interface OverlayResult {
  /** The payload with the edits applied; `payload` itself when nothing applied. */
  payload: RecipePlanResponse
  statuses: Record<string, EditStatus>
  /** Ids of imported rows whose name or amount an edit changed (a removed row is not in it). */
  edited: ReadonlySet<string>
  /** Ids of rows the cook added (`ing_user_<edit id>`). */
  added: ReadonlySet<string>
  orphans: Orphan[]
  /** For each edited row, the row as imported, for the "Imported: ..." line. */
  importedRows: ReadonlyMap<string, Ingredient>
  /** A26: the rows the cook removed, with the id of the remove edit, so each can be restored. */
  removed: ReadonlyArray<{ editId: string; row: Ingredient }>
  /** R6b: ids of the nodes whose text an edit changed. */
  editedSteps: ReadonlySet<string>
  /** R6b: for each edited node, its instruction as imported, for the "Imported: ..." line. */
  importedSteps: ReadonlyMap<string, string>
  /** R6b: for each added row linked to a step that resolved, the id of that node (the picker's prefill). */
  linkedSteps: ReadonlyMap<string, string>
}

type Amount = { kind: 'number'; low: number; high?: number | null } | { kind: 'to_taste' }
interface Anchor {
  index: number
  expected: { name: string; qty_text: string | null; unit: string | null }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseAnchor(v: unknown): Anchor | null {
  if (!isObject(v) || !Number.isInteger(v.index) || (v.index as number) < 0 || !isObject(v.expected)) return null
  const e = v.expected
  if (typeof e.name !== 'string') return null
  if (e.qty_text != null && typeof e.qty_text !== 'string') return null
  if (e.unit != null && typeof e.unit !== 'string') return null
  return { index: v.index as number, expected: { name: e.name, qty_text: (e.qty_text as string | null) ?? null, unit: (e.unit as string | null) ?? null } }
}

function parseAmount(v: unknown): Amount | null {
  if (!isObject(v)) return null
  if (v.kind === 'to_taste') return { kind: 'to_taste' }
  if (v.kind === 'number' && typeof v.low === 'number' && v.low > 0) {
    if (v.high != null && (typeof v.high !== 'number' || v.high <= v.low)) return null
    return { kind: 'number', low: v.low, high: (v.high as number | null | undefined) ?? null }
  }
  return null
}

function parseStepAnchor(v: unknown): StepAnchor | null {
  if (!isObject(v) || !Number.isInteger(v.index) || (v.index as number) < 0 || !isObject(v.expected)) return null
  if (typeof v.expected.text !== 'string') return null
  return { index: v.index as number, expected: { text: v.expected.text } }
}

/** The longest step text an edit may carry, in code points (Pydantic counts the same way). */
export const STEP_TEXT_MAX = 1000

type Parsed =
  | { kind: 'name'; id: string; anchor: Anchor; name: string }
  | { kind: 'amount'; id: string; anchor: Anchor; amount: Amount; unit: string | null }
  | { kind: 'remove'; id: string; anchor: Anchor }
  | { kind: 'add'; id: string; name: string; amount: Amount | null; unit: string | null; step: StepAnchor | null }
  | { kind: 'step'; id: string; anchor: StepAnchor; text: string }

/** `null` for anything this version does not understand. */
function parseEdit(item: unknown): Parsed | null {
  if (!isObject(item) || typeof item.id !== 'string') return null
  const id = item.id
  switch (item.op) {
    case 'set_ingredient_name': {
      const anchor = parseAnchor(item.anchor)
      const name = isObject(item.value) && typeof item.value.name === 'string' ? item.value.name.trim() : ''
      return anchor && name ? { kind: 'name', id, anchor, name } : null
    }
    case 'set_ingredient_amount': {
      const anchor = parseAnchor(item.anchor)
      const value = isObject(item.value) ? item.value : null
      const amount = value ? parseAmount(value.amount) : null
      const unit = value && (value.unit == null || typeof value.unit === 'string') ? ((value.unit as string | null) ?? null) : undefined
      return anchor && amount && unit !== undefined ? { kind: 'amount', id, anchor, amount, unit } : null
    }
    case 'remove_ingredient': {
      const anchor = parseAnchor(item.anchor)
      return anchor ? { kind: 'remove', id, anchor } : null
    }
    case 'add_ingredient': {
      const value = isObject(item.value) ? item.value : null
      if (!value || typeof value.name !== 'string' || !value.name.trim()) return null
      const amount = value.amount == null ? null : parseAmount(value.amount)
      if (value.amount != null && amount == null) return null
      if (value.unit != null && typeof value.unit !== 'string') return null
      // A link that is not a valid anchor makes the whole add ignored, like a malformed amount: nothing is guessed.
      const step = value.step == null ? null : parseStepAnchor(value.step)
      if (value.step != null && step == null) return null
      return { kind: 'add', id, name: value.name.trim(), amount, unit: (value.unit as string | null) ?? null, step }
    }
    case 'set_step_text': {
      const anchor = parseStepAnchor(item.anchor)
      const text = isObject(item.value) && typeof item.value.text === 'string' ? item.value.text : null
      // Validated, never rewritten (B2): the stored text is applied byte for byte.
      if (!anchor || text == null) return null
      const length = [...text.trim()].length
      return length >= 1 && length <= STEP_TEXT_MAX ? { kind: 'step', id, anchor, text } : null
    }
    default:
      return null
  }
}

const matches = (row: Ingredient | undefined, a: Anchor): row is Ingredient =>
  row != null && row.name === a.expected.name && (row.qty_text ?? null) === a.expected.qty_text && (row.unit ?? null) === a.expected.unit

/** The line as the unedited row shows it at factor 1 (A16): the one function the row uses. */
export function importedLine(row: Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'>): string {
  return quantityTrailingScaled(row, 1).text ?? 'no amount'
}

function amountText(amount: Amount, unit: string | null): string {
  if (amount.kind === 'to_taste') return 'to taste'
  return joinQtyUnit(formatAmountRange(amount.low, amount.high), unit)
}

/** The fields an edited or added row gets from an amount and a unit. */
function amountFieldsOf(amount: Amount | null, unit: string | null): Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'> {
  if (amount == null) return { qty: null, qty_text: null, qty_amount: null, unit }
  if (amount.kind === 'to_taste') return { qty: null, qty_text: 'to taste', qty_amount: null, unit: null }
  return {
    qty: amount.low,
    qty_text: formatAmountRange(amount.low, amount.high),
    qty_amount: { low: amount.low, high: amount.high ?? null, prefix: '', rest: '' },
    unit,
  }
}

/** The generated "Wait before serving" node: ABC Cook's statement of a scheduled wait, never editable (Q2). */
export function isServingWaitNode(node: string | { id: string }): boolean {
  const id = typeof node === 'string' ? node : node.id
  return /^step_wait_before_serving(?:_\d+)?$/.test(id)
}

/** The anchor an edit on the step at `index` of the raw payload carries: the index and the text it reads now. */
export function stepAnchor(payload: RecipePlanResponse, index: number): StepAnchor {
  const node = (payload.graph.nodes as Node[])[index]
  if (!node) throw new Error(`no step at index ${index}`)
  return { index, expected: { text: node.instruction } }
}

/**
 * D2, which node a step anchor means now, or null (an orphan).
 * Candidates are the editable nodes whose text is exactly the anchor's: no trim, no case folding,
 * both sides come from the same server pipeline. One candidate is it, wherever it moved. Several
 * candidates (two steps that read the same): the one at the anchor's index if that is a candidate,
 * else none; there is no counting. With twins this can land on an identical-text sibling, never on
 * a step that reads differently (B9). The serving-wait node is never a candidate.
 */
export function resolveStep(nodes: ReadonlyArray<Pick<Node, 'id' | 'instruction'>>, anchor: StepAnchor): number | null {
  const candidates: number[] = []
  nodes.forEach((n, i) => {
    if (n.instruction === anchor.expected.text && !isServingWaitNode(n)) candidates.push(i)
  })
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  return candidates.includes(anchor.index) ? anchor.index : null
}

/**
 * `payload` with `edits` applied. Ingredient edits are applied against the imported rows by index,
 * so a remove never shifts another edit's anchor; step edits and links are resolved against the
 * imported nodes by text (`resolveStep`). See the module comment for the rules.
 */
export function applyEdits(payload: RecipePlanResponse, edits: readonly unknown[]): OverlayResult {
  const base = payload.graph.ingredients as Ingredient[]
  const baseNodes = payload.graph.nodes as Node[]
  const statuses: Record<string, EditStatus> = {}
  const edited = new Set<string>()
  const added = new Set<string>()
  const importedRows = new Map<string, Ingredient>()
  const orphans: Orphan[] = []
  const removed = new Set<number>()
  const removedRows: { editId: string; row: Ingredient }[] = []
  const patches = new Map<number, Partial<Ingredient>>()
  const adds: Ingredient[] = []
  const stepPatches = new Map<number, string>()
  const links: { nodeIndex: number; rowId: string }[] = []
  const editedSteps = new Set<string>()
  const importedSteps = new Map<string, string>()
  const linkedSteps = new Map<string, string>()

  edits.forEach((item, position) => {
    const key = isObject(item) && typeof item.id === 'string' ? item.id : `#${position}`
    const edit = parseEdit(item)
    if (!edit) {
      statuses[key] = 'ignored'
      return
    }
    if (edit.kind === 'add') {
      const id = `${ADDED_ID_PREFIX}${edit.id}`
      adds.push({
        id,
        name: edit.name,
        ...amountFieldsOf(edit.amount, edit.unit),
        prep_note: null,
        group: ADDED_GROUP,
        optional: false,
      })
      added.add(id)
      statuses[edit.id] = 'applied'
      if (edit.step) {
        const at = resolveStep(baseNodes, edit.step)
        if (at == null) {
          // Q3 (a): the add stays, unlinked, and the link is listed as its own orphan.
          orphans.push({
            id: edit.id,
            edit: item as RecipeEdit,
            kind: 'link',
            label: edit.name,
            yourChange: `was on "${edit.step.expected.text}"`,
            nowSays: null,
            importedText: edit.step.expected.text,
          })
        } else {
          links.push({ nodeIndex: at, rowId: id })
          linkedSteps.set(id, baseNodes[at].id)
        }
      }
      return
    }
    if (edit.kind === 'step') {
      const at = resolveStep(baseNodes, edit.anchor)
      if (at == null) {
        statuses[edit.id] = 'orphaned'
        orphans.push({
          id: edit.id,
          edit: item as RecipeEdit,
          kind: 'step',
          label: edit.anchor.expected.text,
          yourChange: edit.text,
          nowSays: null,
          importedText: edit.anchor.expected.text,
        })
        return
      }
      statuses[edit.id] = 'applied'
      stepPatches.set(at, edit.text)
      editedSteps.add(baseNodes[at].id)
      importedSteps.set(baseNodes[at].id, baseNodes[at].instruction)
      return
    }
    const row = base[edit.anchor.index]
    if (!matches(row, edit.anchor)) {
      statuses[edit.id] = 'orphaned'
      orphans.push(describeOrphan(item as RecipeEdit, edit, row))
      return
    }
    statuses[edit.id] = 'applied'
    importedRows.set(row.id, row)
    if (edit.kind === 'remove') {
      removed.add(edit.anchor.index)
      removedRows.push({ editId: edit.id, row })
      return
    }
    const patch = patches.get(edit.anchor.index) ?? {}
    if (edit.kind === 'name') patch.name = edit.name
    else Object.assign(patch, amountFieldsOf(edit.amount, edit.unit))
    patches.set(edit.anchor.index, patch)
  })

  if (patches.size === 0 && removed.size === 0 && adds.length === 0 && stepPatches.size === 0) {
    return { payload, statuses, edited, added, orphans, importedRows, removed: removedRows, editedSteps, importedSteps, linkedSteps }
  }

  const out = structuredClone(payload)
  const rows = out.graph.ingredients as Ingredient[]
  for (const [index, patch] of patches) {
    Object.assign(rows[index], patch)
    if (!removed.has(index)) edited.add(rows[index].id)
  }
  out.graph.ingredients = [...rows.filter((_, i) => !removed.has(i)), ...adds]
  for (const index of removed) importedRows.delete(base[index].id)
  for (const id of [...importedRows.keys()]) if (!edited.has(id)) importedRows.delete(id)
  const nodes = out.graph.nodes as Node[]
  for (const [index, text] of stepPatches) nodes[index].instruction = text
  for (const { nodeIndex, rowId } of links) nodes[nodeIndex].consumes = [...(nodes[nodeIndex].consumes ?? []), rowId]
  return { payload: out, statuses, edited, added, orphans, importedRows, removed: removedRows, editedSteps, importedSteps, linkedSteps }
}

function describeOrphan(item: RecipeEdit, edit: Exclude<Parsed, { kind: 'add' } | { kind: 'step' }>, row: Ingredient | undefined): Orphan {
  const label = edit.anchor.expected.name
  const orphan = { id: edit.id, edit: item, kind: 'ingredient' as const, label, importedText: null }
  if (edit.kind === 'name') return { ...orphan, yourChange: edit.name, nowSays: row ? row.name : null }
  if (edit.kind === 'remove') return { ...orphan, yourChange: 'Remove', nowSays: row ? row.name : null }
  return { ...orphan, yourChange: amountText(edit.amount, edit.unit), nowSays: row ? importedLine(row) : null }
}

/** The anchor an edit on imported row `index` carries: the index and the line as it reads now. */
export function ingredientAnchor(payload: RecipePlanResponse, index: number): Anchor {
  const row = (payload.graph.ingredients as Ingredient[])[index]
  if (!row) throw new Error(`no ingredient at index ${index}`)
  return { index, expected: { name: row.name, qty_text: row.qty_text ?? null, unit: row.unit ?? null } }
}

type Loose = { id?: unknown; op?: unknown; anchor?: unknown; value?: unknown }
const asLoose = (e: unknown): Loose => (isObject(e) ? (e as Loose) : {})
const anchorIndex = (e: unknown): number | null => {
  const a = asLoose(e).anchor
  return isObject(a) && Number.isInteger(a.index) ? (a.index as number) : null
}
const ROW_OPS = new Set(['set_ingredient_name', 'set_ingredient_amount', 'remove_ingredient'])

/**
 * `edit` into `edits`. A new edit of the same op on the same row replaces the old one in place
 * (one edit per target); an add replaces the add with the same id. A remove also clears every
 * other edit on that row. Everything else is appended. The input is not modified.
 */
export function upsertEdit(edits: readonly RecipeEdit[], edit: RecipeEdit): RecipeEdit[] {
  const next = [...edits]
  const op = asLoose(edit).op
  if (op === 'add_ingredient') {
    const i = next.findIndex((e) => asLoose(e).op === 'add_ingredient' && asLoose(e).id === edit.id)
    if (i >= 0) next[i] = edit
    else next.push(edit)
    return next
  }
  const index = anchorIndex(edit)
  if (index == null) return [...next, edit]
  if (op === 'remove_ingredient') {
    const kept = next.filter((e) => !(ROW_OPS.has(String(asLoose(e).op)) && anchorIndex(e) === index))
    return [...kept, edit]
  }
  const i = next.findIndex((e) => asLoose(e).op === op && anchorIndex(e) === index)
  if (i >= 0) next[i] = edit
  else next.push(edit)
  return next
}

/** Deletes the edit with `id`: "Restore original" for one edit, or the undo of a remove. */
export function restoreEdit(edits: readonly RecipeEdit[], id: string): RecipeEdit[] {
  return edits.filter((e) => asLoose(e).id !== id)
}

/** Deletes an orphan the cook chose to discard. */
export function discardEdit(edits: readonly RecipeEdit[], id: string): RecipeEdit[] {
  return restoreEdit(edits, id)
}

/** "Remove the link" on a link orphan: rewrites the add with no step. The ingredient itself stays (Q3). */
export function unlinkAdd(edits: readonly RecipeEdit[], addEditId: string): RecipeEdit[] {
  return edits.map((e) => {
    const loose = asLoose(e)
    if (loose.op !== 'add_ingredient' || loose.id !== addEditId || !isObject(loose.value)) return e
    return { ...e, value: { ...loose.value, step: null } } as RecipeEdit
  })
}

/**
 * The id of the add edit behind added row `rowId`, or null when `rowId` is an imported row. Decided by
 * membership in `edits`, not by the prefix: an imported id can start `ing_user_` ("User's choice
 * greens" slugs to `ing_user_s_choice`), and a prefix test sent such a row down the added-row path,
 * where Save and Remove found no add and silently did nothing (Q10).
 */
const addedEditId = (edits: readonly RecipeEdit[], rowId: string): string | null => {
  if (!rowId.startsWith(ADDED_ID_PREFIX)) return null
  const id = rowId.slice(ADDED_ID_PREFIX.length)
  return edits.some((e) => asLoose(e).op === 'add_ingredient' && asLoose(e).id === id) ? id : null
}

/** Deletes every edit on imported row `rowId` (its name, its amount, a removal). An added row has none. */
export function restoreRow(edits: readonly RecipeEdit[], payload: RecipePlanResponse, rowId: string): RecipeEdit[] {
  const index = (payload.graph.ingredients as Ingredient[]).findIndex((r) => r.id === rowId)
  if (index < 0) return [...edits]
  return edits.filter((e) => !(ROW_OPS.has(String(asLoose(e).op)) && anchorIndex(e) === index))
}

/** Removes a row: an imported row by a `remove_ingredient`, an added row by deleting its add. */
export function removeRow(
  edits: readonly RecipeEdit[],
  payload: RecipePlanResponse,
  rowId: string,
  meta: { id: string; now: string },
): RecipeEdit[] {
  const addId = addedEditId(edits, rowId)
  if (addId != null) return edits.filter((e) => !(asLoose(e).op === 'add_ingredient' && asLoose(e).id === addId))
  const index = (payload.graph.ingredients as Ingredient[]).findIndex((r) => r.id === rowId)
  if (index < 0) return [...edits]
  return upsertEdit(edits, { id: meta.id, created_at: meta.now, op: 'remove_ingredient', anchor: ingredientAnchor(payload, index) } as RecipeEdit)
}

/** How many steps list ingredient `ingredientId` in their `consumes` (the remove warning's N). */
export function stepUsage(payload: RecipePlanResponse, ingredientId: string): number {
  return payload.graph.nodes.filter((n) => (n.consumes ?? []).includes(ingredientId)).length
}

/** A saved recipe's edits applied to its stored payload. */
export function overlayForRecipe(recipe: Pick<SavedRecipe, 'payload' | 'edits'>): OverlayResult {
  return applyEdits(recipe.payload, recipe.edits ?? [])
}

/**
 * The two payloads a recipe page needs: `raw`, the one to save and to send (it is what
 * `origin.payload` holds), and `payload`, the overlaid one every renderer reads. They are
 * different objects whenever an edit applied, so nothing can write an edited value back.
 */
export function viewParts(
  raw: RecipePlanResponse,
  edits: readonly unknown[],
): { payload: RecipePlanResponse; raw: RecipePlanResponse; overlay: OverlayResult } {
  const overlay = applyEdits(raw, edits)
  return { payload: overlay.payload, raw, overlay }
}

/** A fresh id for an edit. */
export function newEditId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `edit_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

/** A22: the line on the recipe page when some edits could not be applied, or null when none. */
export function orphanNoticeLine(count: number): string | null {
  if (count <= 0) return null
  return count === 1 ? "1 of your changes couldn't be applied." : `${count} of your changes couldn't be applied.`
}

/** R6b D5: the review's honest lines for a step and for a link, and the link's button. A step keeps "Discard this change". */
export const ORPHAN_COPY = {
  step: 'This step changed in the imported recipe, or is gone.',
  link: 'The step it was on changed in the imported recipe, or is gone. The ingredient stays.',
  discard: 'Discard this change',
  removeLink: 'Remove the link',
} as const

/** A22/A30: the review's second line for an orphan: what the imported recipe has there now. */
export function orphanNowLine(nowSays: string | null): string {
  return nowSays == null ? 'The imported recipe no longer has this ingredient.' : `The imported recipe now says: ${nowSays}`
}
