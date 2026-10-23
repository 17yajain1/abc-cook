import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import kadai from '@/__fixtures__/kadai-paneer.plan-response.json'
import biryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import pumpkin from '@/__fixtures__/pumpkin-pancakes.plan-response.json'
import { attentionTag } from '@/lib/attention'
import { handsOnTileText } from '@/lib/duration'

import { derivePlan, hasParallelWork } from './derive'
import { stepNumbers } from './stepNumbers'

const FIXTURES = [kadai, biryani, pumpkin] as unknown as RecipePlanResponse[]

describe('stepNumbers', () => {
  it('numbers every drawn step once, 1..N, with window steps right after their host', () => {
    for (const payload of FIXTURES) {
      const plan = derivePlan(payload)
      const numbers = stepNumbers(plan.stages)
      const drawn = plan.stages.flatMap((s) =>
        s.inlineTasks.flatMap((t) => [t.nodeId, ...(s.windows.find((w) => w.hostNodeId === t.nodeId)?.tasks.map((x) => x.nodeId) ?? [])]),
      )
      expect(new Set(drawn).size).toBe(drawn.length)
      expect(drawn.map((id) => numbers.get(id))).toEqual(drawn.map((_, i) => i + 1))
    }
  })
})

describe('hasParallelWork (D5)', () => {
  it('is true exactly when a window holds a task', () => {
    expect(hasParallelWork(kadai as unknown as RecipePlanResponse)).toBe(true)
    expect(hasParallelWork(biryani as unknown as RecipePlanResponse)).toBe(true)
    expect(hasParallelWork(pumpkin as unknown as RecipePlanResponse)).toBe(false)
    expect(derivePlan(pumpkin as unknown as RecipePlanResponse).hasParallelWork).toBe(false)
  })
})

describe('attentionTag', () => {
  it('labels unattended and periodic steps, and says nothing for hands-on', () => {
    expect(attentionTag('unattended')).toBe('Hands-off')
    expect(attentionTag('periodic')).toBe('Low attention')
    expect(attentionTag('hands_on')).toBeNull()
  })
})

describe('handsOnTileText', () => {
  it('is the summary hands-on figure to the nearest 5, with a tilde', () => {
    const summary = derivePlan(kadai as unknown as RecipePlanResponse).summary
    expect(handsOnTileText(summary)).toMatch(/^~\d+( hr \d+)? min$|^~\d+ hr$/)
    expect(handsOnTileText(null)).toBeNull()
  })
})
