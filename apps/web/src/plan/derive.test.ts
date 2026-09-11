import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan } from './derive'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'

// Fixtures are real scheduler output, frozen by apps/api/scripts/export_web_fixtures.py.
const KADAI = kadaiPaneer as RecipePlanResponse
const MAGGI = maggi as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse

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
