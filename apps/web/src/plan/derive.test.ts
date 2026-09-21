import { describe, expect, it } from 'vitest'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan } from './derive'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

// Fixtures are real scheduler output, frozen by apps/api/scripts/export_web_fixtures.py.
const KADAI = kadaiPaneer as RecipePlanResponse
const MAGGI = maggi as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const DONUTS = homemadeDonuts as RecipePlanResponse
const SHORTCAKE = strawberryShortcake as RecipePlanResponse
const PIZZA = pizzaDough as RecipePlanResponse
const TWO_SITTINGS = syntheticTwoSittings as RecipePlanResponse
const TWO_WINDOWS = syntheticTwoWindows as RecipePlanResponse

const ALL_FIXTURES = [KADAI, MAGGI, BIRYANI, DONUTS, SHORTCAKE, PIZZA, TWO_SITTINGS, TWO_WINDOWS]

describe('derivePlan — Kadai Paneer', () => {
  const plan = derivePlan(KADAI)

  it('carries the headline numbers straight from the plan', () => {
    expect(plan.totalMin).toBe(KADAI.plan.total_min)
    expect(plan.serialMin).toBe(KADAI.plan.serial_min)
    expect(plan.savedMin).toBe(KADAI.plan.saved_min)
    expect(plan.savedMin).toBe(9)
  })

  it('lists stages in graph order, skipping empty ones', () => {
    expect(plan.stages.map((s) => s.stageId)).toEqual([
      'prep',
      'cook_base',
      'add_veggies',
      'finish',
    ])
  })

  it('moves the three windowed prep tasks out of Prep and under Cook Base', () => {
    const prep = plan.stages.find((s) => s.stageId === 'prep')!
    const cookBase = plan.stages.find((s) => s.stageId === 'cook_base')!

    // Prep keeps only the two tasks that must finish before the base starts.
    expect(prep.inlineTasks.map((t) => t.nodeId)).toEqual(['chop_onion', 'chop_tomato'])
    expect(prep.windows).toHaveLength(0)

    // The relocation — the entire pitch of the product — lands on Cook Base's window.
    expect(cookBase.windows).toHaveLength(1)
    expect(cookBase.windows[0].tasks.map((t) => t.nodeId)).toEqual([
      'chop_capsicum',
      'cube_paneer',
      'make_kadai_masala',
    ])
  })

  it('produces the design copy "9 min prep · fits in 12 min" from data', () => {
    const window = plan.stages.find((s) => s.stageId === 'cook_base')!.windows[0]
    expect(window.usedMin).toBe(9)
    expect(window.hostDurationTypical).toBe(12)
    expect(window.slackMin).toBe(0)
  })

  it('ranks the window tasks, rank 0 first', () => {
    const tasks = plan.stages.find((s) => s.stageId === 'cook_base')!.windows[0].tasks
    expect(tasks.map((t) => t.rankInWindow)).toEqual([0, 1, 2])
    expect(tasks[0].label).toBe('Cube capsicum')
  })

  it('tints borrowed tasks with their home stage, not the host stage', () => {
    const tasks = plan.stages.find((s) => s.stageId === 'cook_base')!.windows[0].tasks
    // All three are prep nodes, so their tint index is 0 (Prep), not 1 (Cook Base).
    expect(tasks.every((t) => t.homeStageIndex === 0)).toBe(true)
  })

  it('never invents a number — every minute value appears in the source payload', () => {
    const fromSource = new Set<number>([
      KADAI.plan.total_min,
      KADAI.plan.serial_min,
      KADAI.plan.saved_min,
      ...KADAI.plan.windows.flatMap((w) => [w.used_min, w.slack_min, w.capacity_min]),
      ...KADAI.graph.nodes.map((n) => n.duration_typical),
    ])
    for (const stage of plan.stages) {
      for (const window of stage.windows) {
        expect(fromSource).toContain(window.usedMin)
        expect(fromSource).toContain(window.slackMin)
        expect(fromSource).toContain(window.hostDurationTypical)
      }
    }
  })
})

