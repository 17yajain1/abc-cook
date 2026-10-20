import { describe, expect, it, vi } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { choiceFactor, type ServingsChoice } from '@/lib/servings'
import { quantityTrailingScaled } from '@/lib/quantity'

import {
  amountFields,
  asWrittenLine,
  commitFields,
  editField,
  EDITOR_COPY,
  importedLines,
  isDirty,
  leave,
  openAdd,
  openAddForm,
  openRow,
  parseAmountText,
  pressFraction,
  removeWarning,
  startEditing,
  startEditingAt,
  unitChoices,
  validateFields,
  type EditContext,
} from './ingredientEditor'
import { applyEdits, ingredientAnchor, type RecipeEdit } from './recipeEdits'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
type Row = RecipePlanResponse['graph']['ingredients'][number]
const rows = (p: RecipePlanResponse): Row[] => p.graph.ingredients as Row[]
const AT = '2026-10-20T08:00:00.000Z'
const deps = { now: AT, newId: () => 'n1' }

/** The `value` of an edit, for the ops that have one. */
const valueOf = (e: RecipeEdit): unknown => (e as unknown as { value: unknown }).value

function ctxFor(payload: RecipePlanResponse, edits: RecipeEdit[] = []): EditContext {
  return { payload, edits, overlay: applyEdits(payload, edits) }
}

const BESAN = 1 // kadhi-pakora: "Besan (gram flour)", qty_text "4", unit "tbsp", with qty_amount
const idOf = (p: RecipePlanResponse, index: number) => rows(p)[index].id

describe('pressFraction (A23): a fraction button sets the fractional part', () => {
  it.each([
    ['', '½', '½'],
    ['1', '½', '1½'],
    ['1½', '¼', '1¼'],
    ['½', '¾', '¾'],
    ['2', '⅓', '2⅓'],
    ['1.5', '¼', '1¼'],
    ['0', '½', '½'],
    ['12', '¾', '12¾'],
  ])('%j + %s -> %s', (text, fraction, out) => {
    expect(pressFraction(text, fraction)).toBe(out)
  })

  it('replaces, never adds', () => {
    expect(pressFraction(pressFraction('1', '½'), '½')).toBe('1½')
  })
})

describe('parseAmountText', () => {
  it.each([
    ['1½', 1.5],
    ['½', 0.5],
    ['1 1/2', 1.5],
    ['1/2', 0.5],
    ['0.5', 0.5],
    ['1.5', 1.5],
    ['1,5', 1.5],
    ['12', 12],
    [' 3 ', 3],
    ['⅓', 1 / 3],
  ])('%j -> %s', (text, value) => {
    expect(parseAmountText(text)).toBeCloseTo(value, 10)
  })

  it.each(['', '  ', 'abc', '1..5', '1/0', '1-2'])('%j is not an amount', (text) => {
    expect(parseAmountText(text)).toBeNull()
  })
})

describe('amountFields: the prefill (A23)', () => {
  const base: Row = {
    id: 'ing_x', name: 'X', qty: 1.5, qty_text: '1 1/2', unit: 'cup', prep_note: null, group: null,
    qty_amount: { low: 1.5, high: null, prefix: '', rest: '' },
  } as Row

  it('prefills a line with qty_amount, formatted: "1½", never the raw "1 1/2"', () => {
    const f = amountFields(base)
    expect(f.amount).toBe('1½')
    expect(f.mode).toBe('number')
    expect(f.rangeOpen).toBe(false)
  })

  it('opens a line without qty_amount with an empty field', () => {
    const f = amountFields({ ...base, qty_amount: null, qty_text: '2 cups plus a bit', qty: null })
    expect(f.amount).toBe('')
  })

  it('prefills a range into both fields and opens the range', () => {
    const f = amountFields({ ...base, qty_amount: { low: 1, high: 1.5, prefix: '', rest: '' } } as Row)
    expect(f.amount).toBe('1')
    expect(f.rangeOpen).toBe(true)
    expect(f.range).toBe('1½')
  })

  it('takes the unit from the row, verbatim', () => {
    expect(amountFields({ ...base, unit: 'teaspoon' }).unit).toBe('teaspoon')
    expect(amountFields({ ...base, unit: 'cup (125 g)' }).unit).toBe('cup (125 g)')
    expect(amountFields({ ...base, unit: null }).unit).toBeNull()
  })

  it('reads the unit from `rest` when the row has none, so the picker matches what the row renders', () => {
    const f = amountFields({ ...base, unit: null, qty_amount: { low: 1, high: null, prefix: '', rest: ' cup' } } as Row)
    expect(f.unit).toBe('cup')
  })

  it('maps an imported unit of "to taste", in any case, to the To taste mode', () => {
    expect(amountFields({ ...base, qty: null, qty_text: null, qty_amount: null, unit: 'to taste' }).mode).toBe('taste')
    expect(amountFields({ ...base, qty: null, qty_text: null, qty_amount: null, unit: 'To Taste' }).mode).toBe('taste')
  })

  it('maps an amount text of "to taste" with no unit to the To taste mode as well', () => {
    expect(amountFields({ ...base, qty: null, qty_text: 'to taste', qty_amount: null, unit: null }).mode).toBe('taste')
  })

  it('prefills a real fixture line: kadhi Besan opens as "4" tbsp', () => {
    const p = byName('kadhi-pakora')
    const f = amountFields(rows(p)[BESAN])
    expect(f.amount).toBe('4')
    expect(f.unit).toBe('tbsp')
  })

  it('opens a fixture line with a qty but no qty_amount empty, showing the original beside it', () => {
    const p = byName('sabudana-khichdi')
    const row = rows(p)[0]
    expect(amountFields(row).amount).toBe('')
  })
})

