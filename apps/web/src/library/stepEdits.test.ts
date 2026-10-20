import { describe, expect, it } from 'vitest'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan } from '@/plan/derive'

import {
  applyEdits,
  isServingWaitNode,
  resolveStep,
  stepAnchor,
  unlinkAdd,
  type RecipeEdit,
} from './recipeEdits'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const FGC58 = import.meta.glob('../__fixtures__/fgc58/*.json', { eager: true, import: 'default' }) as Record<string, unknown>
const byName = (name: string): RecipePlanResponse => structuredClone(FIXTURES[`../__fixtures__/${name}.plan-response.json`])
const fgc = <T,>(name: string): T => structuredClone(FGC58[`../__fixtures__/fgc58/${name}.json`]) as T
const ALL = Object.entries(FIXTURES).map(([path, payload]) => [path.split('/').pop()!.replace('.plan-response.json', ''), payload] as const)

const AT = '2026-10-20T08:00:00.000Z'

type MutNode = { id: string; instruction: string; label: string; consumes?: string[] | null; tip?: string | null }
const nodesOf = (p: RecipePlanResponse): MutNode[] => p.graph.nodes as unknown as MutNode[]
const rows = (p: RecipePlanResponse) => p.graph.ingredients as Array<{ id: string; name: string }>

const stepEdit = (id: string, p: RecipePlanResponse, index: number, text: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, index), value: { text } }) as RecipeEdit
const linkedAdd = (id: string, name: string, p: RecipePlanResponse | null, index: number | null): RecipeEdit =>
  ({
    id,
    created_at: AT,
    op: 'add_ingredient',
    value: { name, amount: { kind: 'number', low: 0.5, high: null }, unit: 'tsp', step: p && index != null ? stepAnchor(p, index) : null },
  }) as RecipeEdit

/** The part of a payload a step edit must never change: everything except `instruction` and `consumes`. */
function structure(p: RecipePlanResponse) {
  return {
    plan: p.plan,
    stages: p.stages,
    summary: p.summary,
    graphStages: p.graph.stages,
    id: p.graph.id,
    nodes: nodesOf(p).map(({ instruction: _i, consumes: _c, ...rest }) => rest),
  }
}

const firstEditable = (p: RecipePlanResponse): number => nodesOf(p).findIndex((n) => !isServingWaitNode(n))

describe('stepAnchor', () => {
  it('is the index plus the instruction expected there, from the raw payload', () => {
    const p = byName('kadhi-pakora')
    expect(stepAnchor(p, 2)).toEqual({ index: 2, expected: { text: nodesOf(p)[2].instruction } })
  })

  it('throws for an index with no node', () => {
    expect(() => stepAnchor(byName('maggi-2min'), 99)).toThrow()
  })
})

describe('isServingWaitNode (Q2)', () => {
  it('is true for the generated wait before serving, with or without a suffix', () => {
    expect(isServingWaitNode('step_wait_before_serving')).toBe(true)
    expect(isServingWaitNode('step_wait_before_serving_2')).toBe(true)
    expect(isServingWaitNode({ id: 'step_wait_before_serving' })).toBe(true)
  })

  it('is false for every other node', () => {
    expect(isServingWaitNode('step_wait_for_it')).toBe(false)
    expect(isServingWaitNode('step_wait_before_serving_x')).toBe(false)
    const kadhi = byName('kadhi-pakora')
    expect(nodesOf(kadhi).filter((n) => isServingWaitNode(n)).map((n) => n.id)).toEqual(['step_wait_before_serving'])
  })
})

