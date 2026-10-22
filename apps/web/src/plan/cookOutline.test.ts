import { describe, expect, it } from 'vitest'

import type { PlanSummary, RecipePlanResponse, Session } from '@abc-cook/schema'

import { deriveCookOutline, type OutlineInput } from './cookOutline'

const FIXTURES = Object.fromEntries(
  Object.entries(
    import.meta.glob<RecipePlanResponse>('@/__fixtures__/*.plan-response.json', {
      eager: true,
      import: 'default',
    }),
  ).map(([path, payload]) => [path.replace(/^.*\/(.+)\.plan-response\.json$/, '$1'), payload]),
)

function outlineOf(payload: RecipePlanResponse) {
  return deriveCookOutline({
    summary: payload.summary,
    nodes: payload.graph.nodes,
    scheduled: payload.plan.scheduled,
    windows: payload.plan.windows,
    savedMin: payload.plan.saved_min,
  })
}

function outline(name: string) {
  const o = outlineOf(FIXTURES[name])
  expect(o, name).not.toBeNull()
  return o!
}

describe('deriveCookOutline — fixtures (docs/plans/r2-recipe-header.md § 5)', () => {
  it('sabudana', () => {
    const o = outline('sabudana-khichdi')
    expect(o.savedPill).toBe('Saves 13 min')
    expect(o.stretches.map((s) => [s.tag, s.title, s.time, s.taskLines])).toEqual([
      [
        'Now',
        'Soak sabudana → Roast peanuts → Make chutney',
        '20–30 min',
        ['Meanwhile: Grind peanuts'],
      ],
      ['Then', 'Stir once → Serve with chutney', '45–70 min', []],
    ])
    expect(o.waits).toEqual([{ text: 'Hands free for ~1 hr 45 min', barLabel: '~1 hr 45 min' }])
    expect(o.stretches.map((s) => s.barWeight)).toEqual([18, 45])
    expect(o.card?.detail).toBe("You're free for most of it: one long break, about 1 hr 45 min.")
    expect(o.card?.readyInMin).toBeGreaterThan(0)
    expect(o.ctaSubline).toBe('First stretch: about 20–30 min.')
  })

  it('donuts: two stretches, one wait — the frying gap is not split', () => {
    const o = outline('homemade-donuts')
    expect(o.savedPill).toBe('Saves 15 min')
    expect(o.stretches.map((s) => [s.tag, s.title, s.time])).toEqual([
      ['Now', 'Bloom yeast → Grease tray', '20–35 min'],
      ['Then', 'Roll and cut → Glaze donuts', '60–75 min'],
    ])
    expect(o.waits).toEqual([{ text: 'Hands free for ~55 min', barLabel: '~55 min' }])
    expect(o.card?.detail).toBe("You're free for most of it: one long break, about 55 min.")
    expect(o.card?.readyInMin).toBeGreaterThan(0)
    expect(o.ctaSubline).toBe('First stretch: about 20–35 min.')
  })

  it('donuts: Grease tray is in the title, so the first stretch has no task line', () => {
    expect(outline('homemade-donuts').stretches[0].taskLines).toEqual([])
  })

  it('pizza', () => {
    const o = outline('pizza-dough')
    expect(o.savedPill).toBeNull()
    expect(o.stretches.map((s) => [s.tag, s.title, s.time])).toEqual([
      ['Now', 'Small bowl stir together → Cover the bowl', '~10 min'],
      ['Then', 'Transfer dough → Cover and refrigerate overnight', '~10 min'],
      ['Then', 'Remove the dough', null],
      ['Then', 'Place a pizza stone → Transfer the pizza', '40–60 min'],
    ])
    expect(o.waits.map((w) => w.text)).toEqual([
      'Come back ~4 hr 30 min later',
      'Come back ~18 hr later',
      'Hands free for ~1 hr',
    ])
    expect(o.waits.map((w) => w.barLabel)).toEqual(['~4 hr 30 min', '~18 hr', '~1 hr'])
    expect(o.card?.detail).toBe("You're free for most of it: 3 long breaks, the longest about 18 hr.")
    expect(o.card?.readyInMin).toBeGreaterThan(0)
    expect(o.ctaSubline).toBe('First stretch: about 10 min.')
  })

  it('kadai: one solid stretch, no wait, periodic lead on the task line', () => {
    const o = outline('kadai-paneer')
    expect(o.savedPill).toBe('Saves 9 min')
    expect(o.waits).toEqual([])
    expect(o.card).toBeNull()
    expect(o.ctaSubline).toBe('Start to finish in one go.')
    expect(o.stretches).toEqual([
      {
        tag: 'Now',
        title: 'Chop onion → Finish',
        time: '35–50 min',
        barWeight: 34,
        taskLines: ['While checking the pan now and then: Cube capsicum, Cube paneer +1 more'],
      },
    ])
  })

  it('rajma (synthetic two sittings)', () => {
    const o = outline('synthetic-two-sittings')
    expect(o.savedPill).toBeNull()
    expect(o.stretches.map((s) => [s.tag, s.title, s.time])).toEqual([
      ['Now', 'Rinse beans → Soak beans', '~3 min'],
      ['Then', 'Saute and add beans → Serve', '50–60 min'],
    ])
    expect(o.waits).toEqual([{ text: 'Come back ~8 hr later', barLabel: '~8 hr' }])
    expect(o.card?.detail).toBe("You're free for most of it: one long break, about 8 hr.")
    expect(o.card?.readyInMin).toBeGreaterThan(0)
    expect(o.ctaSubline).toBe('First stretch: about 3 min.')
  })
})