describe('unitChoices (A15)', () => {
  const LIST = ['tsp', 'tbsp', 'cup', 'g', 'ml', 'pinch', 'piece', 'inch', 'clove']

  it('puts an imported unit outside the list first, verbatim, then the list, then No unit', () => {
    expect(unitChoices('teaspoon').chips).toEqual(['teaspoon', ...LIST, 'No unit'])
    expect(unitChoices('cup (125 g)').chips[0]).toBe('cup (125 g)')
    expect(unitChoices('oz can').chips[0]).toBe('oz can')
  })

  it('shows a unit once when it matches a list item case-insensitively', () => {
    const c = unitChoices('Tbsp')
    expect(c.chips).toEqual([...LIST, 'No unit'])
    expect(c.selected).toBe('tbsp')
  })

  it('selects the imported unit, or No unit when there is none', () => {
    expect(unitChoices('teaspoon').selected).toBe('teaspoon')
    expect(unitChoices(null).selected).toBeNull()
  })

  it('does not offer "to taste" as a chip', () => {
    expect(unitChoices('to taste').chips).toEqual([...LIST, 'No unit'])
    expect(unitChoices('to taste').toTaste).toBe(true)
  })
})

describe('asWrittenLine (A1)', () => {
  it('names the servings the recipe was written for', () => {
    const c: ServingsChoice = { mode: 'servings', chosen: 6, original: 4 }
    expect(asWrittenLine(c)).toBe('Amounts here are as written, for 4 servings.')
  })

  it('has a batch variant that names no headcount', () => {
    expect(asWrittenLine({ mode: 'batch', multiplier: 1.5 })).toBe('Amounts here are as written.')
  })

  it('shows nothing at the recipe as written, or with no choice', () => {
    expect(asWrittenLine({ mode: 'servings', chosen: 4, original: 4 })).toBeNull()
    expect(asWrittenLine({ mode: 'batch', multiplier: 1 })).toBeNull()
    expect(asWrittenLine(null)).toBeNull()
  })
})

describe('validateFields', () => {
  const p = byName('kadhi-pakora')
  const open = () => openRow(ctxFor(p), idOf(p, BESAN))

  it('accepts a good amount', () => {
    expect(validateFields(editField(open(), { amount: '1' }))).toEqual({})
  })

  it('rejects an amount of 0, a negative one and a non-number with the approved copy', () => {
    for (const bad of ['0', '-1', 'abc']) {
      expect(validateFields(editField(open(), { amount: bad })).amount).toBe('Enter an amount above 0.')
    }
    expect(EDITOR_COPY.amountError).toBe('Enter an amount above 0.')
  })

  it('rejects a range whose second number is not bigger', () => {
    const f = editField(open(), { amount: '1', rangeOpen: true, range: '1' })
    expect(validateFields(f).range).toBe('The second number must be bigger.')
    expect(validateFields(editField(f, { range: '½' })).range).toBe('The second number must be bigger.')
    expect(validateFields(editField(f, { range: '' })).range).toBe('The second number must be bigger.')
    expect(validateFields(editField(f, { range: '2' })).range).toBeUndefined()
    expect(EDITOR_COPY.rangeError).toBe('The second number must be bigger.')
  })

  it('rejects an empty or over-long name', () => {
    expect(validateFields(editField(open(), { name: '   ' })).name).toBe(EDITOR_COPY.nameError)
    expect(validateFields(editField(open(), { name: 'x'.repeat(81) })).name).toBe(EDITOR_COPY.nameTooLong)
    expect(validateFields(editField(open(), { name: 'x'.repeat(80) })).name).toBeUndefined()
  })

  it('does not ask for an amount in To taste mode', () => {
    expect(validateFields(editField(open(), { mode: 'taste', amount: '' }))).toEqual({})
  })
})

