import type { Ingredient, RecipeEdit, RecipePlanResponse } from '@abc-cook/schema'

import { formatAmount, snapAmount } from '@/lib/scaleQuantity'
import { choiceFactor, type ServingsChoice } from '@/lib/servings'

import { importedLine, ingredientAnchor, upsertEdit, type OverlayResult } from './recipeEdits'
import { EDITS_WRITE_FAILED } from './store'

/**
 * R6a: the ingredient editor as a pure state machine, so the rules the cook feels (what a
 * fraction button does, when an edit is written, when a tap is blocked) run under Vitest with
 * no DOM. The React layer (`plan/EditableIngredients.tsx`) only draws a `FieldState` and
 * forwards what the cook does to these functions.
 *
 * Amounts are always edited as written (A1): every field here is the stored, unscaled value,
 * whatever servings the page shows.
 */

export const EDITOR_COPY = {
  amountError: 'Enter an amount above 0.',
  rangeError: 'The second number must be bigger.',
  nameError: 'Enter a name.',
  nameTooLong: 'Keep the name to 80 characters.',
  writeFailed: EDITS_WRITE_FAILED,
} as const

const NAME_MAX = 80
const NO_UNIT_LABEL = 'No unit'

/** The unit chips, after the imported unit and before "No unit" (A15). */
export const UNIT_LIST = ['tsp', 'tbsp', 'cup', 'g', 'ml', 'pinch', 'piece', 'inch', 'clove'] as const

export interface EditContext {
  /** The imported (raw) payload: the anchors are positions in it. */
  payload: RecipePlanResponse
  /** The stored edits. */
  edits: RecipeEdit[]
  /** `applyEdits(payload, edits)`, for the rows as they read now. */
  overlay: OverlayResult
}

export type FieldErrors = { name?: string; amount?: string; range?: string }

export interface FieldState {
  target: { kind: 'row'; id: string } | { kind: 'add' }
  name: string
  mode: 'number' | 'taste'
  /** What the cook sees in the amount field ("1½"); parsed on commit. */
  amount: string
  rangeOpen: boolean
  range: string
  /** The unit as it will be written; null is "No unit". */
  unit: string | null
  /** The unit the recipe was imported with, which the picker shows first (A15). */
  importedUnit: string | null
  errors: FieldErrors
  /** A snapshot of the editable fields when the editor opened, to tell if the cook changed any. */
  initial: string
}

type Editable = Pick<FieldState, 'name' | 'mode' | 'amount' | 'rangeOpen' | 'range' | 'unit'>
const snapshot = (f: Editable): string => JSON.stringify([f.name, f.mode, f.amount, f.rangeOpen, f.range, f.unit])

export function isDirty(f: FieldState): boolean {
  return snapshot(f) !== f.initial
}

// ---- amounts -------------------------------------------------------------------------

const VULGAR: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
const GLYPHS = Object.keys(VULGAR).join('')

/** "1½", "½", "1 1/2", "1/2", "0.5", "1,5" and "12" as a number; `null` for anything else. */
export function parseAmountText(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  let m = new RegExp(`^(\\d+)?\\s*([${GLYPHS}])$`).exec(t)
  if (m) return (m[1] ? Number(m[1]) : 0) + VULGAR[m[2]]
  m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t)
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3])
  m = /^(\d+)\/(\d+)$/.exec(t)
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2])
  if (/^\d*[.,]\d+$/.test(t) || /^\d+$/.test(t)) return Number(t.replace(',', '.'))
  return null
}

/** A fraction button sets the fractional part: it replaces one already there, never adds to it. */
export function pressFraction(text: string, glyph: string): string {
  const whole = /^\s*(\d+)/.exec(text)
  const n = whole ? Number(whole[1]) : 0
  return `${n > 0 ? n : ''}${glyph}`
}

/** The amount fields a row opens with (A23). A line the parser could not read opens empty. */
export function amountFields(
  row: Pick<Ingredient, 'qty_text' | 'qty_amount' | 'unit'> & { qty?: number | null },
): Pick<FieldState, 'mode' | 'amount' | 'rangeOpen' | 'range' | 'unit'> {
  const unit = (row.unit ?? '').trim().toLowerCase()
  const text = (row.qty_text ?? '').trim().toLowerCase()
  if (unit === 'to taste' || (unit === '' && text === 'to taste')) {
    return { mode: 'taste', amount: '', rangeOpen: false, range: '', unit: null }
  }
  const qa = row.qty_amount
  const restUnit = qa?.rest?.trim() ? qa.rest.trim() : null
  const shownUnit = row.unit ?? restUnit
  if (!qa) return { mode: 'number', amount: '', rangeOpen: false, range: '', unit: shownUnit }
  const ranged = qa.high != null
  return {
    mode: 'number',
    amount: formatAmount(qa.low),
    rangeOpen: ranged,
    range: ranged ? formatAmount(qa.high as number) : '',
    unit: shownUnit,
  }
}

