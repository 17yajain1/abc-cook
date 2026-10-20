import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import type { EditContext } from './ingredientEditor'
import { applyEdits, stepAnchor, type RecipeEdit } from './recipeEdits'
import { commitStep, isStepDirty, normaliseStepText, openStep, restoreStep, STEP_COPY, validateStepText, type StepFieldState } from './stepEditor'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
type MutNode = { id: string; instruction: string; consumes?: string[] | null }
const nodesOf = (p: RecipePlanResponse): MutNode[] => p.graph.nodes as unknown as MutNode[]

const AT = '2026-10-20T08:00:00.000Z'
const deps = { now: AT, newId: () => 'n1' }

function ctxFor(payload: RecipePlanResponse, edits: RecipeEdit[] = []): EditContext {
  return { payload, edits, overlay: applyEdits(payload, edits) }
}
const stepEdit = (id: string, p: RecipePlanResponse, index: number, text: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, index), value: { text } }) as RecipeEdit
const valueOf = (e: RecipeEdit): { text: string } => (e as unknown as { value: { text: string } }).value
const withText = (f: StepFieldState, text: string): StepFieldState => ({ ...f, text, errors: {} })

const KADHI_COOK = 2 // "Cook kadi"
const PIZZA_MEASURE = 1 // "Measure 3 1/3 cups ..." consumes flour

describe('normaliseStepText (D3, Q8)', () => {
  it('trims and collapses every whitespace run, newlines included, to one space', () => {
    expect(normaliseStepText('  Stir  the\tbatter\n\nwell.  ')).toBe('Stir the batter well.')
  })

  it('keeps Devanagari and punctuation as typed', () => {
    expect(normaliseStepText('  कढ़ी में  नमक चखें। ')).toBe('कढ़ी में नमक चखें।')
  })
})

describe('validateStepText', () => {
  it('asks for a step when it is empty or only whitespace', () => {
    expect(validateStepText('')).toBe('Enter the step.')
    expect(validateStepText(' \n\t ')).toBe(STEP_COPY.empty)
  })

  it('counts code points: 1000 pass, 1001 do not, and nothing is cut', () => {
    expect(validateStepText('a'.repeat(1000))).toBeNull()
    expect(validateStepText('a'.repeat(1001))).toBe('Keep the step to 1000 characters.')
    expect(validateStepText('\u{1F372}'.repeat(1000))).toBeNull()
    expect(validateStepText('\u{1F372}'.repeat(1001))).toBe(STEP_COPY.tooLong)
  })

  it('counts the trimmed, collapsed text, as it will be stored', () => {
    expect(validateStepText(`${'a'.repeat(1000)}    `)).toBeNull()
  })
})

describe('openStep', () => {
  it('opens on the instruction as it reads now, the overlaid one', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p, [stepEdit('s1', p, KADHI_COOK, 'Cook it for forty minutes.')])
    const f = openStep(ctx, nodesOf(p)[KADHI_COOK].id)
    expect(f.text).toBe('Cook it for forty minutes.')
    expect(f.target).toEqual({ kind: 'step', nodeId: nodesOf(p)[KADHI_COOK].id })
    expect(isStepDirty(f)).toBe(false)
  })

  it('throws for a node the overlay does not have, and for the serving-wait node (Q2)', () => {
    const p = byName('kadhi-pakora')
    expect(() => openStep(ctxFor(p), 'no_such_node')).toThrow()
    expect(() => openStep(ctxFor(p), 'step_wait_before_serving')).toThrow()
  })

  it('typing is not normalised: the field holds exactly what was typed, and is dirty once it differs', () => {
    const p = byName('kadhi-pakora')
    const f = withText(openStep(ctxFor(p), nodesOf(p)[KADHI_COOK].id), '  two  spaces ')
    expect(f.text).toBe('  two  spaces ')
    expect(isStepDirty(f)).toBe(true)
  })
})

describe('commitStep', () => {
  it('writes a set_step_text anchored on the IMPORTED text and index', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p)
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), 'Cook for forty minutes.')
    const res = commitStep(ctx, f, deps)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.edits).toHaveLength(1)
    const edit = res.edits[0] as unknown as { id: string; created_at: string; op: string; anchor: unknown }
    expect(edit.op).toBe('set_step_text')
    expect(edit.id).toBe('n1')
    expect(edit.created_at).toBe(AT)
    expect(edit.anchor).toEqual(stepAnchor(p, KADHI_COOK))
    expect(valueOf(res.edits[0]).text).toBe('Cook for forty minutes.')
  })

  it('normalises only here: trim and collapse before storing', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p)
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), '  Cook   for\n forty minutes.  ')
    const res = commitStep(ctx, f, deps)
    if (!res.ok) throw new Error('expected ok')
    expect(valueOf(res.edits[0]).text).toBe('Cook for forty minutes.')
  })

  it('re-editing an edited step replaces the edit in place and keeps the raw anchor (A: one edit per target)', () => {
    const p = byName('kadhi-pakora')
    const first = stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.')
    const ctx = ctxFor(p, [first])
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), 'Cook for fifty minutes.')
    const res = commitStep(ctx, f, { now: AT, newId: () => 'n2' })
    if (!res.ok) throw new Error('expected ok')
    expect(res.edits).toHaveLength(1)
    const edit = res.edits[0] as unknown as { anchor: unknown }
    expect(edit.anchor).toEqual(stepAnchor(p, KADHI_COOK))
    expect(valueOf(res.edits[0]).text).toBe('Cook for fifty minutes.')
  })

  it('text equal to the imported text stores no edit', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p)
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), `  ${nodesOf(p)[KADHI_COOK].instruction}  `)
    const res = commitStep(ctx, f, deps)
    if (!res.ok) throw new Error('expected ok')
    expect(res.edits).toBe(ctx.edits)
  })

  it('text typed back to the imported text deletes the existing edit, as Restore does', () => {
    const p = byName('kadhi-pakora')
    const other = stepEdit('s2', p, 0, 'A different first step.')
    const ctx = ctxFor(p, [stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.'), other])
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), nodesOf(p)[KADHI_COOK].instruction)
    const res = commitStep(ctx, f, deps)
    if (!res.ok) throw new Error('expected ok')
    expect(res.edits).toEqual([other])
  })

  it('an unchanged field writes nothing', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p, [stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.')])
    const res = commitStep(ctx, openStep(ctx, nodesOf(p)[KADHI_COOK].id), deps)
    if (!res.ok) throw new Error('expected ok')
    expect(res.edits).toBe(ctx.edits)
  })

  it('refuses an empty step and one over 1000 characters, with the approved copy and no edits', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p)
    const open = openStep(ctx, nodesOf(p)[KADHI_COOK].id)
    const empty = commitStep(ctx, withText(open, '   '), deps)
    expect(empty).toEqual({ ok: false, errors: { text: 'Enter the step.' } })
    const long = commitStep(ctx, withText(open, 'a'.repeat(1001)), deps)
    expect(long).toEqual({ ok: false, errors: { text: 'Keep the step to 1000 characters.' } })
  })

  it('builds every anchor from the raw payload, never from the overlay (a linked add keeps the imported text too)', () => {
    const p = byName('kadhi-pakora')
    const ctx = ctxFor(p, [stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.')])
    const f = withText(openStep(ctx, nodesOf(p)[KADHI_COOK].id), 'Cook for fifty minutes.')
    const res = commitStep(ctx, f, deps)
    if (!res.ok) throw new Error('expected ok')
    expect(JSON.stringify(res.edits)).not.toContain('forty minutes')
  })
})

