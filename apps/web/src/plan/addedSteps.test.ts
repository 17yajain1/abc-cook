import { describe, expect, it } from 'vitest'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

import { derivePlan } from './derive'
import { taskDurationText } from './StageCard'

const KADAI = kadaiPaneer as RecipePlanResponse
const VIDEO = {
  ...KADAI,
  graph: {
    ...KADAI.graph,
    source: { kind: 'url', value: 'https://youtu.be/abc', imported_at: '2026-01-01T00:00:00Z' },
  },
} as RecipePlanResponse
const MARKED: GraphProvenance = {
  nodes: {
    chop_tomato: { fields: { duration: 'inferred' }, origin: 'added' },
    add_paneer: { fields: {}, origin: 'source' },
  },
}

function allTasks(plan: ReturnType<typeof derivePlan>) {
  return plan.stages.flatMap((s) => [...s.inlineTasks, ...s.windows.flatMap((w) => w.tasks)])
}

describe('derivePlan - added steps (FGC-3)', () => {
  it('labels only the node whose provenance origin is "added"', () => {
    const tasks = allTasks(derivePlan(VIDEO, MARKED))
    for (const task of tasks) {
      expect(task.addedLabel).toBe(
        task.nodeId === 'chop_tomato' ? 'Added by ABC Cook, not in the video' : null,
      )
    }
  })

  it('uses the recipe wording for a non-video source', () => {
    const tasks = allTasks(derivePlan(KADAI, MARKED))
    expect(tasks.find((t) => t.nodeId === 'chop_tomato')!.addedLabel).toBe(
      'Added by ABC Cook, not in the recipe',
    )
  })

  it('is null on every task with no provenance, or provenance without an origin', () => {
    expect(allTasks(derivePlan(KADAI)).every((t) => t.addedLabel === null)).toBe(true)
    const old: GraphProvenance = { nodes: { chop_tomato: { fields: { duration: 'inferred' } } } }
    expect(allTasks(derivePlan(KADAI, old)).every((t) => t.addedLabel === null)).toBe(true)
  })

  it('shows an added step\'s time as an estimate, never as a plain figure', () => {
    const task = allTasks(derivePlan(VIDEO, MARKED)).find((t) => t.nodeId === 'chop_tomato')!
    expect(task.attention).toBe('hands_on')
    expect(taskDurationText(task)).toMatch(/^~/)
  })
})