describe('commitFields: rows', () => {
  const p = byName('kadhi-pakora')

  it('writes a set_ingredient_amount anchored on the imported row', () => {
    const f = editField(openRow(ctxFor(p), idOf(p, BESAN)), { amount: '1' })
    const res = commitFields(ctxFor(p), f, deps)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.edits).toEqual([
      {
        id: 'n1',
        created_at: AT,
        op: 'set_ingredient_amount',
        anchor: ingredientAnchor(p, BESAN),
        value: { amount: { kind: 'number', low: 1, high: null }, unit: 'tbsp' },
      },
    ])
  })

  it('writes nothing for an untouched row, and says it is not dirty', () => {
    const f = openRow(ctxFor(p), idOf(p, BESAN))
    expect(isDirty(f)).toBe(false)
    const res = commitFields(ctxFor(p), f, deps)
    expect(res.ok && res.edits).toEqual([])
  })

  it('writes nothing when the amount is typed back to what was imported', () => {
    const f = editField(openRow(ctxFor(p), idOf(p, BESAN)), { amount: '4' })
    const res = commitFields(ctxFor(p), f, deps)
    expect(res.ok && res.edits).toEqual([])
  })

  it('drops an existing edit when the cook sets the value back to the imported one', () => {
    const first = commitFields(ctxFor(p), editField(openRow(ctxFor(p), idOf(p, BESAN)), { amount: '1' }), deps)
    if (!first.ok) throw new Error('setup')
    const ctx = ctxFor(p, first.edits)
    const second = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '4' }), { now: AT, newId: () => 'n2' })
    expect(second.ok && second.edits).toEqual([])
  })

  it('replaces the earlier amount edit in place instead of adding another', () => {
    const first = commitFields(ctxFor(p), editField(openRow(ctxFor(p), idOf(p, BESAN)), { amount: '1' }), deps)
    if (!first.ok) throw new Error('setup')
    const ctx = ctxFor(p, first.edits)
    const second = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '2' }), { now: AT, newId: () => 'n2' })
    expect(second.ok && second.edits).toHaveLength(1)
    expect(second.ok && (valueOf(second.edits[0]) as { amount: { low: number } }).amount.low).toBe(2)
  })

  it('renames, trimmed, and writes nothing for the same name', () => {
    const ctx = ctxFor(p)
    const renamed = commitFields(ctx, editField(openRow(ctx, idOf(p, 4)), { name: '  Fresh ginger ' }), deps)
    expect(renamed.ok && renamed.edits).toEqual([
      { id: 'n1', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, 4), value: { name: 'Fresh ginger' } },
    ])
    const same = commitFields(ctx, editField(openRow(ctx, idOf(p, 4)), { name: rows(p)[4].name }), deps)
    expect(same.ok && same.edits).toEqual([])
  })

  it('writes a name edit and an amount edit together', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { name: 'Gram flour', amount: '1' }), deps)
    expect(res.ok && res.edits.map((e) => e.op)).toEqual(['set_ingredient_name', 'set_ingredient_amount'])
  })

  it('writes a range', () => {
    const ctx = ctxFor(p)
    const f = editField(openRow(ctx, idOf(p, BESAN)), { amount: '1', rangeOpen: true, range: '1½' })
    const res = commitFields(ctx, f, deps)
    expect(res.ok && (valueOf(res.edits[0]) as { amount: unknown }).amount).toEqual({ kind: 'number', low: 1, high: 1.5 })
  })

  it('writes To taste with no unit', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { mode: 'taste' }), deps)
    expect(res.ok && valueOf(res.edits[0])).toEqual({ amount: { kind: 'to_taste' }, unit: null })
  })

  it('writes "No unit" as a null unit', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '2', unit: null }), deps)
    expect(res.ok && (valueOf(res.edits[0]) as { unit: unknown }).unit).toBeNull()
  })

  it('keeps an imported unit outside the list verbatim when the cook does not touch it', () => {
    const cupcakes = byName('chicken-biryani')
    const idx = rows(cupcakes).findIndex((r) => r.unit === 'handful')
    const ctx = ctxFor(cupcakes)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(cupcakes, idx)), { amount: '2' }), deps)
    expect(res.ok && (valueOf(res.edits[0]) as { unit: unknown }).unit).toBe('handful')
  })

  it('writes a typed decimal as the shared formatter shows it: 1.5 -> "1½" on the row', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '1.5' }), deps)
    if (!res.ok) throw new Error('commit')
    const row = rows(applyEdits(p, res.edits).payload)[BESAN]
    expect(row.qty_text).toBe('1½')
    expect(quantityTrailingScaled(row, 1).text).toBe('1½ tbsp')
  })

  it('snaps a typed 0.33 to a third, in the value and on the row', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '0.33' }), deps)
    if (!res.ok) throw new Error('commit')
    expect((valueOf(res.edits[0]) as { amount: { low: number } }).amount.low).toBeCloseTo(1 / 3, 10)
    expect(rows(applyEdits(p, res.edits).payload)[BESAN].qty_text).toBe('⅓')
  })

  it('writes a line with no qty_amount only when the cook gives it an amount (sabudana)', () => {
    const s = byName('sabudana-khichdi')
    const ctx = ctxFor(s)
    const untouched = commitFields(ctx, editField(openRow(ctx, idOf(s, 0)), { name: 'Soaked sabudana' }), deps)
    expect(untouched.ok && untouched.edits.map((e) => e.op)).toEqual(['set_ingredient_name'])
    const withUnitOnly = commitFields(ctx, editField(openRow(ctx, idOf(s, 0)), { unit: 'cup' }), deps)
    expect(withUnitOnly.ok).toBe(false)
    const full = commitFields(ctx, editField(openRow(ctx, idOf(s, 0)), { amount: '1½', unit: 'cup' }), deps)
    expect(full.ok && (valueOf(full.edits[0]) as { amount: { low: number }; unit: string })).toEqual({
      amount: { kind: 'number', low: 1.5, high: null },
      unit: 'cup',
    })
  })

  it('refuses invalid input and returns the inline errors', () => {
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(p, BESAN)), { amount: '0' }), deps)
    expect(res).toEqual({ ok: false, errors: { amount: 'Enter an amount above 0.' } })
  })

  it('rewrites an added row in place, keeping its id', () => {
    const base: RecipeEdit[] = [
      { id: 'a1', created_at: AT, op: 'add_ingredient', value: { name: 'Lemon juice', amount: { kind: 'number', low: 1, high: null }, unit: 'tsp', step: null } } as RecipeEdit,
    ]
    const ctx = ctxFor(p, base)
    const f = editField(openRow(ctx, 'ing_user_a1'), { amount: '2' })
    const res = commitFields(ctx, f, { now: AT, newId: () => 'zzz' })
    expect(res.ok && res.edits).toHaveLength(1)
    expect(res.ok && res.edits[0].id).toBe('a1')
    expect(res.ok && (valueOf(res.edits[0]) as { amount: { low: number } }).amount.low).toBe(2)
  })
})