describe('derivePlan — hasUnattendedWork (A7)', () => {
  it('is true when the graph has an unattended or periodic node', () => {
    expect(derivePlan(KADAI).hasUnattendedWork).toBe(true) // kadai-paneer has a periodic node
    expect(derivePlan(MAGGI).hasUnattendedWork).toBe(true) // maggi-2min has both
  })

  it('is false when every node is hands_on', () => {
    const allHandsOn: RecipePlanResponse = {
      ...MAGGI,
      graph: {
        ...MAGGI.graph,
        nodes: MAGGI.graph.nodes.map((n) => ({ ...n, attention: 'hands_on' as const })),
      },
    }
    expect(derivePlan(allHandsOn).hasUnattendedWork).toBe(false)
  })
})

describe('derivePlan — Maggi (nothing to parallelise)', () => {
  const plan = derivePlan(MAGGI)

  it('shows no windows and drops nothing', () => {
    expect(plan.savedMin).toBe(0)
    expect(plan.stages.flatMap((s) => s.windows)).toHaveLength(0)

    const placed = plan.stages.flatMap((s) => s.inlineTasks.map((t) => t.nodeId))
    expect(placed.sort()).toEqual(MAGGI.graph.nodes.map((n) => n.id).sort())
  })
})

describe('derivePlan — host node backs exactly one row and one window', () => {
  it('every window\'s hostNodeId appears in its owning stage\'s inlineTasks exactly once', () => {
    // The UI renders the host as an ordinary TaskRow and, right after it, the
    // WaitWindowBlock for the window it hosts — both addressed by this same id.
    for (const payload of [KADAI, BIRYANI]) {
      const plan = derivePlan(payload)
      for (const stage of plan.stages) {
        for (const window of stage.windows) {
          const matches = stage.inlineTasks.filter((t) => t.nodeId === window.hostNodeId)
          expect(matches).toHaveLength(1)
        }
      }
    }
  })
})

describe('derivePlan — Chicken Biryani (two windows)', () => {
  const plan = derivePlan(BIRYANI)

  it('attaches every window to the stage of its host node', () => {
    const windows = plan.stages.flatMap((s) =>
      s.windows.map((w) => ({ stageOfBlock: s.stageId, host: w.hostNodeId })),
    )
    expect(windows.length).toBe(BIRYANI.plan.windows.length)
    for (const { stageOfBlock, host } of windows) {
      const hostNode = BIRYANI.graph.nodes.find((n) => n.id === host)!
      expect(hostNode.stage).toBe(stageOfBlock)
    }
  })

  it('places each node exactly once across inline lists and windows', () => {
    const seen = plan.stages.flatMap((s) => [
      ...s.inlineTasks.map((t) => t.nodeId),
      ...s.windows.flatMap((w) => w.tasks.map((t) => t.nodeId)),
    ])
    expect(seen.length).toBe(new Set(seen).size)
    expect(seen.sort()).toEqual(BIRYANI.graph.nodes.map((n) => n.id).sort())
  })

  it('surfaces the burner warning verbatim', () => {
    expect(plan.warnings.join(' ')).toContain('uses 2 burners')
  })
})

describe('derivePlan — durationProvenance (C2)', () => {
  it('is null on every task when no provenance is supplied', () => {
    const plan = derivePlan(KADAI)
    const allTasks = plan.stages.flatMap((s) => [
      ...s.inlineTasks,
      ...s.windows.flatMap((w) => w.tasks),
    ])
    expect(allTasks.length).toBeGreaterThan(0)
    expect(allTasks.every((t) => t.durationProvenance === null)).toBe(true)
  })

  it('looks up the marked node by id and leaves the rest null, given a provenance record', () => {
    const provenance: GraphProvenance = {
      nodes: {
        cook_tomato_base: { fields: { duration: 'inferred' } },
      },
    }
    const plan = derivePlan(KADAI, provenance)
    const allTasks = plan.stages.flatMap((s) => [
      ...s.inlineTasks,
      ...s.windows.flatMap((w) => w.tasks),
    ])
    const marked = allTasks.find((t) => t.nodeId === 'cook_tomato_base')!
    expect(marked.durationProvenance).toBe('inferred')
    for (const task of allTasks) {
      if (task.nodeId === 'cook_tomato_base') continue
      expect(task.durationProvenance).toBeNull()
    }
  })
})