describe('B20: the amount hint', () => {
  const hint = (p: RecipePlanResponse, index: number, text: string): boolean | undefined => {
    const ctx = ctxFor(p)
    const res = commitStep(ctx, withText(openStep(ctx, nodesOf(p)[index].id), text), deps)
    return res.ok ? res.amountHint : undefined
  }

  it('shows when an amount changed and the step uses an ingredient (pizza: 3 1/3 cups -> 4 cups)', () => {
    const p = byName('pizza-dough')
    expect(nodesOf(p)[PIZZA_MEASURE].consumes!.some((c) => c.startsWith('ing_'))).toBe(true)
    expect(hint(p, PIZZA_MEASURE, nodesOf(p)[PIZZA_MEASURE].instruction.replace('3 1/3 cups', '4 cups'))).toBe(true)
  })

  it('does not show when only a time changed', () => {
    const p = byName('pizza-dough')
    const at = 2 // "Knead by hand 2 minutes", consumes flour
    expect(nodesOf(p)[at].consumes!.some((c) => c.startsWith('ing_'))).toBe(true)
    expect(hint(p, at, nodesOf(p)[at].instruction.replace('2 minutes', '5 minutes'))).toBe(false)
  })

  it('does not show for a step with no ingredient, even when a number changed', () => {
    const p = byName('pizza-dough')
    const at = 5 // "Cover and refrigerate overnight (18 hours) or up to 1 week."
    expect(nodesOf(p)[at].consumes).toEqual([])
    expect(hint(p, at, nodesOf(p)[at].instruction.replace('up to 1 week', 'up to 2 weeks'))).toBe(false)
  })

  it('counts only ingredients: a step that consumes only a component product does not show it', () => {
    const p = byName('kadhi-pakora')
    expect(nodesOf(p)[KADHI_COOK].consumes).toEqual(['comp_kadi_mixture'])
    expect(hint(p, KADHI_COOK, nodesOf(p)[KADHI_COOK].instruction.replace('Now', 'Then add 2 chillies. Now'))).toBe(false)
  })

  it('compares against the imported text, not the text before this Save', () => {
    const p = byName('pizza-dough')
    const edited = nodesOf(p)[PIZZA_MEASURE].instruction.replace('3 1/3 cups', '4 cups')
    const ctx = ctxFor(p, [stepEdit('s1', p, PIZZA_MEASURE, edited)])
    const res = commitStep(ctx, withText(openStep(ctx, nodesOf(p)[PIZZA_MEASURE].id), `${edited} Mix well.`), deps)
    expect(res.ok && res.amountHint).toBe(true)
  })

  it('is false when the text goes back to the imported amounts', () => {
    const p = byName('pizza-dough')
    const edited = nodesOf(p)[PIZZA_MEASURE].instruction.replace('3 1/3 cups', '4 cups')
    const ctx = ctxFor(p, [stepEdit('s1', p, PIZZA_MEASURE, edited)])
    const res = commitStep(ctx, withText(openStep(ctx, nodesOf(p)[PIZZA_MEASURE].id), nodesOf(p)[PIZZA_MEASURE].instruction), deps)
    expect(res.ok && res.amountHint).toBe(false)
  })
})

describe('restoreStep', () => {
  it('deletes the step edit and only that', () => {
    const p = byName('kadhi-pakora')
    const keep = stepEdit('s2', p, 0, 'A different first step.')
    const edits = [stepEdit('s1', p, KADHI_COOK, 'Cook for forty minutes.'), keep]
    expect(restoreStep(ctxFor(p, edits), nodesOf(p)[KADHI_COOK].id)).toEqual([keep])
  })

  it('returns the edits unchanged for a step that has none', () => {
    const p = byName('kadhi-pakora')
    const edits = [stepEdit('s2', p, 0, 'A different first step.')]
    expect(restoreStep(ctxFor(p, edits), nodesOf(p)[KADHI_COOK].id)).toEqual(edits)
  })
})