describe('resolveStep (D2)', () => {
  it('finds a unique match wherever it moved', () => {
    const p = byName('kadhi-pakora')
    const anchor = stepAnchor(p, 3)
    const moved = structuredClone(p)
    moved.graph.nodes = [...nodesOf(moved).slice(1)] as never
    expect(resolveStep(moved.graph.nodes as never, anchor)).toBe(2)
  })

  it('orphans when no step reads that way any more', () => {
    const p = byName('kadhi-pakora')
    const anchor = stepAnchor(p, 3)
    nodesOf(p)[3].instruction = 'Something else entirely.'
    expect(resolveStep(p.graph.nodes as never, anchor)).toBeNull()
  })

  it('compares the text exactly: no trim, no case folding', () => {
    const p = byName('kadhi-pakora')
    const a = stepAnchor(p, 3)
    expect(resolveStep(p.graph.nodes as never, { index: 3, expected: { text: `${a.expected.text} ` } })).toBeNull()
    expect(resolveStep(p.graph.nodes as never, { index: 3, expected: { text: a.expected.text.toUpperCase() } })).toBeNull()
  })

  it('never resolves to the serving-wait node (Q2)', () => {
    const p = byName('kadhi-pakora')
    const at = nodesOf(p).findIndex((n) => isServingWaitNode(n))
    expect(at).toBeGreaterThan(0)
    expect(resolveStep(p.graph.nodes as never, stepAnchor(p, at))).toBeNull()
  })

  describe('with two steps that read the same (croissant)', () => {
    const base = byName('croissant')
    const text = nodesOf(base)[4].instruction
    const twins = nodesOf(base)
      .map((n, i) => [n.instruction, i] as const)
      .filter(([t]) => t === text)
      .map(([, i]) => i)

    it('has the pair these tests rely on', () => {
      expect(twins).toEqual([4, 15])
    })

    it('uses the index to tell them apart when nothing moved', () => {
      expect(resolveStep(base.graph.nodes as never, stepAnchor(base, 4))).toBe(4)
      expect(resolveStep(base.graph.nodes as never, stepAnchor(base, 15))).toBe(15)
    })

    it('orphans when an unrelated step before them was dropped (the stated cost, B9)', () => {
      const p = structuredClone(base)
      const anchor = stepAnchor(base, 15)
      p.graph.nodes = nodesOf(p).filter((_, i) => i !== 0) as never
      expect(resolveStep(p.graph.nodes as never, anchor)).toBeNull()
    })

    it('lands on the surviving twin when the edited twin is dropped (B9, pinned)', () => {
      const p = structuredClone(base)
      const anchor = stepAnchor(base, 4)
      p.graph.nodes = nodesOf(p).filter((_, i) => i !== 4) as never
      expect(resolveStep(p.graph.nodes as never, anchor)).toBe(14)
    })

    it('lands on the surviving twin when the edited twin changed text (B9, pinned)', () => {
      const p = structuredClone(base)
      const anchor = stepAnchor(base, 15)
      nodesOf(p)[15].instruction = 'Rewritten.'
      expect(resolveStep(p.graph.nodes as never, anchor)).toBe(4)
    })

    it('lands on an identical copy inserted just before the target (B9, pinned)', () => {
      const p = byName('pumpkin-pancakes')
      const anchor = stepAnchor(p, 2)
      const copy = structuredClone(nodesOf(p)[2])
      const inserted = [...nodesOf(p).slice(0, 2), copy, ...nodesOf(p).slice(2)]
      // the copy sits at the old index and the target moved to 3: both read the same
      expect(resolveStep(inserted as never, anchor)).toBe(2)
    })
  })
})