describe('derivePlan — ingredient grouping', () => {
  it('collapses an entirely ungrouped list into a single null group', () => {
    // All three of Maggi's ingredients arrive with no group. Grouping them together is
    // what the old NUL-byte sentinel was for; `null` as a Map key does it directly.
    const groups = derivePlan(MAGGI).ingredientGroups
    expect(groups).toHaveLength(1)
    expect(groups[0].group).toBeNull()
    expect(groups[0].items).toHaveLength(MAGGI.graph.ingredients.length)
  })

  it('keeps first-appearance order and rejoins non-contiguous groups', () => {
    // "For the base" appears at indices 0-1 and again at 5-6 with two other groups in
    // between, so this only passes if grouping is keyed rather than run-length.
    const groups = derivePlan(KADAI).ingredientGroups
    expect(groups.map((g) => g.group)).toEqual([
      'For the base',
      'For the kadai',
      'For the kadai masala',
      null,
    ])
    expect(groups[0].items.map((i) => i.name)).toEqual([
      'Onion',
      'Tomato',
      'Ginger-garlic paste',
      'Oil',
    ])
  })

  it('loses no ingredient, in any fixture', () => {
    for (const payload of [KADAI, MAGGI, BIRYANI]) {
      const flat = derivePlan(payload).ingredientGroups.flatMap((g) => g.items)
      expect(flat).toHaveLength(payload.graph.ingredients.length)
    }
  })
})

describe('derivePlan — summary passthrough (M3.2)', () => {
  it('carries the payload summary verbatim', () => {
    expect(derivePlan(KADAI).summary).toEqual(KADAI.summary)
  })

  it('is null when the payload gives no summary (a pre-M3.1 save)', () => {
    const legacy: RecipePlanResponse = { ...MAGGI, summary: undefined }
    expect(derivePlan(legacy).summary).toBeNull()
  })
})

describe('derivePlan — RenderTask.tip (M3.2)', () => {
  it('is null on every task when the graph gives no tip', () => {
    const plan = derivePlan(KADAI)
    const allTasks = plan.stages.flatMap((s) => [
      ...s.inlineTasks,
      ...s.windows.flatMap((w) => w.tasks),
    ])
    expect(allTasks.length).toBeGreaterThan(0)
    expect(allTasks.every((t) => t.tip === null)).toBe(true)
  })

  it('carries a node\'s tip verbatim and leaves the rest null', () => {
    const withTip: RecipePlanResponse = {
      ...KADAI,
      graph: {
        ...KADAI.graph,
        nodes: KADAI.graph.nodes.map((n) =>
          n.id === 'cook_tomato_base' ? { ...n, tip: 'Keep the flame low.' } : n,
        ),
      },
    }
    const allTasks = derivePlan(withTip).stages.flatMap((s) => [
      ...s.inlineTasks,
      ...s.windows.flatMap((w) => w.tasks),
    ])
    const marked = allTasks.find((t) => t.nodeId === 'cook_tomato_base')!
    expect(marked.tip).toBe('Keep the flame low.')
    for (const task of allTasks) {
      if (task.nodeId === 'cook_tomato_base') continue
      expect(task.tip).toBeNull()
    }
  })
})

describe('derivePlan — RenderStage.ingredients (M3.2)', () => {
  it("groups Kadai's Prep ingredients by home stage, including the three nodes windowed away into Cook Base", () => {
    const prep = derivePlan(KADAI).stages.find((s) => s.stageId === 'prep')!
    // chop_capsicum / cube_paneer / make_kadai_masala are rendered under Cook Base's
    // window, but their ingredients still belong to Prep — the stage that actually
    // uses them, not wherever the scheduler happened to place the task.
    expect(prep.ingredients.map((i) => i.name)).toEqual([
      'Onion',
      'Tomato',
      'Capsicum',
      'Paneer',
      'Kadai masala whole spices',
    ])
  })

  it("excludes component ids from Cook Base's ingredients — only real graph ingredients ever appear", () => {
    const cookBase = derivePlan(KADAI).stages.find((s) => s.stageId === 'cook_base')!
    // saute_onion and cook_tomato_base also consume comp_onion_chopped,
    // comp_onion_sauteed and comp_tomato_chopped — none of those are `Ingredient`
    // ids, so none of them can appear here.
    expect(cookBase.ingredients.map((i) => i.name)).toEqual(['Ginger-garlic paste', 'Oil', 'Salt'])
  })

  it('never invents an ingredient — every stage list is a subset of the graph list, in graph order', () => {
    for (const payload of ALL_FIXTURES) {
      const plan = derivePlan(payload)
      const order = new Map(payload.graph.ingredients.map((ing, i) => [ing.id, i]))
      for (const stage of plan.stages) {
        const indices = stage.ingredients.map((ing) => order.get(ing.id)!)
        expect([...indices].sort((a, b) => a - b)).toEqual(indices)
      }
    }
  })
})