describe('A1: the editor always edits as-written amounts', () => {
  it('an edit made at 2 of 4 servings stores the as-written value; the view shows it scaled', () => {
    const p = byName('kadhi-pakora')
    const choice: ServingsChoice = { mode: 'servings', chosen: 2, original: 4 }
    const ctx = ctxFor(p)
    const f = openRow(ctx, idOf(p, BESAN))
    expect(f.amount).toBe('4') // as written, not the 2 the page shows
    const res = commitFields(ctx, editField(f, { amount: '1' }), deps)
    if (!res.ok) throw new Error('commit')
    expect((valueOf(res.edits[0]) as { amount: { low: number } }).amount.low).toBe(1)
    const row = rows(applyEdits(p, res.edits).payload)[BESAN]
    expect(quantityTrailingScaled(row, choiceFactor(choice)).text).toBe('½ tbsp')
  })
})

describe('commitFields: the add form', () => {
  const p = byName('kadhi-pakora')

  it('writes an add_ingredient with no step link', () => {
    const f = editField(openAdd(), { name: ' Lemon juice ', amount: '1', unit: 'tsp' })
    const res = commitFields(ctxFor(p), f, deps)
    expect(res.ok && res.edits).toEqual([
      {
        id: 'n1',
        created_at: AT,
        op: 'add_ingredient',
        value: { name: 'Lemon juice', amount: { kind: 'number', low: 1, high: null }, unit: 'tsp', step: null },
      },
    ])
  })

  it('takes an add with only a name: no amount, no unit', () => {
    const res = commitFields(ctxFor(p), editField(openAdd(), { name: 'Curry leaves', unit: null }), deps)
    expect(res.ok && valueOf(res.edits[0])).toMatchObject({ amount: null, unit: null })
  })

  it('needs a name', () => {
    const res = commitFields(ctxFor(p), editField(openAdd(), { amount: '1' }), deps)
    expect(res).toEqual({ ok: false, errors: { name: EDITOR_COPY.nameError } })
  })

  it('appends to the edits already stored', () => {
    const existing: RecipeEdit[] = [
      { id: 'e0', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, 4), value: { name: 'Fresh ginger' } } as RecipeEdit,
    ]
    const res = commitFields(ctxFor(p, existing), editField(openAdd(), { name: 'Lemon' }), deps)
    expect(res.ok && res.edits.map((e) => e.id)).toEqual(['e0', 'n1'])
  })
})