describe('applyEdits: set_step_text', () => {
  it('replaces the instruction of the resolved node and nothing else (D11)', () => {
    const p = byName('kadhi-pakora')
    const before = JSON.stringify(p)
    const at = firstEditable(p)
    const res = applyEdits(p, [stepEdit('s1', p, at, 'Do the first thing, differently.')])
    expect(JSON.stringify(p)).toBe(before)
    expect(res.payload).not.toBe(p)
    expect(nodesOf(res.payload)[at].instruction).toBe('Do the first thing, differently.')
    expect(structure(res.payload)).toEqual(structure(p))
    expect(nodesOf(res.payload).map((n) => n.consumes)).toEqual(nodesOf(p).map((n) => n.consumes))
    expect(res.statuses).toEqual({ s1: 'applied' })
    expect(res.orphans).toEqual([])
  })

  it('records the edited node and its imported text', () => {
    const p = byName('kadhi-pakora')
    const at = firstEditable(p)
    const res = applyEdits(p, [stepEdit('s1', p, at, 'Changed.')])
    const id = nodesOf(p)[at].id
    expect([...res.editedSteps]).toEqual([id])
    expect(res.importedSteps.get(id)).toBe(nodesOf(p)[at].instruction)
  })

  it('B2: applies the stored text verbatim, even with a double space, a tab and a newline', () => {
    const p = byName('kadhi-pakora')
    const text = 'Stir  the\tbatter\nwell.  '
    const res = applyEdits(p, [stepEdit('s1', p, 0, text)])
    expect(nodesOf(res.payload)[0].instruction).toBe(text)
    expect(res.statuses.s1).toBe('applied')
  })

  it('B2: a stored edit round-trips through JSON byte-identical', () => {
    const p = byName('kadhi-pakora')
    const edit = stepEdit('s1', p, 0, 'Stir  the batter well.')
    const again = JSON.parse(JSON.stringify([edit])) as RecipeEdit[]
    expect(nodesOf(applyEdits(p, again).payload)[0].instruction).toBe('Stir  the batter well.')
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '  \n\t '],
  ])('B2: %s text is ignored: kept, not counted, not applied', (_label, text) => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [stepEdit('s1', p, 0, text)])
    expect(res.statuses.s1).toBe('ignored')
    expect(res.orphans).toEqual([])
    expect(res.payload).toBe(p)
  })

  it('B2: a non-string text and a missing value are ignored', () => {
    const p = byName('kadhi-pakora')
    const bad = [
      { id: 'a', created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, 0), value: { text: 7 } },
      { id: 'b', created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, 0) },
      { id: 'c', created_at: AT, op: 'set_step_text', anchor: { index: -1, expected: { text: 'x' } }, value: { text: 'y' } },
      { id: 'd', created_at: AT, op: 'set_step_text', anchor: { index: 0, expected: {} }, value: { text: 'y' } },
    ]
    const res = applyEdits(p, bad)
    expect(res.statuses).toEqual({ a: 'ignored', b: 'ignored', c: 'ignored', d: 'ignored' })
    expect(res.payload).toBe(p)
  })

  it('B2: counts code points, not UTF-16 units (1000 astral characters apply, 1001 do not)', () => {
    const p = byName('kadhi-pakora')
    const ok = '\u{1F372}'.repeat(1000)
    expect(applyEdits(p, [stepEdit('s1', p, 0, ok)]).statuses.s1).toBe('applied')
    expect(applyEdits(p, [stepEdit('s1', p, 0, `${ok}x`)]).statuses.s1).toBe('ignored')
  })

  it('a step edit whose step is gone is an orphan, with the imported text in full (D5, B17)', () => {
    const p = byName('kadhi-pakora')
    const edit = stepEdit('s1', p, 0, 'My version of the first step, which is long enough to need more than one line to read.')
    const imported = nodesOf(p)[0].instruction
    nodesOf(p)[0].instruction = 'The recipe now says something else.'
    const res = applyEdits(p, [edit])
    expect(res.statuses.s1).toBe('orphaned')
    expect(res.payload).toBe(p)
    expect(res.orphans).toHaveLength(1)
    const o = res.orphans[0]
    expect(o.kind).toBe('step')
    expect(o.id).toBe('s1')
    expect(o.importedText).toBe(imported)
    expect(o.yourChange).toBe('My version of the first step, which is long enough to need more than one line to read.')
    expect(o.nowSays).toBeNull()
  })

  it('an edit on the serving-wait node is an orphan, never applied (Q2)', () => {
    const p = byName('kadhi-pakora')
    const at = nodesOf(p).findIndex((n) => isServingWaitNode(n))
    const res = applyEdits(p, [stepEdit('s1', p, at, 'Wait ten minutes.')])
    expect(res.statuses.s1).toBe('orphaned')
    expect(nodesOf(res.payload)[at].instruction).toBe(nodesOf(p)[at].instruction)
  })

  it('works together with ingredient edits and keeps the ingredient rows as they are', () => {
    const p = byName('kadhi-pakora')
    const rename = {
      id: 'r1',
      created_at: AT,
      op: 'set_ingredient_name',
      anchor: { index: 1, expected: { name: rows(p)[1].name, qty_text: (p.graph.ingredients as never as { qty_text?: string }[])[1].qty_text ?? null, unit: (p.graph.ingredients as never as { unit?: string }[])[1].unit ?? null } },
      value: { name: 'Gram flour' },
    } as RecipeEdit
    const res = applyEdits(p, [rename, stepEdit('s1', p, 0, 'Changed.')])
    expect(res.statuses).toEqual({ r1: 'applied', s1: 'applied' })
    expect(rows(res.payload)[1].name).toBe('Gram flour')
    expect(nodesOf(res.payload)[0].instruction).toBe('Changed.')
  })
})

