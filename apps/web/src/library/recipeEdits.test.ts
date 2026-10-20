import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { quantityTrailingScaled } from '@/lib/quantity'
import { derivePlan } from '@/plan/derive'

import {
  ADDED_GROUP,
  applyEdits,
  discardEdit,
  ingredientAnchor,
  removeRow,
  restoreEdit,
  orphanNowLine,
  restoreRow,
  stepUsage,
  upsertEdit,
  type RecipeEdit,
} from './recipeEdits'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
const ALL = Object.entries(FIXTURES).map(([path, payload]) => [path.split('/').pop()!.replace('.plan-response.json', ''), payload] as const)

const AT = '2026-10-20T08:00:00.000Z'

type Row = RecipePlanResponse['graph']['ingredients'][number]
const rows = (p: RecipePlanResponse): Row[] => p.graph.ingredients as Row[]

const rename = (id: string, p: RecipePlanResponse, index: number, name: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, index), value: { name } }) as RecipeEdit
const amount = (
  id: string,
  p: RecipePlanResponse,
  index: number,
  a: { kind: 'number'; low: number; high: number | null } | { kind: 'to_taste' },
  unit: string | null,
): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_ingredient_amount', anchor: ingredientAnchor(p, index), value: { amount: a, unit } }) as RecipeEdit
const remove = (id: string, p: RecipePlanResponse, index: number): RecipeEdit =>
  ({ id, created_at: AT, op: 'remove_ingredient', anchor: ingredientAnchor(p, index) }) as RecipeEdit
const addRow = (id: string, name: string, a: { kind: 'number'; low: number; high: number | null } | null, unit: string | null): RecipeEdit =>
  ({ id, created_at: AT, op: 'add_ingredient', value: { name, amount: a, unit, step: null } }) as RecipeEdit

/** The part of a payload an edit must never change: plan, stages, summary and every node. */
function structure(p: RecipePlanResponse) {
  return { plan: p.plan, stages: p.stages, summary: p.summary, nodes: p.graph.nodes, graphStages: p.graph.stages, id: p.graph.id }
}

describe('ingredientAnchor', () => {
  it('is the index plus the name, qty_text and unit expected there', () => {
    const p = byName('kadhi-pakora')
    const row = rows(p)[1]
    expect(ingredientAnchor(p, 1)).toEqual({
      index: 1,
      expected: { name: row.name, qty_text: row.qty_text ?? null, unit: row.unit ?? null },
    })
  })

  it('records null for a missing qty_text or unit', () => {
    const p = byName('chicken-biryani')
    const salt = rows(p).findIndex((r) => r.name === 'Salt')
    expect(ingredientAnchor(p, salt).expected).toEqual({ name: 'Salt', qty_text: null, unit: 'to taste' })
  })
})