describe('deriveCookOutline — missing data', () => {
  it('returns null for a null summary or null phases', () => {
    const base = FIXTURES['sabudana-khichdi']
    expect(outlineOf({ ...base, summary: null })).toBeNull()
    expect(outlineOf({ ...base, summary: { ...base.summary!, phases: null } })).toBeNull()
  })
})

describe('deriveCookOutline — every fixture', () => {
  const all = Object.entries(FIXTURES).map(([name, payload]) => [name, outlineOf(payload)] as const)

  it('has phases for every fixture', () => {
    for (const [name, o] of all) expect(o, name).not.toBeNull()
  })

  it('never lists tasks on a wait, and never says phase, session or hands free on a stretch', () => {
    for (const [name, o] of all) {
      for (const wait of o!.waits) expect(Object.keys(wait).sort(), name).toEqual(['barLabel', 'text'])
      const strings = [
        ...o!.stretches.flatMap((s) => [s.title, s.time ?? '', s.tag, ...s.taskLines]),
        ...o!.waits.flatMap((w) => [w.text, w.barLabel]),
        o!.savedPill ?? '',
        o!.card?.detail ?? '',
        o!.ctaSubline,
      ]
      for (const str of strings) expect(str, name).not.toMatch(/phase|session/i)
      for (const s of o!.stretches) {
        for (const str of [s.title, s.time ?? '', ...s.taskLines]) expect(str, name).not.toMatch(/hands free/i)
      }
    }
  })

  it('shows every window task in exactly one stretch (task line, title, or +N more)', () => {
    for (const [name, payload] of Object.entries(FIXTURES)) {
      const o = outlineOf(payload)!
      const label = new Map(payload.graph.nodes.map((n) => [n.id, n.label]))
      const phases = payload.summary!.phases!
      for (const window of payload.plan.windows) {
        for (const id of window.assigned) {
          const owners = phases.map((p, i) => [p, i] as const).filter(([p]) => p.node_ids.includes(id))
          expect(owners.length, `${name}/${id} belongs to one stretch`).toBe(1)
          const stretch = o.stretches[owners[0][1]]
          const shown =
            stretch.taskLines.some((line) => line.includes(label.get(id)!)) ||
            stretch.title.split(' → ').includes(label.get(id)!)
          const counted = stretch.taskLines.some((line) => /\+\d+ more$/.test(line))
          expect(shown || counted, `${name}/${id}`).toBe(true)
        }
      }
    }
  })

  it('orders each task line by start_min, non-decreasing', () => {
    for (const [name, payload] of Object.entries(FIXTURES)) {
      const o = outlineOf(payload)!
      const start = new Map(payload.plan.scheduled.map((s) => [s.node_id, s.start_min]))
      const idsByLabel = new Map<string, string[]>()
      for (const n of payload.graph.nodes) idsByLabel.set(n.label, [...(idsByLabel.get(n.label) ?? []), n.id])
      for (const stretch of o.stretches) {
        for (const line of stretch.taskLines) {
          const names = line
            .replace(/^(Meanwhile|While [^:]+):\s*/, '')
            .replace(/ \+\d+ more$/, '')
            .split(', ')
          const starts = names.map((l) => Math.min(...idsByLabel.get(l)!.map((id) => start.get(id)!)))
          expect(starts, `${name}: ${line}`).toEqual([...starts].sort((a, b) => a - b))
        }
      }
    }
  })

  it('splits a window across stretches: a task moved into phase 2 appears only there', () => {
    const base = structuredClone(FIXTURES['sabudana-khichdi'])
    const [p0, p1] = base.summary!.phases!
    const moved = 'step_dry_roast_1_cup_raw_peanuts'
    p0.node_ids = p0.node_ids.filter((id) => id !== moved)
    p1.node_ids = [...p1.node_ids, moved]
    const o = outlineOf(base)!
    expect(o.stretches[0].taskLines).toEqual(['Meanwhile: Grind peanuts'])
    expect(o.stretches[1].taskLines).toEqual(['Meanwhile: Roast peanuts'])
  })

  it('O2: a zero-length stretch has no time (never "~0 min"); its neighbours keep theirs', () => {
    const o = deriveCookOutline(
      synthetic([
        { lo: 10, hi: 12 },
        { lo: 0, hi: 0, waitBefore: 60 },
        { lo: 30, hi: 40, waitBefore: 60 },
      ]),
    )!
    expect(o.stretches.map((s) => s.time)).toEqual(['~10 min', null, '30–40 min'])
    for (const s of o.stretches) expect(s.time ?? '').not.toMatch(/~0|about 0/)
  })

  it('O1: N sittings is summary.sessions.length, and only when there is more than one', () => {
    // Four stretches in three sittings: the last gap does not start a new sitting.
    const input = synthetic([
      { lo: 10, hi: 12 },
      { lo: 10, hi: 15, waitBefore: 270, newSitting: true },
      { lo: 10, hi: 12, waitBefore: 1080, newSitting: true },
      { lo: 30, hi: 40, waitBefore: 60 },
    ])
    expect(input.summary!.phases!.length).toBe(4)
    expect(input.summary!.sessions.length).toBe(3)
    expect(deriveCookOutline(input)!.card!.detail).toBe("You're free for most of it: 3 long breaks, the longest about 18 hr.")

    // One sitting: N breaks and the longest (1080 min = 18 hr), not "spans 4 sittings".
    input.summary!.sessions = input.summary!.sessions.slice(0, 1)
    for (const p of input.summary!.phases!) p.starts_new_session = false
    expect(deriveCookOutline(input)!.card!.detail).toBe("You're free for most of it: 3 long breaks, the longest about 18 hr.")
  })
})