describe('applyEdits: an added ingredient linked to a step (D1)', () => {
  it('appends the added id to that node\'s consumes, leaves the add row alone, and records the link', () => {
    const p = byName('kadhi-pakora')
    const at = 2
    const res = applyEdits(p, [linkedAdd('k1', 'Kasuri methi', p, at)])
    const id = 'ing_user_k1'
    expect(nodesOf(res.payload)[at].consumes).toEqual([...(nodesOf(p)[at].consumes ?? []), id])
    expect(res.linkedSteps.get(id)).toBe(nodesOf(p)[at].id)
    expect(res.added.has(id)).toBe(true)
    expect(rows(res.payload).at(-1)!.id).toBe(id)
    expect(structure(res.payload)).toEqual(structure(p))
    expect(res.orphans).toEqual([])
  })

  it('shows as the stage\'s last "You\'ll need" name with no extra code (A14)', () => {
    const p = byName('kadhi-pakora')
    const at = 2
    const stageId = nodesOf(p)[at] as unknown as { stage: string }
    const res = applyEdits(p, [linkedAdd('k1', 'Kasuri methi', p, at)])
    const plan = derivePlan(res.payload)
    const stage = plan.stages.find((s) => s.stageId === stageId.stage && s.firstOfStage)!
    expect(stage.ingredients.at(-1)!.name).toBe('Kasuri methi')
  })

  it('an add with no step is unchanged from R6a', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [linkedAdd('k1', 'Kasuri methi', null, null)])
    expect(JSON.stringify(nodesOf(res.payload).map((n) => n.consumes))).toBe(JSON.stringify(nodesOf(p).map((n) => n.consumes)))
    expect(res.linkedSteps.size).toBe(0)
  })

  it('links to a step that was also edited, anchored on the imported text', () => {
    const p = byName('kadhi-pakora')
    const res = applyEdits(p, [stepEdit('s1', p, 2, 'Cook for forty minutes.'), linkedAdd('k1', 'Kasuri methi', p, 2)])
    expect(nodesOf(res.payload)[2].instruction).toBe('Cook for forty minutes.')
    expect(nodesOf(res.payload)[2].consumes).toContain('ing_user_k1')
  })

  it('Q3 (a): when the step is gone the add still applies, unlinked, and the link is its own orphan', () => {
    const p = byName('kadhi-pakora')
    const edit = linkedAdd('k1', 'Kasuri methi', p, 2)
    const text = nodesOf(p)[2].instruction
    nodesOf(p)[2].instruction = 'The recipe was rewritten.'
    const res = applyEdits(p, [edit])
    expect(res.statuses.k1).toBe('applied')
    expect(res.added.has('ing_user_k1')).toBe(true)
    expect(rows(res.payload).at(-1)!.name).toBe('Kasuri methi')
    expect(nodesOf(res.payload).some((n) => (n.consumes ?? []).includes('ing_user_k1'))).toBe(false)
    expect(res.linkedSteps.size).toBe(0)
    expect(res.orphans).toHaveLength(1)
    const o = res.orphans[0]
    expect(o.kind).toBe('link')
    expect(o.id).toBe('k1')
    expect(o.label).toBe('Kasuri methi')
    expect(o.importedText).toBe(text)
  })

  it('a malformed step makes the whole add ignored (nothing is guessed)', () => {
    const p = byName('kadhi-pakora')
    const bad = { id: 'k1', created_at: AT, op: 'add_ingredient', value: { name: 'X', amount: null, unit: null, step: { index: 'two' } } }
    const res = applyEdits(p, [bad])
    expect(res.statuses.k1).toBe('ignored')
    expect(rows(res.payload).some((r) => r.name === 'X')).toBe(false)
  })

  it('unlinkAdd rewrites the add with step null and never deletes the ingredient (Q3)', () => {
    const p = byName('kadhi-pakora')
    const edits = [linkedAdd('k1', 'Kasuri methi', p, 2), stepEdit('s1', p, 0, 'Changed.')]
    const next = unlinkAdd(edits, 'k1')
    expect(next).toHaveLength(2)
    const add = next[0] as unknown as { id: string; value: { name: string; step: unknown } }
    expect(add.id).toBe('k1')
    expect(add.value.name).toBe('Kasuri methi')
    expect(add.value.step).toBeNull()
    expect(next[1]).toBe(edits[1])
    expect((edits[0] as unknown as { value: { step: unknown } }).value.step).not.toBeNull()
  })
})