describe('applyEdits: every op', () => {
  it('renames a row, keeps its id, and marks it edited', () => {
    const p = byName('kadhi-pakora')
    const before = rows(p)[4]
    const res = applyEdits(p, [rename('e1', p, 4, 'Fresh ginger')])
    const after = rows(res.payload)[4]
    expect(after.name).toBe('Fresh ginger')
    expect(after.id).toBe(before.id)
    expect(res.edited.has(before.id)).toBe(true)
    expect(res.statuses.e1).toBe('applied')
    expect(res.orphans).toEqual([])
  })

  it('sets an exact amount, written with cooking fractions', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [amount('e1', p, 1, { kind: 'number', low: 1.5, high: null }, 'tbsp')])
    const row = rows(res.payload)[1]
    expect(row.qty_text).toBe('1½')
    expect(row.qty).toBe(1.5)
    expect(row.unit).toBe('tbsp')
    expect(row.qty_amount).toEqual({ low: 1.5, high: null, prefix: '', rest: '' })
    expect(quantityTrailingScaled(row, 1).text).toBe('1½ tbsp')
  })

  it('sets a range', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [amount('e1', p, 1, { kind: 'number', low: 1, high: 1.5 }, 'tbsp')])
    const row = rows(res.payload)[1]
    expect(row.qty_text).toBe('1–1½')
    expect(row.qty_amount).toEqual({ low: 1, high: 1.5, prefix: '', rest: '' })
  })

  it('sets "to taste": no amount, no unit, nothing to scale', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [amount('e1', p, 1, { kind: 'to_taste' }, null)])
    const row = rows(res.payload)[1]
    expect(row.qty_text).toBe('to taste')
    expect(row.qty_amount).toBeNull()
    expect(row.unit).toBeNull()
    expect(quantityTrailingScaled(row, 1).text).toBe('to taste')
  })

  it('removes a row from the list and from "You\'ll need", leaving every node as it was', () => {
    const p = byName('kadhi-pakora')
    const victim = rows(p)[1]
    const res = applyEdits(p, [remove('e1', p, 1)])
    expect(rows(res.payload).some((r) => r.id === victim.id)).toBe(false)
    expect(res.payload.graph.nodes).toEqual(p.graph.nodes)
    const plan = derivePlan(res.payload)
    expect(plan.stages.flatMap((s) => s.ingredients).some((i) => i.id === victim.id)).toBe(false)
    expect(plan.ingredientGroups.flatMap((g) => g.items).some((i) => i.id === victim.id)).toBe(false)
  })

  it('adds a row after the imported ones, in its own "Added by you" group, linked to no step', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [addRow('a1', 'Lemon juice', { kind: 'number', low: 1, high: null }, 'tsp')])
    const all = rows(res.payload)
    const added = all[all.length - 1]
    expect(added.id).toBe('ing_user_a1')
    expect(added.name).toBe('Lemon juice')
    expect(added.group).toBe(ADDED_GROUP)
    expect(ADDED_GROUP).toBe('Added by you')
    expect(added.qty_text).toBe('1')
    expect(added.unit).toBe('tsp')
    expect(res.added.has('ing_user_a1')).toBe(true)
    expect(res.payload.graph.nodes.every((n) => !(n.consumes ?? []).includes('ing_user_a1'))).toBe(true)
    const groups = derivePlan(res.payload).ingredientGroups
    expect(groups[groups.length - 1].group).toBe(ADDED_GROUP)
  })

  it('adds a row with no amount and no unit', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [addRow('a1', 'Curry leaves', null, null)])
    const added = rows(res.payload).at(-1)!
    expect(added.qty_text ?? null).toBeNull()
    expect(added.qty_amount ?? null).toBeNull()
    expect(quantityTrailingScaled(added, 1).text).toBeNull()
  })

  it('applies edits in order and lands added rows in the order they were added', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [addRow('a1', 'First', null, null), addRow('a2', 'Second', null, null)])
    expect(rows(res.payload).slice(-2).map((r) => r.name)).toEqual(['First', 'Second'])
  })

  it('lists the imported row of every edited row, for the "Imported: ..." line', () => {
    const p = byName('kadhi-pakora')
    const row = rows(p)[1]
    const res = applyEdits(p, [amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp')])
    expect(res.importedRows.get(row.id)).toEqual(row)
  })
})

describe('applyEdits: nothing but ingredients changes', () => {
  it.each(ALL)('%s: plan, stages, summary, node ids, edges and durations are untouched by every op', (_name, payload) => {
    const p = structuredClone(payload)
    const n = rows(p).length
    const edits: RecipeEdit[] = [
      rename('e1', p, 0, 'Renamed'),
      amount('e2', p, n > 1 ? 1 : 0, { kind: 'number', low: 3, high: null }, 'tbsp'),
      addRow('a1', 'Added', { kind: 'number', low: 1, high: null }, 'tsp'),
    ]
    if (n > 2) edits.push(remove('e3', p, 2))
    const before = structuredClone(structure(p))
    const res = applyEdits(p, edits)
    expect(structure(res.payload)).toEqual(before)
    // the input is not mutated either
    expect(p).toEqual(payload)
  })

  it('returns a different object when an edit applied, so the raw payload can stay raw', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [rename('e1', p, 4, 'Fresh ginger')])
    expect(res.payload).not.toBe(p)
    expect(rows(p)[4].name).not.toBe('Fresh ginger')
  })

  it('returns the payload itself when there is nothing to apply', () => {
    const p = byName('kadhi-pakora')
    expect(applyEdits(p, []).payload).toBe(p)
  })
})