describe('derivePlan — waitRows (M3.2)', () => {
  it('produces no wait row for a single-sitting fixture', () => {
    for (const payload of [KADAI, MAGGI, BIRYANI, DONUTS, SHORTCAKE, TWO_WINDOWS]) {
      expect(derivePlan(payload).waitRows).toEqual([])
    }
  })

  it("produces exactly one wait row for the synthetic two-sittings fixture, identifying 'Soak beans'", () => {
    const plan = derivePlan(TWO_SITTINGS)
    expect(plan.waitRows).toHaveLength(1)
    const [row] = plan.waitRows
    expect(row.hostLabels).toEqual(['Soak beans'])
    expect(row.waitMin).toBe(480)
    // Placed between the Soak stage and the Cook stage — the only rendered split
    // that doesn't straddle the sitting boundary.
    const soakIndex = plan.stages.findIndex((s) => s.stageId === 'soak')
    expect(row.afterStageIndex).toBe(soakIndex)
  })

  it('produces no wait row for pizza dough — every rendered stage straddles both sitting boundaries', () => {
    const plan = derivePlan(PIZZA)
    expect(plan.stages.length).toBeGreaterThan(1)
    expect(plan.waitRows).toEqual([])
  })

  it('drops a boundary when a rendered stage straddles it, even with otherwise-clean neighbours', () => {
    // "cross" belongs to the Cook stage's own home (`Node.stage`) but is scheduled
    // in session 0, alongside Prep — so Cook's rendered node ids span both sides of
    // the only boundary, and the whole row must be dropped rather than guessed at.
    const graph = {
      id: 'straddle-test',
      title: 'Straddle test',
      servings: 1,
      cuisine: null,
      source: { kind: 'text', value: 'inline test fixture, not a real recipe', imported_at: '2026-01-01T00:00:00Z' },
      ingredients: [],
      stages: [
        { id: 'prep', label: 'Prep', color_key: 'prep' },
        { id: 'cook', label: 'Cook', color_key: 'cook' },
      ],
      nodes: [
        { id: 'chop', stage: 'prep', label: 'Chop', instruction: '', kind: 'prep', attention: 'hands_on', duration_min: 5, duration_typical: 5, duration_max: 5, station: 'counter', depends_on: [], interruptible: true },
        { id: 'cross', stage: 'cook', label: 'Cross', instruction: '', kind: 'prep', attention: 'hands_on', duration_min: 3, duration_typical: 3, duration_max: 3, station: 'counter', depends_on: [], interruptible: true },
        { id: 'finish', stage: 'cook', label: 'Finish', instruction: '', kind: 'finish', attention: 'hands_on', duration_min: 5, duration_typical: 5, duration_max: 5, station: 'counter', depends_on: [], interruptible: true },
      ],
      stated_total_min: null,
    }
    const payload = {
      graph,
      plan: {
        graph_id: 'straddle-test',
        scheduled: [
          { node_id: 'chop', start_min: 0, end_min: 5, occupies_cook: true, window_id: null, rank_in_window: null },
          { node_id: 'cross', start_min: 5, end_min: 8, occupies_cook: true, window_id: null, rank_in_window: null },
          { node_id: 'finish', start_min: 500, end_min: 505, occupies_cook: true, window_id: null, rank_in_window: null },
        ],
        windows: [],
        total_min: 505,
        serial_min: 13,
        saved_min: -492,
        critical_path: ['chop', 'cross', 'finish'],
        warnings: [],
      },
      stages: [
        { stage_id: 'prep', start_min: 0, end_min: 5, elapsed_min: 5, work_min: 5, windowed_work_min: 0, inline_work_min: 5, node_ids: ['chop'] },
        { stage_id: 'cook', start_min: 5, end_min: 505, elapsed_min: 500, work_min: 8, windowed_work_min: 0, inline_work_min: 8, node_ids: ['cross', 'finish'] },
      ],
      summary: {
        active_min: 13,
        attended_min: 13,
        elapsed_min: 505,
        elapsed_high_min: 505,
        long_waits: [],
        sessions: [
          { start_min: 0, end_min: 8, active_min: 8, node_ids: ['chop', 'cross'], preceded_by_wait_min: null, elapsed_min: 8, elapsed_high_min: 8, preceded_by_host_node_ids: [] },
          { start_min: 500, end_min: 505, active_min: 5, node_ids: ['finish'], preceded_by_wait_min: 492, elapsed_min: 5, elapsed_high_min: 5, preceded_by_host_node_ids: ['cross'] },
        ],
      },
    } as unknown as RecipePlanResponse

    expect(derivePlan(payload).waitRows).toEqual([])
  })

  it("uses rendered membership, not a node's home stage, to place a wait row (a windowed task moves with its host)", () => {
    // `borrowed`'s home stage is Prep, but it is windowed into Cook's own wait window
    // and rendered there. Home-stage classification would see Prep as straddling
    // (chop in session 0, borrowed in session 1) and drop the row; rendered-membership
    // classification sees Prep as session-0-only (just `chop`) and Cook as
    // session-1-only (`host` + the borrowed `cube`), so the boundary is clean.
    const graph = {
      id: 'rendered-membership-test',
      title: 'Rendered membership test',
      servings: 1,
      cuisine: null,
      source: { kind: 'text', value: 'inline test fixture, not a real recipe', imported_at: '2026-01-01T00:00:00Z' },
      ingredients: [],
      stages: [
        { id: 'prep', label: 'Prep', color_key: 'prep' },
        { id: 'cook', label: 'Cook', color_key: 'cook' },
      ],
      nodes: [
        { id: 'chop', stage: 'prep', label: 'Chop', instruction: '', kind: 'prep', attention: 'hands_on', duration_min: 5, duration_typical: 5, duration_max: 5, station: 'counter', depends_on: [], interruptible: true },
        { id: 'host', stage: 'cook', label: 'Simmer', instruction: '', kind: 'passive', attention: 'unattended', duration_min: 30, duration_typical: 30, duration_max: 30, station: 'burner', depends_on: [], interruptible: true },
        { id: 'cube', stage: 'prep', label: 'Cube potato', instruction: '', kind: 'prep', attention: 'hands_on', duration_min: 4, duration_typical: 4, duration_max: 4, station: 'counter', depends_on: [], interruptible: true },
      ],
      stated_total_min: null,
    }
    const payload = {
      graph,
      plan: {
        graph_id: 'rendered-membership-test',
        scheduled: [
          { node_id: 'chop', start_min: 0, end_min: 5, occupies_cook: true, window_id: null, rank_in_window: null },
          { node_id: 'host', start_min: 500, end_min: 530, occupies_cook: false, window_id: null, rank_in_window: null },
          { node_id: 'cube', start_min: 500, end_min: 504, occupies_cook: true, window_id: 'w1', rank_in_window: 0 },
        ],
        windows: [
          { id: 'w1', host_node_id: 'host', assigned: ['cube'], used_min: 4, slack_min: 26, capacity_min: 30 },
        ],
        total_min: 530,
        serial_min: 39,
        saved_min: -491,
        critical_path: ['chop', 'host'],
        warnings: [],
      },
      stages: [
        { stage_id: 'prep', start_min: 0, end_min: 504, elapsed_min: 504, work_min: 9, windowed_work_min: 4, inline_work_min: 5, node_ids: ['chop', 'cube'] },
        { stage_id: 'cook', start_min: 500, end_min: 530, elapsed_min: 30, work_min: 30, windowed_work_min: 0, inline_work_min: 30, node_ids: ['host'] },
      ],
      summary: {
        active_min: 9,
        attended_min: 9,
        elapsed_min: 530,
        elapsed_high_min: 530,
        long_waits: [],
        sessions: [
          { start_min: 0, end_min: 5, active_min: 5, node_ids: ['chop'], preceded_by_wait_min: null, elapsed_min: 5, elapsed_high_min: 5, preceded_by_host_node_ids: [] },
          { start_min: 500, end_min: 530, active_min: 4, node_ids: ['host', 'cube'], preceded_by_wait_min: 495, elapsed_min: 30, elapsed_high_min: 30, preceded_by_host_node_ids: [] },
        ],
      },
    } as unknown as RecipePlanResponse

    const plan = derivePlan(payload)
    expect(plan.waitRows).toHaveLength(1)
    const prepIndex = plan.stages.findIndex((s) => s.stageId === 'prep')
    expect(plan.waitRows[0].afterStageIndex).toBe(prepIndex)
  })
})