describe('D11: no step edit moves the plan', () => {
  it.each(ALL)('%s: plan, stages, summary and every node field but instruction/consumes are deep-equal', (_name, payload) => {
    const p = structuredClone(payload)
    const at = firstEditable(p)
    const res = applyEdits(p, [stepEdit('s1', p, at, 'Edited step text.'), linkedAdd('k1', 'Zzz', p, at)])
    expect(res.statuses).toEqual({ s1: 'applied', k1: 'applied' })
    expect(structure(res.payload)).toEqual(structure(p))
    const changed = nodesOf(res.payload).filter((n, i) => n.instruction !== nodesOf(p)[i].instruction || JSON.stringify(n.consumes) !== JSON.stringify(nodesOf(p)[i].consumes))
    expect(changed.map((n) => n.id)).toEqual([nodesOf(p)[at].id])
  })

  it.each(ALL)('%s: the scheduler figures drawn on the page are the same before and after', (_name, payload) => {
    const p = structuredClone(payload)
    const at = firstEditable(p)
    const res = applyEdits(p, [stepEdit('s1', p, at, 'Edited step text.')])
    const before = derivePlan(p)
    const after = derivePlan(res.payload)
    const figures = (plan: typeof before) => ({
      stages: plan.stages.map((s) => ({ span: s.span, windows: s.windows.map((w) => [w.usedMin, w.slackMin, w.capacityMin]), tasks: s.inlineTasks.map((t) => [t.nodeId, t.durationTypical]) })),
      savedMin: plan.savedMin,
    })
    expect(figures(after)).toEqual(figures(before))
  })
})

describe('FGC-58: an "Added by ABC Cook" step (committed fixtures)', () => {
  const ADDED_AT = 10
  const text = 'Wipe the pan with a thin film of fat before each batch.'

  it('the fixture has the added step where the tests expect it', () => {
    const p = fgc<RecipePlanResponse>('added.plan-response')
    expect(nodesOf(p)[ADDED_AT].instruction).toBe(text)
    const prov = fgc<GraphProvenance>('added.provenance')
    expect(prov.nodes![nodesOf(p)[ADDED_AT].id].origin).toBe('added')
  })

  it('resolves, edits, and keeps its "Added by ABC Cook" label', () => {
    const p = fgc<RecipePlanResponse>('added.plan-response')
    const prov = fgc<GraphProvenance>('added.provenance')
    const res = applyEdits(p, [stepEdit('s1', p, ADDED_AT, 'Wipe the pan with a thin film of ghee before each batch.')])
    expect(res.statuses.s1).toBe('applied')
    const tasks = derivePlan(res.payload, prov).stages.flatMap((s) => [...s.inlineTasks, ...s.windows.flatMap((w) => w.tasks)])
    const task = tasks.find((t) => t.nodeId === nodesOf(p)[ADDED_AT].id)!
    expect(task.instruction).toBe('Wipe the pan with a thin film of ghee before each batch.')
    expect(task.addedLabel).not.toBeNull()
  })

  it('a refresh that rebuilds the same payload applies the same edit', () => {
    const p = fgc<RecipePlanResponse>('added.plan-response')
    const edit = stepEdit('s1', p, ADDED_AT, 'Changed.')
    const refreshed = fgc<RecipePlanResponse>('added.plan-response')
    expect(applyEdits(refreshed, [edit]).statuses.s1).toBe('applied')
  })

  it.each(['dropped', 'dropped-time'])('%s: the step is gone, so the edit is an orphan and a linked add keeps its row', (name) => {
    const added = fgc<RecipePlanResponse>('added.plan-response')
    const dropped = fgc<RecipePlanResponse>(`${name}.plan-response`)
    expect(nodesOf(dropped)).toHaveLength(nodesOf(added).length - 1)
    const res = applyEdits(dropped, [stepEdit('s1', added, ADDED_AT, 'Changed.'), linkedAdd('k1', 'Ghee', added, ADDED_AT)])
    expect(res.statuses).toEqual({ s1: 'orphaned', k1: 'applied' })
    expect(res.orphans.map((o) => o.kind)).toEqual(['step', 'link'])
    expect(rows(res.payload).at(-1)!.name).toBe('Ghee')
    expect(res.payload.graph.nodes.some((n) => (n.consumes ?? []).includes('ing_user_k1'))).toBe(false)
  })
})