describe('A24: no edit is lost silently', () => {
  const p = byName('kadhi-pakora')
  const ctx = ctxFor(p)
  const okWrite = () => vi.fn((_edits: RecipeEdit[]) => ({ ok: true as const }))
  const KINDS = ['done', 'tab', 'start', 'back'] as const

  const dirtyRow = (amount = '1') => editField(startEditingAt(ctx, idOf(p, BESAN)), { amount })

  it.each(KINDS)('%s: a dirty valid row is committed, then the cook goes on', (kind) => {
    const write = okWrite()
    const res = leave(dirtyRow('1'), kind, ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(res.edits).toEqual(write.mock.calls[0][0])
    expect(res.edits).toHaveLength(1)
    expect(res.session.open).toBeNull()
    expect(res.session.mode).toBe('view')
  })

  it.each(KINDS)('%s: a dirty invalid row stays open with its inline error and the cook does not go on', (kind) => {
    const write = okWrite()
    const session = dirtyRow('0')
    const res = leave(session, kind, ctx, write, deps)
    expect(res.proceed).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(res.session.mode).toBe('edit')
    expect(res.session.open?.amount).toBe('0')
    expect(res.session.open?.errors.amount).toBe('Enter an amount above 0.')
  })

  it.each(KINDS)('%s: a failed write keeps the row open and its input, with the A8 copy', (kind) => {
    const write = vi.fn((_e: RecipeEdit[]) => ({ ok: false as const }))
    const res = leave(dirtyRow('1'), kind, ctx, write, deps)
    expect(res.proceed).toBe(false)
    expect(res.session.open?.amount).toBe('1')
    expect(res.session.writeError).toBe("Couldn't save your change. Try again.")
    expect(EDITOR_COPY.writeFailed).toBe("Couldn't save your change. Try again.")
  })

  it.each(KINDS)('%s: an open row nobody touched writes nothing and the cook goes on', (kind) => {
    const write = okWrite()
    const res = leave(startEditingAt(ctx, idOf(p, BESAN)), kind, ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it.each(KINDS)('%s: edit mode with nothing open just leaves', (kind) => {
    const write = okWrite()
    const res = leave(startEditing(), kind, ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(write).not.toHaveBeenCalled()
    expect(res.session.mode).toBe('view')
  })

  it('switching to another row commits the open one and stays in edit mode', () => {
    const write = okWrite()
    const res = leave(dirtyRow('1'), 'row', ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(res.session.mode).toBe('edit')
    expect(res.session.open).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('switching rows is blocked by invalid input like every other exit', () => {
    const res = leave(dirtyRow('0'), 'row', ctx, okWrite(), deps)
    expect(res.proceed).toBe(false)
    expect(res.session.open?.errors.amount).toBeDefined()
  })

  it('a dirty valid add form is committed as an add on every exit', () => {
    for (const kind of KINDS) {
      const write = okWrite()
      const session = editField(openAddForm(startEditing()), { name: 'Lemon juice', amount: '1', unit: 'tsp' })
      const res = leave(session, kind, ctx, write, deps)
      expect(res.proceed).toBe(true)
      expect(res.edits?.map((e) => e.op)).toEqual(['add_ingredient'])
    }
  })

  it('an add form with an amount but no name stays open with the name error', () => {
    for (const kind of KINDS) {
      const write = okWrite()
      const session = editField(openAddForm(startEditing()), { amount: '1' })
      const res = leave(session, kind, ctx, write, deps)
      expect(res.proceed).toBe(false)
      expect(write).not.toHaveBeenCalled()
      expect(res.session.add?.errors.name).toBe(EDITOR_COPY.nameError)
    }
  })

  it('an untouched add form is dropped without a write', () => {
    for (const kind of KINDS) {
      const write = okWrite()
      const res = leave(openAddForm(startEditing()), kind, ctx, write, deps)
      expect(res.proceed).toBe(true)
      expect(write).not.toHaveBeenCalled()
    }
  })

  it('A4: tapping an Edited tag enters edit mode with that row open', () => {
    const session = startEditingAt(ctx, idOf(p, BESAN))
    expect(session.mode).toBe('edit')
    expect(session.open?.target).toEqual({ kind: 'row', id: idOf(p, BESAN) })
  })
})

describe('A27: the remove warning', () => {
  it('says nothing when no step uses the ingredient', () => {
    expect(removeWarning(0)).toBeNull()
  })

  it('is singular for one step', () => {
    expect(removeWarning(1)).toBe("Used in 1 step. It comes off that step's ingredient list; the step text stays as written.")
  })

  it('is plural for several', () => {
    expect(removeWarning(2)).toBe('Used in 2 steps. It comes off their ingredient lists; the step text stays as written.')
    expect(removeWarning(5)).toBe('Used in 5 steps. It comes off their ingredient lists; the step text stays as written.')
  })
})

describe('A31: name-only and unit-only edits', () => {
  it('a name-only edit on a line with no amount commits without touching the amount', () => {
    const s = byName('sabudana-khichdi')
    const ctx = ctxFor(s)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(s, 0)), { name: 'Soaked sabudana' }), deps)
    expect(res.ok && res.edits.map((e) => e.op)).toEqual(['set_ingredient_name'])
  })

  it('a unit change with an empty amount stays blocked with the amount error', () => {
    const s = byName('sabudana-khichdi')
    const ctx = ctxFor(s)
    const res = commitFields(ctx, editField(openRow(ctx, idOf(s, 0)), { unit: 'cup' }), deps)
    expect(res).toEqual({ ok: false, errors: { amount: 'Enter an amount above 0.' } })
  })
})

describe('A33: the "Imported: ..." lines', () => {
  const p = byName('kadhi-pakora')

  it('an unedited line the parser could not scale opens empty and still shows the original beside it', () => {
    const cup = {
      id: 'ing_butter', name: 'Unsalted Butter', qty: 0.5, qty_text: '1/2', qty_amount: null, unit: 'cup (125 g)',
      prep_note: null, group: null,
    } as unknown as Row
    expect(amountFields(cup).amount).toBe('')
    expect(importedLines(null, cup)).toEqual({ name: null, line: '1/2 cup (125 g)' })
  })

  it('an unedited line with a scalable amount shows no Imported line', () => {
    expect(importedLines(null, rows(p)[1])).toBeNull()
  })

  it('an edited line shows the imported name and amount, each only when it changed', () => {
    const edits = [
      { id: 'e1', created_at: AT, op: 'set_ingredient_amount', anchor: ingredientAnchor(p, 1), value: { amount: { kind: 'number', low: 1, high: null }, unit: 'tbsp' } } as RecipeEdit,
      { id: 'e2', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, 4), value: { name: 'Fresh ginger' } } as RecipeEdit,
    ]
    const overlay = applyEdits(p, edits)
    const besan = rows(overlay.payload)[1]
    const ginger = rows(overlay.payload)[4]
    expect(importedLines(overlay.importedRows.get(besan.id) ?? null, besan)).toEqual({ name: null, line: '4 tbsp' })
    expect(importedLines(overlay.importedRows.get(ginger.id) ?? null, ginger)).toEqual({ name: rows(p)[4].name, line: null })
  })
})