/** The unit picker (A15): the imported unit verbatim first, then the closed list, then No unit. */
export function unitChoices(imported: string | null): { chips: string[]; selected: string | null; toTaste: boolean } {
  const trimmed = (imported ?? '').trim()
  const tail = [...UNIT_LIST, NO_UNIT_LABEL]
  if (trimmed.toLowerCase() === 'to taste') return { chips: tail, selected: null, toTaste: true }
  if (trimmed === '') return { chips: tail, selected: null, toTaste: false }
  const hit = UNIT_LIST.find((u) => u === trimmed.toLowerCase())
  if (hit) return { chips: tail, selected: hit, toTaste: false }
  return { chips: [trimmed, ...tail], selected: trimmed, toTaste: false }
}

/** Whether a chip is the selected unit; a unit matching a list item in another case counts. */
export function unitSelected(unit: string | null, chip: string): boolean {
  if (chip === NO_UNIT_LABEL) return unit == null
  return unit != null && unit.trim().toLowerCase() === chip.toLowerCase()
}

export const NO_UNIT_CHIP = NO_UNIT_LABEL

/** A5, A27: the remove warning, only when a step lists the ingredient. */
export function removeWarning(n: number): string | null {
  if (n <= 0) return null
  if (n === 1) return "Used in 1 step. It comes off that step's ingredient list; the step text stays as written."
  return `Used in ${n} steps. It comes off their ingredient lists; the step text stays as written.`
}

/**
 * The "Imported: ..." lines for a row (A16, A33): the imported name and amount, each only when
 * it is worth showing. An edited row shows what an edit changed. An unedited row shows its
 * amount when the field opens empty, so the cook can see what the recipe said: a line the parser
 * could not scale (no `qty_amount`) has nothing to prefill.
 */
export function importedLines(imported: Ingredient | null, row: Ingredient): { name: string | null; line: string | null } | null {
  if (imported) {
    const name = imported.name !== row.name ? imported.name : null
    const line = importedLine(imported) !== importedLine(row) ? importedLine(imported) : null
    return name != null || line != null ? { name, line } : null
  }
  const fields = amountFields(row)
  const hasAmount = row.qty_text != null || row.qty != null || row.unit != null
  if (fields.mode === 'number' && fields.amount === '' && hasAmount) return { name: null, line: importedLine(row) }
  return null
}

/** A1: the line shown while the page is at a size other than as written. */
export function asWrittenLine(choice: ServingsChoice | null | undefined): string | null {
  if (choice == null || choiceFactor(choice) === 1) return null
  if (choice.mode === 'batch') return 'Amounts here are as written.'
  return `Amounts here are as written, for ${choice.original} ${choice.original === 1 ? 'serving' : 'servings'}.`
}

// ---- opening ---------------------------------------------------------------------------

const rowsOf = (payload: RecipePlanResponse): Ingredient[] => payload.graph.ingredients as Ingredient[]

function withInitial(f: Omit<FieldState, 'initial'>): FieldState {
  return { ...f, initial: snapshot(f) }
}

/** The editor for row `rowId` as it reads now. Throws on an id the overlay does not have. */
export function openRow(ctx: EditContext, rowId: string): FieldState {
  const row = rowsOf(ctx.overlay.payload).find((r) => r.id === rowId)
  if (!row) throw new Error(`no ingredient row ${rowId}`)
  const imported = ctx.overlay.importedRows.get(rowId) ?? row
  return withInitial({
    target: { kind: 'row', id: rowId },
    name: row.name,
    ...amountFields(row),
    importedUnit: amountFields(imported).unit,
    errors: {},
  })
}

/** The inline Add form: empty, no unit chosen. */
export function openAdd(): FieldState {
  return withInitial({
    target: { kind: 'add' },
    name: '',
    mode: 'number',
    amount: '',
    rangeOpen: false,
    range: '',
    unit: null,
    importedUnit: null,
    errors: {},
  })
}

// ---- validating and committing -----------------------------------------------------------

export function validateFields(f: Editable): FieldErrors {
  const errors: FieldErrors = {}
  const name = f.name.trim()
  if (name === '') errors.name = EDITOR_COPY.nameError
  else if (name.length > NAME_MAX) errors.name = EDITOR_COPY.nameTooLong
  if (f.mode === 'number') {
    const typed = f.amount.trim() !== ''
    const low = typed ? parseAmountText(f.amount) : null
    if (typed && (low == null || snapAmount(low) <= 0)) errors.amount = EDITOR_COPY.amountError
    else if (f.rangeOpen && low != null) {
      const high = parseAmountText(f.range)
      if (high == null || snapAmount(high) <= snapAmount(low)) errors.range = EDITOR_COPY.rangeError
    }
  }
  return errors
}