describe('applyEdits: anchors, orphans and the unknown', () => {
  it('orphans an edit whose anchor no longer matches, keeps it, and shows the row as imported', () => {
    const p = byName('kadhi-pakora')
    const stale = amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp') as RecipeEdit & { anchor: { expected: { qty_text: string | null } } }
    stale.anchor.expected.qty_text = '9'
    const res = applyEdits(p, [stale])
    expect(res.statuses.e1).toBe('orphaned')
    expect(res.orphans).toHaveLength(1)
    expect(res.orphans[0].id).toBe('e1')
    expect(rows(res.payload)[1]).toEqual(rows(p)[1])
  })

  it('orphans an edit whose index is past the end of the list', () => {
    const p = byName('maggi-2min')
    const gone = { ...rename('e1', byName('kadhi-pakora'), 20, 'X') } as RecipeEdit
    const res = applyEdits(p, [gone])
    expect(res.statuses.e1).toBe('orphaned')
  })

  it('describes an orphaned amount: your change, and what the imported recipe now says', () => {
    const p = byName('kadhi-pakora')
    const edit = amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp') as RecipeEdit & { anchor: { expected: { qty_text: string | null } } }
    edit.anchor.expected.qty_text = '9'
    const [orphan] = applyEdits(p, [edit]).orphans
    expect(orphan.label).toBe(rows(p)[1].name)
    expect(orphan.yourChange).toBe('1 tbsp')
    expect(orphan.nowSays).toBe('4 tbsp')
  })

  it('describes an orphaned rename and an orphaned remove', () => {
    const p = byName('kadhi-pakora')
    const r1 = rename('e1', p, 4, 'Fresh ginger') as RecipeEdit & { anchor: { expected: { name: string } } }
    r1.anchor.expected.name = 'Old name'
    const r2 = remove('e2', p, 5) as RecipeEdit & { anchor: { expected: { name: string } } }
    r2.anchor.expected.name = 'Old turmeric'
    const { orphans } = applyEdits(p, [r1, r2])
    expect(orphans.map((o) => o.yourChange)).toEqual(['Fresh ginger', 'Remove'])
    expect(orphans.map((o) => o.nowSays)).toEqual([rows(p)[4].name, rows(p)[5].name])
  })

  it('says nothing about what the recipe now has when the line is gone', () => {
    const p = byName('maggi-2min')
    const far = rename('e1', byName('kadhi-pakora'), 20, 'X')
    expect(applyEdits(p, [far]).orphans[0].nowSays).toBeNull()
  })

  it('ignores an unknown op or a malformed item: kept verbatim, not counted', () => {
    const p = byName('kadhi-pakora')
    const junk = [{ id: 'u1', op: 'set_everything', value: 1 }, 'text', null, { op: 'set_ingredient_name' }] as unknown as RecipeEdit[]
    const before = structuredClone(junk)
    const res = applyEdits(p, junk)
    expect(res.orphans).toEqual([])
    expect(res.statuses.u1).toBe('ignored')
    expect(res.payload).toBe(p)
    expect(junk).toEqual(before)
  })

  it('R6a ignores a step-text edit (step editing is R6b), keeping it', () => {
    const p = byName('kadhi-pakora')
    const step = { id: 's1', created_at: AT, op: 'set_step_text', anchor: { index: 0, expected: { text: 'x' } }, value: { text: 'y' } } as RecipeEdit
    const res = applyEdits(p, [step])
    expect(res.statuses.s1).toBe('ignored')
    expect(res.orphans).toEqual([])
    expect(res.payload.graph.nodes).toEqual(p.graph.nodes)
  })
})

