import { describe, expect, it, vi } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import {
  commitFields,
  editField,
  editStepText,
  leave,
  openAdd,
  openAddForm,
  openRow,
  openStepForm,
  startEditing,
  startEditingAt,
  startEditingAtStep,
  type EditContext,
} from './ingredientEditor'
import { applyEdits, ingredientAnchor, removeRow, restoreRow, stepAnchor, type RecipeEdit } from './recipeEdits'
import { STEP_COPY } from './stepEditor'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
type MutNode = { id: string; instruction: string; consumes?: string[] | null }
const nodesOf = (p: RecipePlanResponse): MutNode[] => p.graph.nodes as unknown as MutNode[]
type Row = RecipePlanResponse['graph']['ingredients'][number]
const rows = (p: RecipePlanResponse): Row[] => p.graph.ingredients as Row[]

const AT = '2026-10-20T08:00:00.000Z'
const deps = { now: AT, newId: () => 'n1' }
const okWrite = () => vi.fn((_edits: RecipeEdit[]) => ({ ok: true as const }))

function ctxFor(payload: RecipePlanResponse, edits: RecipeEdit[] = []): EditContext {
  return { payload, edits, overlay: applyEdits(payload, edits) }
}
const stepEdit = (id: string, p: RecipePlanResponse, index: number, text: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, index), value: { text } }) as RecipeEdit
const addEdit = (id: string, name: string, step: unknown = null): RecipeEdit =>
  ({ id, created_at: AT, op: 'add_ingredient', value: { name, amount: { kind: 'number', low: 1, high: null }, unit: 'tsp', step } }) as RecipeEdit
const valueOf = (e: RecipeEdit): { step?: unknown; name?: string; text?: string } => (e as unknown as { value: { step?: unknown; name?: string; text?: string } }).value

const KADHI_COOK = 2