type AmountValue = { kind: 'number'; low: number; high: number | null } | { kind: 'to_taste' }

/** The amount the fields describe, or `null` when the amount field is empty. Assumes they validate. */
function desiredAmount(f: Editable): AmountValue | null {
  if (f.mode === 'taste') return { kind: 'to_taste' }
  if (f.amount.trim() === '') return null
  const low = snapAmount(parseAmountText(f.amount) as number)
  const high = f.rangeOpen ? snapAmount(parseAmountText(f.range) as number) : null
  return { kind: 'number', low, high }
}

const sameAmount = (a: AmountValue | null, b: AmountValue | null): boolean => {
  if (a == null || b == null) return a === b
  if (a.kind === 'to_taste' || b.kind === 'to_taste') return a.kind === b.kind
  return a.low === b.low && a.high === b.high
}

export type CommitResult = { ok: true; edits: RecipeEdit[] } | { ok: false; errors: FieldErrors }
export interface CommitDeps {
  now: string
  newId: () => string
}

const isAdded = (id: string): boolean => id.startsWith('ing_user_')

/**
 * The edits array after the cook commits `f`: `ctx.edits` itself when nothing changed, or the
 * new array (one edit per target, the same-op edit replaced in place). Invalid fields give the
 * inline errors and no edits.
 */