describe('upsertEdit, restoreEdit, restoreRow, removeRow, discardEdit', () => {
  const p = byName('kadhi-pakora')

  it('replaces a same-op edit on the same row in place, never appending a second', () => {
    const first = amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp')
    const other = rename('e2', p, 4, 'Fresh ginger')
    const second = amount('e3', p, 1, { kind: 'number', low: 2, high: null }, 'tbsp')
    const out = upsertEdit([first, other], second)
    expect(out.map((e) => e.id)).toEqual(['e3', 'e2'])
  })

  it('appends an edit of a different op or a different row', () => {
    const out = upsertEdit([amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp')], rename('e2', p, 1, 'Gram flour'))
    expect(out.map((e) => e.id)).toEqual(['e1', 'e2'])
    const out2 = upsertEdit(out, amount('e3', p, 2, { kind: 'number', low: 1, high: null }, 'cup'))
    expect(out2.map((e) => e.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('rewrites an added row in place by its id', () => {
    const out = upsertEdit([addRow('a1', 'Lemon', null, null), rename('e1', p, 1, 'X')], addRow('a1', 'Lime', null, null))
    expect(out.map((e) => e.id)).toEqual(['a1', 'e1'])
    expect((out[0] as { value: { name: string } }).value.name).toBe('Lime')
  })

  it('a remove clears that row\'s set edits and keeps every other row\'s', () => {
    const edits = [
      amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp'),
      rename('e2', p, 1, 'Gram flour'),
      rename('e3', p, 4, 'Fresh ginger'),
    ]
    const out = upsertEdit(edits, remove('e4', p, 1))
    expect(out.map((e) => e.id)).toEqual(['e3', 'e4'])
  })

  it('restoreEdit deletes exactly that edit, so restoring a remove brings the row back', () => {
    const edits = upsertEdit([], remove('e1', p, 1))
    const out = restoreEdit(edits, 'e1')
    expect(out).toEqual([])
    expect(rows(applyEdits(p, out).payload).length).toBe(rows(p).length)
  })

  it('restoreRow deletes every edit on that row and no other', () => {
    const rowId = rows(p)[1].id
    const edits = [
      amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp'),
      rename('e2', p, 1, 'Gram flour'),
      rename('e3', p, 4, 'Fresh ginger'),
    ]
    expect(restoreRow(edits, p, rowId).map((e) => e.id)).toEqual(['e3'])
  })

  it('removeRow removes an imported row with a remove edit, and an added row by deleting its add', () => {
    const rowId = rows(p)[1].id
    const out = removeRow([amount('e1', p, 1, { kind: 'number', low: 1, high: null }, 'tbsp')], p, rowId, { id: 'r1', now: AT })
    expect(out.map((e) => e.op)).toEqual(['remove_ingredient'])
    const added = removeRow([addRow('a1', 'Lemon', null, null)], p, 'ing_user_a1', { id: 'r2', now: AT })
    expect(added).toEqual([])
  })

  it('discardEdit deletes the one orphan and nothing else', () => {
    const edits = [rename('e1', p, 4, 'A'), rename('e2', p, 5, 'B')]
    expect(discardEdit(edits, 'e1').map((e) => e.id)).toEqual(['e2'])
    expect(discardEdit(edits, 'nope')).toEqual(edits)
  })

  it('never mutates the array it is given', () => {
    const edits = [rename('e1', p, 4, 'A')]
    const frozen = Object.freeze([...edits])
    expect(() => upsertEdit(frozen, rename('e2', p, 5, 'B'))).not.toThrow()
    expect(() => discardEdit(frozen, 'e1')).not.toThrow()
  })
})

describe('stepUsage', () => {
  it('counts the steps whose consumes hold the ingredient', () => {
    const p = byName('kadhi-pakora')
    const used = rows(p).map((r) => [r.id, p.graph.nodes.filter((n) => (n.consumes ?? []).includes(r.id)).length] as const)
    for (const [id, n] of used) expect(stepUsage(p, id)).toBe(n)
    expect(used.some(([, n]) => n >= 1)).toBe(true)
  })

  it('is 0 for an added row and for an unknown id', () => {
    const p = byName('kadhi-pakora')
    expect(stepUsage(p, 'ing_user_a1')).toBe(0)
    expect(stepUsage(p, 'nope')).toBe(0)
  })
})

describe('an edited amount scales like any other line (A13)', () => {
  it('at 1.5x the edited line is 1.5 times the edited amount', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [amount('e1', p, 1, { kind: 'number', low: 2, high: null }, 'tbsp')])
    expect(quantityTrailingScaled(rows(res.payload)[1], 1.5).text).toBe('3 tbsp')
  })
})

describe('A26: removed rows are listed, so they can be restored', () => {
  it('lists each applied remove with its edit id and the imported row', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [remove('r1', p, 1), remove('r2', p, 8)])
    expect(res.removed.map((r) => [r.editId, r.row.id])).toEqual([
      ['r1', rows(p)[1].id],
      ['r2', rows(p)[8].id],
    ])
    expect(res.removed[0].row).toEqual(rows(p)[1])
  })

  it('lists nothing for an orphaned remove, and nothing when no row was removed', () => {
    const p = byName('kadhi-pakora')
    const stale = remove('r1', p, 1) as RecipeEdit & { anchor: { expected: { name: string } } }
    stale.anchor.expected.name = 'Old'
    expect(applyEdits(p, [stale]).removed).toEqual([])
    expect(applyEdits(p, []).removed).toEqual([])
  })

  it('restoring a removed row (deleting its remove edit) brings the row back', () => {
    const p = byName('kadhi-pakora')
    const edits = [remove('r1', p, 1)]
    const { removed } = applyEdits(p, edits)
    const back = applyEdits(p, restoreEdit(edits, removed[0].editId))
    expect(rows(back.payload).map((r) => r.id)).toEqual(rows(p).map((r) => r.id))
    expect(back.removed).toEqual([])
  })
})

describe('A30: the orphan review line for a position the imported recipe no longer has', () => {
  it('says what the recipe now has, or that the ingredient is gone', () => {
    expect(orphanNowLine('4 tbsp')).toBe('The imported recipe now says: 4 tbsp')
    expect(orphanNowLine(null)).toBe('The imported recipe no longer has this ingredient.')
  })
})