describe('A24 for a step: no typed step text is lost silently', () => {
  const p = byName('kadhi-pakora')
  const ctx = ctxFor(p)
  const nodeId = nodesOf(p)[KADHI_COOK].id
  const dirty = (text = 'Cook it for forty minutes.') => editStepText(startEditingAtStep(ctx, nodeId), text)
  const VIEW_KINDS = ['done', 'tab', 'start', 'back'] as const
  const STAY_KINDS = ['row', 'collapse'] as const

  it('startEditingAtStep enters edit mode with that step open and nothing else open', () => {
    const s = startEditingAtStep(ctx, nodeId)
    expect(s.mode).toBe('edit')
    expect(s.step?.target).toEqual({ kind: 'step', nodeId })
    expect(s.open).toBeNull()
    expect(s.add).toBeNull()
  })

  it('opening a step closes an open row and the add form, and vice versa (at most one is open)', () => {
    const rowOpen = startEditingAt(ctx, rows(p)[1].id)
    const s = openStepForm(rowOpen, ctx, nodeId)
    expect(s.open).toBeNull()
    expect(s.step).not.toBeNull()
    expect(openAddForm(s).step).toBeNull()
  })

  it.each([...VIEW_KINDS, ...STAY_KINDS])('%s: a dirty valid step is committed, then the cook goes on', (kind) => {
    const write = okWrite()
    const res = leave(dirty(), kind, ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(res.edits).toEqual(write.mock.calls[0][0])
    expect(res.edits).toHaveLength(1)
    expect(res.edits![0].op).toBe('set_step_text')
    expect(res.session.step).toBeNull()
    expect(res.session.mode).toBe(kind === 'row' || kind === 'collapse' ? 'edit' : 'view')
  })

  it.each([...VIEW_KINDS, ...STAY_KINDS])('%s: an empty step stays open with "Enter the step." and the cook does not go on', (kind) => {
    const write = okWrite()
    const res = leave(dirty('   '), kind, ctx, write, deps)
    expect(res.proceed).toBe(false)
    expect(write).not.toHaveBeenCalled()
    expect(res.session.mode).toBe('edit')
    expect(res.session.step?.text).toBe('   ')
    expect(res.session.step?.errors.text).toBe(STEP_COPY.empty)
  })

  it.each([...VIEW_KINDS, ...STAY_KINDS])('%s: a step over 1000 characters is blocked with the too-long copy', (kind) => {
    const res = leave(dirty('a'.repeat(1001)), kind, ctx, okWrite(), deps)
    expect(res.proceed).toBe(false)
    expect(res.session.step?.errors.text).toBe('Keep the step to 1000 characters.')
  })

  it.each([...VIEW_KINDS, ...STAY_KINDS])('%s: a failed write keeps the step open with its input and the A8 copy', (kind) => {
    const write = vi.fn((_e: RecipeEdit[]) => ({ ok: false as const }))
    const res = leave(dirty(), kind, ctx, write, deps)
    expect(res.proceed).toBe(false)
    expect(res.session.step?.text).toBe('Cook it for forty minutes.')
    expect(res.session.writeError).toBe("Couldn't save your change. Try again.")
  })

  it.each([...VIEW_KINDS, ...STAY_KINDS])('%s: an untouched step writes nothing and the cook goes on', (kind) => {
    const write = okWrite()
    const res = leave(startEditingAtStep(ctx, nodeId), kind, ctx, write, deps)
    expect(res.proceed).toBe(true)
    expect(write).not.toHaveBeenCalled()
  })

  it('collapse keeps edit mode on and closes the step; it is its own kind of exit (D3)', () => {
    const res = leave(startEditingAtStep(ctx, nodeId), 'collapse', ctx, okWrite(), deps)
    expect(res.session.mode).toBe('edit')
    expect(res.session.step).toBeNull()
  })

  it('collapse with a row or the add form open only closes it, as a row switch does', () => {
    const res = leave(startEditingAt(ctx, rows(p)[1].id), 'collapse', ctx, okWrite(), deps)
    expect(res.proceed).toBe(true)
    expect(res.session.mode).toBe('edit')
  })

  it('B4: a blocked exit leaves the session exactly as it was, so "Edit the step" stays put', () => {
    const invalid = dirty('')
    const res = leave(invalid, 'tab', ctx, okWrite(), deps)
    expect(res.proceed).toBe(false)
    expect(res.session.mode).toBe('edit')
    expect(res.session.step?.target).toEqual(invalid.step?.target)
  })

  it('typing a fix clears the inline error (the editor is re-armed)', () => {
    const blocked = leave(dirty(''), 'tab', ctx, okWrite(), deps).session
    const fixed = editStepText(blocked, 'Stir.')
    expect(fixed.step?.errors).toEqual({})
    expect(fixed.step?.text).toBe('Stir.')
  })
})

describe('B20: the saved-step hint lives for the sitting only', () => {
  const p = byName('pizza-dough')
  const ctx = ctxFor(p)
  const nodeId = nodesOf(p)[1].id
  const changedAmount = nodesOf(p)[1].instruction.replace('3 1/3 cups', '4 cups')

  it('Save keeps edit mode on and remembers the step and whether to show the hint', () => {
    const res = leave(editStepText(startEditingAtStep(ctx, nodeId), changedAmount), 'row', ctx, okWrite(), deps)
    expect(res.session.mode).toBe('edit')
    expect(res.session.savedStep).toEqual({ nodeId, amountHint: true })
  })

  it('a time-only change remembers the step with no hint', () => {
    const at = 2
    const text = nodesOf(p)[at].instruction.replace('2 minutes', '5 minutes')
    const res = leave(editStepText(startEditingAtStep(ctx, nodesOf(p)[at].id), text), 'row', ctx, okWrite(), deps)
    expect(res.session.savedStep).toEqual({ nodeId: nodesOf(p)[at].id, amountHint: false })
  })

  it.each(['done', 'tab', 'start', 'back'] as const)('%s: leaving edit mode drops it', (kind) => {
    const res = leave(editStepText(startEditingAtStep(ctx, nodeId), changedAmount), kind, ctx, okWrite(), deps)
    expect(res.session.savedStep).toBeNull()
  })

  it('nothing is remembered when nothing was written', () => {
    const res = leave(startEditingAtStep(ctx, nodeId), 'row', ctx, okWrite(), deps)
    expect(res.session.savedStep).toBeNull()
  })
})

describe('D8: the step picker on the Add form', () => {
  const p = byName('kadhi-pakora')
  const ctx = ctxFor(p)

  it('opens on None', () => {
    expect(openAdd().stepNodeId).toBeNull()
  })

  it('writes the picked step as an anchor built from the RAW payload', () => {
    const edited = ctxFor(p, [stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.')])
    const f = editField(openAdd(), { name: 'Kasuri methi', amount: '1', unit: 'tsp', stepNodeId: nodesOf(p)[KADHI_COOK].id })
    const res = commitFields(edited, f, deps)
    expect(res.ok && valueOf(res.edits.at(-1)!).step).toEqual(stepAnchor(p, KADHI_COOK))
  })

  it('None writes step: null', () => {
    const res = commitFields(ctx, editField(openAdd(), { name: 'Kasuri methi' }), deps)
    expect(res.ok && valueOf(res.edits[0]).step).toBeNull()
  })

  it('picking a step on an otherwise empty form is a change, so it is not dropped silently', () => {
    const s = editField(openAddForm(startEditing()), { stepNodeId: nodesOf(p)[KADHI_COOK].id })
    const res = leave(s, 'done', ctx, okWrite(), deps)
    expect(res.proceed).toBe(false)
    expect(res.session.add?.errors.name).toBeDefined()
  })

  describe('on an added row', () => {
    const base = [addEdit('a1', 'Lemon juice', stepAnchor(p, KADHI_COOK))]
    const withLink = ctxFor(p, base)

    it('opens with its linked step pre-selected', () => {
      expect(openRow(withLink, 'ing_user_a1').stepNodeId).toBe(nodesOf(p)[KADHI_COOK].id)
    })

    it('keeps the step when the cook changes only the name', () => {
      const f = editField(openRow(withLink, 'ing_user_a1'), { name: 'Lime juice' })
      const res = commitFields(withLink, f, { now: AT, newId: () => 'zz' })
      expect(res.ok && valueOf(res.edits[0]).step).toEqual(stepAnchor(p, KADHI_COOK))
      expect(res.ok && valueOf(res.edits[0]).name).toBe('Lime juice')
    })

    it('moves it to another step when the picker changes', () => {
      const f = editField(openRow(withLink, 'ing_user_a1'), { stepNodeId: nodesOf(p)[0].id })
      const res = commitFields(withLink, f, deps)
      expect(res.ok && valueOf(res.edits[0]).step).toEqual(stepAnchor(p, 0))
    })

    it('clears it when the cook picks None', () => {
      const f = editField(openRow(withLink, 'ing_user_a1'), { stepNodeId: null })
      const res = commitFields(withLink, f, deps)
      expect(res.ok && valueOf(res.edits[0]).step).toBeNull()
    })

    it('an orphaned link pre-selects None, and a name-only save keeps the stored link untouched', () => {
      const gone = structuredClone(p)
      nodesOf(gone)[KADHI_COOK].instruction = 'The recipe was rewritten.'
      const orphaned = ctxFor(gone, base)
      const f = openRow(orphaned, 'ing_user_a1')
      expect(f.stepNodeId).toBeNull()
      const res = commitFields(orphaned, editField(f, { name: 'Lime juice' }), deps)
      expect(res.ok && valueOf(res.edits[0]).step).toEqual(stepAnchor(p, KADHI_COOK))
    })
  })
})

describe('Q10: an imported id that starts with ing_user_ is still an imported row', () => {
  // graph._slugify("User's choice greens") -> "ing_user_s_choice"
  const REAL = 'ing_user_s_choice'
  function withRealShapedId(): RecipePlanResponse {
    const p = byName('kadhi-pakora')
    const old = rows(p)[6].id
    ;(rows(p)[6] as { id: string }).id = REAL
    for (const n of nodesOf(p)) n.consumes = (n.consumes ?? []).map((c) => (c === old ? REAL : c))
    return p
  }

  it('Save writes an amount edit instead of finding no add and doing nothing', () => {
    const p = withRealShapedId()
    const ctx = ctxFor(p)
    expect(ctx.overlay.added.has(REAL)).toBe(false)
    const f = editField(openRow(ctx, REAL), { amount: '3' })
    const res = commitFields(ctx, f, deps)
    expect(res.ok).toBe(true)
    expect(res.ok && res.edits).toHaveLength(1)
    expect(res.ok && res.edits[0].op).toBe('set_ingredient_amount')
  })

  it('a rename Save writes a name edit', () => {
    const p = withRealShapedId()
    const ctx = ctxFor(p)
    const res = commitFields(ctx, editField(openRow(ctx, REAL), { name: 'Greens' }), deps)
    expect(res.ok && res.edits[0].op).toBe('set_ingredient_name')
  })

  it('Remove writes a remove_ingredient edit', () => {
    const p = withRealShapedId()
    const next = removeRow([], p, REAL, { id: 'r1', now: AT })
    expect(next.map((e) => e.op)).toEqual(['remove_ingredient'])
  })

  it('Restore original deletes the edits on that row', () => {
    const p = withRealShapedId()
    const edits = [
      { id: 'e1', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, 6), value: { name: 'Greens' } } as RecipeEdit,
    ]
    expect(restoreRow(edits, p, REAL)).toEqual([])
  })

  it('an added row is still recognised, edited in place and removed by deleting its add', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p, [addEdit('a1', 'Lemon')])
    expect(ctx.overlay.added.has('ing_user_a1')).toBe(true)
    const res = commitFields(ctx, editField(openRow(ctx, 'ing_user_a1'), { name: 'Lime' }), deps)
    expect(res.ok && res.edits.map((e) => e.id)).toEqual(['a1'])
    expect(removeRow(ctx.edits, p, 'ing_user_a1', { id: 'r1', now: AT })).toEqual([])
  })
})