export function commitFields(ctx: EditContext, f: FieldState, deps: CommitDeps): CommitResult {
  const errors = validateFields(f)
  // A unit chosen for a line that has no amount has nothing to attach to.
  const unitMoved = f.unit !== amountFieldsOfInitial(f).unit
  if (f.mode === 'number' && f.amount.trim() === '' && unitMoved && f.target.kind === 'row' && !isAdded(f.target.id)) {
    errors.amount = errors.amount ?? EDITOR_COPY.amountError
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  if (f.target.kind === 'add') return { ok: true, edits: upsertEdit(ctx.edits, addEdit(f, deps, null)) }
  const rowId = f.target.id
  if (isAdded(rowId)) return { ok: true, edits: rewriteAdded(ctx, f, rowId) }

  const base = rowsOf(ctx.payload)
  const index = base.findIndex((r) => r.id === rowId)
  if (index < 0) return { ok: true, edits: ctx.edits }
  const imported = base[index]
  const anchor = ingredientAnchor(ctx.payload, index)
  const was = JSON.parse(f.initial) as [string, string, string, boolean, string, string | null]
  let edits = ctx.edits

  // name
  const name = f.name.trim()
  if (name !== was[0].trim()) {
    edits = dropOp(edits, 'set_ingredient_name', index)
    if (name !== imported.name) {
      edits = upsertEdit(edits, { id: deps.newId(), created_at: deps.now, op: 'set_ingredient_name', anchor, value: { name } } as RecipeEdit)
    }
  }

  // amount and unit
  const touched = f.mode !== was[1] || f.amount !== was[2] || f.rangeOpen !== was[3] || f.range !== was[4] || f.unit !== was[5]
  if (touched) {
    const desired = desiredAmount(f)
    if (desired != null) {
      const importedFields = amountFields(imported)
      const importedAmount = desiredAmount({ ...importedFields, name: imported.name })
      const unit = desired.kind === 'to_taste' ? null : f.unit
      const equalToImported = sameAmount(desired, importedAmount) && (desired.kind === 'to_taste' || unit === importedFields.unit)
      edits = dropOp(edits, 'set_ingredient_amount', index)
      if (!equalToImported) {
        edits = upsertEdit(edits, {
          id: deps.newId(),
          created_at: deps.now,
          op: 'set_ingredient_amount',
          anchor,
          value: { amount: desired, unit },
        } as RecipeEdit)
      }
    }
  }
  return { ok: true, edits: sameEdits(edits, ctx.edits) ? ctx.edits : edits }
}

function amountFieldsOfInitial(f: FieldState): { unit: string | null } {
  const was = JSON.parse(f.initial) as [string, string, string, boolean, string, string | null]
  return { unit: was[5] }
}

type Loose = { op?: unknown; anchor?: { index?: unknown } }
function dropOp(edits: RecipeEdit[], op: string, index: number): RecipeEdit[] {
  return edits.filter((e) => !((e as Loose).op === op && (e as Loose).anchor?.index === index))
}

const sameEdits = (a: RecipeEdit[], b: RecipeEdit[]): boolean => a.length === b.length && JSON.stringify(a) === JSON.stringify(b)

function addValueOf(f: FieldState, step: unknown): { name: string; amount: AmountValue | null; unit: string | null; step: unknown } {
  const amount = desiredAmount(f)
  return { name: f.name.trim(), amount, unit: amount?.kind === 'to_taste' ? null : f.unit, step }
}

function addEdit(f: FieldState, deps: CommitDeps, keep: { id: string; created_at: string; step: unknown } | null): RecipeEdit {
  return {
    id: keep?.id ?? deps.newId(),
    created_at: keep?.created_at ?? deps.now,
    op: 'add_ingredient',
    value: addValueOf(f, keep?.step ?? null),
  } as RecipeEdit
}

/** An added row is edited by rewriting its add edit, in place, keeping its id. */
function rewriteAdded(ctx: EditContext, f: FieldState, rowId: string): RecipeEdit[] {
  const editId = rowId.slice('ing_user_'.length)
  const at = ctx.edits.findIndex((e) => (e as { op?: unknown; id?: unknown }).op === 'add_ingredient' && (e as { id?: unknown }).id === editId)
  if (at < 0) return ctx.edits
  const old = ctx.edits[at] as unknown as { id: string; created_at: string; value: { step?: unknown } }
  const next = [...ctx.edits]
  next[at] = addEdit(f, { now: old.created_at, newId: () => old.id }, { id: old.id, created_at: old.created_at, step: old.value?.step ?? null })
  return sameEdits(next, ctx.edits) ? ctx.edits : next
}

// ---- the session: what a tap away does ---------------------------------------------------

export interface EditSession {
  mode: 'view' | 'edit'
  /** The open ingredient row. At most one of `open` and `add` is set. */
  open: FieldState | null
  add: FieldState | null
  /** Set when the last write failed (A8). The editor stays open with its input. */
  writeError: string | null
}

export type LeaveKind = 'done' | 'tab' | 'start' | 'back' | 'row'

export function startEditing(): EditSession {
  return { mode: 'edit', open: null, add: null, writeError: null }
}

/** A4: tapping an "Edited" tag enters edit mode with that row open. */
export function startEditingAt(ctx: EditContext, rowId: string): EditSession {
  return { ...startEditing(), open: openRow(ctx, rowId) }
}

/** Opens the Add form at the end of the list, closing any open row. */
export function openAddForm(session: EditSession): EditSession {
  return { ...session, open: null, add: openAdd(), writeError: null }
}

type Patch = Partial<Pick<FieldState, 'name' | 'mode' | 'amount' | 'rangeOpen' | 'range' | 'unit'>>

/** The fields with `patch` applied. The inline errors clear as soon as the cook types. */
export function editField(f: FieldState, patch: Patch): FieldState
export function editField(session: EditSession, patch: Patch): EditSession
export function editField(target: FieldState | EditSession, patch: Patch): FieldState | EditSession {
  if ('target' in target) return { ...target, ...patch, errors: {} }
  const key = target.open ? 'open' : 'add'
  const field = target[key]
  if (!field) return target
  return { ...target, [key]: { ...field, ...patch, errors: {} }, writeError: null }
}

export interface LeaveResult {
  proceed: boolean
  session: EditSession
  /** The edits that were written, when something was. */
  edits?: RecipeEdit[]
}

export type WriteEdits = (edits: RecipeEdit[]) => { ok: boolean }

/**
 * A24: the cook leaves the editor by Done, a tab, Start cooking, going back, or opening another
 * row. Nothing typed is lost silently: a changed, valid field is committed (through `write`) and
 * the cook goes on; invalid input stays open with its inline error and the cook does not; a
 * failed write keeps the row open with its input and the A8 message.
 */
export function leave(session: EditSession, kind: LeaveKind, ctx: EditContext, write: WriteEdits, deps: CommitDeps): LeaveResult {
  const closed: EditSession = kind === 'row' ? { ...session, open: null, add: null, writeError: null } : { mode: 'view', open: null, add: null, writeError: null }
  const key = session.open ? 'open' : session.add ? 'add' : null
  const field = key ? session[key] : null
  if (!key || !field || !isDirty(field)) return { proceed: true, session: closed }

  const res = commitFields(ctx, field, deps)
  if (!res.ok) return { proceed: false, session: { ...session, [key]: { ...field, errors: res.errors }, writeError: null } }
  if (res.edits === ctx.edits) return { proceed: true, session: closed }
  if (!write(res.edits).ok) return { proceed: false, session: { ...session, writeError: EDITOR_COPY.writeFailed } }
  return { proceed: true, session: closed, edits: res.edits }
}