describe('deriveCookOutline — Meanwhile never lists a prerequisite of the title', () => {
  const first = (i: OutlineInput) => deriveCookOutline(i)!.stretches[0]

  it('chain prerequisite folds into the title; an unrelated task stays under Meanwhile', () => {
    const s = first(
      syntheticStretch({
        nodes: [{ id: 'S' }, { id: 'A' }, { id: 'B' }, { id: 'C', deps: ['A'] }],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.title).toBe('S → A → C')
    expect(s.taskLines).toEqual(['Meanwhile: B'])
  })

  it('transitive prerequisites fold in dependency order, leaving no task line', () => {
    const s = first(
      syntheticStretch({
        nodes: [{ id: 'S' }, { id: 'A' }, { id: 'B', deps: ['A'] }, { id: 'C', deps: ['B'] }],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.title).toBe('S → A → B → C')
    expect(s.taskLines).toEqual([])
  })

  it('truly parallel tasks are unchanged', () => {
    const s = first(
      syntheticStretch({
        nodes: [{ id: 'S' }, { id: 'A' }, { id: 'B' }, { id: 'C' }],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.title).toBe('S → C')
    expect(s.taskLines).toEqual(['Meanwhile: A, B'])
  })

  it('a non-window main-line sink keeps its inputs under Meanwhile', () => {
    const s = first(
      syntheticStretch({
        nodes: [{ id: 'S' }, { id: 'A' }, { id: 'B' }, { id: 'Z', deps: ['A', 'B'] }],
        window: ['A', 'B'],
      }),
    )
    expect(s.title).toBe('S → Z')
    expect(s.taskLines).toEqual(['Meanwhile: A, B'])
  })

  it('mixed: the ancestor folds, independent tasks list in start order', () => {
    const s = first(
      syntheticStretch({
        nodes: [
          { id: 'S' },
          { id: 'X' },
          { id: 'A' },
          { id: 'Y' },
          { id: 'C', deps: ['A'] },
        ],
        window: ['X', 'A', 'Y', 'C'],
      }),
    )
    expect(s.title).toBe('S → A → C')
    expect(s.taskLines).toEqual(['Meanwhile: X, Y'])
  })

  it('all candidates filtered: no task line at all', () => {
    const s = first(
      syntheticStretch({
        nodes: [{ id: 'S' }, { id: 'A' }, { id: 'B' }, { id: 'C', deps: ['A', 'B'] }],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.title).toBe('S → A → B → C')
    expect(s.taskLines).toEqual([])
  })

  it('the cap counts the post-filter list', () => {
    const s = first(
      syntheticStretch({
        nodes: [
          { id: 'S' },
          { id: 'A' },
          { id: 'W' },
          { id: 'X' },
          { id: 'Y' },
          { id: 'Z' },
          { id: 'C', deps: ['A'] },
        ],
        window: ['A', 'W', 'X', 'Y', 'Z', 'C'],
      }),
    )
    expect(s.title).toBe('S → A → C')
    expect(s.taskLines).toEqual(['Meanwhile: W, X +2 more'])
  })

  it('equal start_min ties break by the window’s assigned order', () => {
    const s = first(
      syntheticStretch({
        nodes: [
          { id: 'S' },
          { id: 'B', start: 5 },
          { id: 'A', start: 5 },
          { id: 'C' },
        ],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.taskLines).toEqual(['Meanwhile: A, B'])
  })

  it('a dependent pair under Meanwhile lists the prerequisite first', () => {
    const s = first(
      syntheticStretch({
        nodes: [
          { id: 'S' },
          { id: 'B', deps: ['A'], start: 2 },
          { id: 'A', start: 1 },
          { id: 'C' },
        ],
        window: ['A', 'B', 'C'],
      }),
    )
    expect(s.title).toBe('S → C')
    expect(s.taskLines).toEqual(['Meanwhile: A, B'])
  })
})

/**
 * One stretch, one window. `nodes` are in phase order: the first is the stretch's first node,
 * the last its last; `window` lists the window's assigned ids. Labels are the ids.
 */
function syntheticStretch(spec: {
  nodes: { id: string; deps?: string[]; start?: number }[]
  window: string[]
}): OutlineInput {
  const nodes = spec.nodes.map((n) => ({
    id: n.id,
    label: n.id,
    attention: 'unattended' as const,
    depends_on: n.deps ?? [],
  }))
  const summary = {
    active_min: 0,
    attended_min: 0,
    elapsed_min: 50,
    elapsed_high_min: 50,
    long_waits: [],
    phases: [
      {
        start_min: 0,
        end_min: 1000,
        active_min: 10,
        node_ids: nodes.map((n) => n.id),
        preceded_by_wait_min: null,
        elapsed_min: 50,
        elapsed_high_min: 50,
        preceded_by_host_node_ids: [],
        starts_new_session: false,
      },
    ],
    sessions: [{} as Session],
  } as PlanSummary
  return {
    summary,
    nodes,
    scheduled: spec.nodes.map((n, i) => ({ node_id: n.id, start_min: n.start ?? i })),
    windows: [{ host_node_id: nodes[0].id, assigned: spec.window }],
    savedMin: 0,
  }
}

/** A made-up plan: node ids and titles are invented, so a rule test never depends on a recipe. */
function synthetic(
  stretches: { lo: number; hi: number; waitBefore?: number; newSitting?: boolean }[],
): OutlineInput {
  const nodes = stretches.map((_, i) => ({ id: `n${i}`, label: `Step ${i}`, attention: 'unattended' as const, depends_on: [] as string[] }))
  const phases = stretches.map((s, i) => ({
    start_min: i * 100,
    end_min: i * 100 + s.lo,
    active_min: s.lo,
    node_ids: [`n${i}`],
    preceded_by_wait_min: s.waitBefore ?? null,
    elapsed_min: s.lo,
    elapsed_high_min: s.hi,
    preceded_by_host_node_ids: i === 0 ? [] : [`n${i - 1}`],
    starts_new_session: s.newSitting ?? false,
  }))
  const sessions = stretches.filter((s, i) => i === 0 || s.newSitting).map(() => ({}) as Session)
  const summary = {
    active_min: 0,
    attended_min: 0,
    elapsed_min: 100,
    elapsed_high_min: 100,
    long_waits: [],
    phases,
    sessions,
  } as PlanSummary
  return {
    summary,
    nodes,
    scheduled: nodes.map((n, i) => ({ node_id: n.id, start_min: i * 100 })),
    windows: [],
    savedMin: 0,
  }
}


// Widened golden corpus (docs/plans/golden-corpus-widen.md): real imports, reviewed 2026-10-16.
// Only lines that are right are pinned. Stretch times, the saved pill and Meanwhile lines are
// left out where a flagged follow-up (docs/plans/followup-golden-corpus.md: FGC-4, 5, 6, 7) would
// change them, so a fix to those is not a broken test.
describe('deriveCookOutline — widened corpus', () => {
  it('croissant: three stated one-hour waits split four stretches, with a plan-ahead card', () => {
    const o = outline('croissant')
    expect(o.stretches.map((s) => [s.tag, s.title])).toEqual([
      ['Now', 'Mix yeast → Rest dough'],
      ['Then', 'Turn out dough → Chill'],
      ['Then', 'Roll rectangle → Proof again'],
      ['Then', 'Egg wash → Bake'],
    ])
    expect(o.waits).toEqual(Array(3).fill({ text: 'Hands free for ~1 hr', barLabel: '~1 hr' }))
    expect(o.savedPill).toBeNull()
    expect(o.stretches.flatMap((s) => s.taskLines)).toEqual([])
    expect(o.card?.detail).toBe("You're free for most of it: 3 long breaks, the longest about 1 hr.")
    expect(o.card?.readyInMin).toBeGreaterThan(0)
  })

  it('kadhi pakora: one stretch from the base to serving, no wait, no plan-ahead card', () => {
    const o = outline('kadhi-pakora')
    expect(o.stretches.map((s) => [s.tag, s.title])).toEqual([['Now', 'Mix kadi → Serve']])
    expect(o.waits).toEqual([])
    expect(o.card).toBeNull()
    expect(o.ctaSubline).toBe('Start to finish in one go.')
  })

  it('pumpkin pancakes: one stretch that starts with mixing, nothing saved, no card', () => {
    const o = outline('pumpkin-pancakes')
    expect(o.stretches).toHaveLength(1)
    expect(o.stretches[0].tag).toBe('Now')
    expect(o.stretches[0].title.startsWith('Mix pumpkin → ')).toBe(true)
    expect(o.stretches[0].taskLines).toEqual([])
    expect(o.waits).toEqual([])
    expect(o.savedPill).toBeNull()
    expect(o.card).toBeNull()
    expect(o.ctaSubline).toBe('Start to finish in one go.')
  })
})
