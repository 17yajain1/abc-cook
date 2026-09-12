import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { stageColor } from '@/lib/stageColor'

import { derivePlan } from './derive'
import { freeMinForStage, stageOrdinal } from './StageCard'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse

describe('stageOrdinal — badge number and badge tint agree', () => {
  it('derives the ordinal from the same stage.index the tint uses, for every stage', () => {
    for (const payload of [KADAI, BIRYANI]) {
      const plan = derivePlan(payload)
      for (const stage of plan.stages) {
        expect(stageOrdinal(stage)).toBe(stage.index + 1)
        // Both come from `stage.index` — they cannot disagree by construction.
        expect(stageColor(stage.index)).toBe(stageColor(stageOrdinal(stage) - 1))
      }
    }
  })

  it('drops Chicken Biryani\'s Prep stage (fully windowed) and starts numbering at 2 — the exact M2 defect case', () => {
    const plan = derivePlan(BIRYANI)
    expect(plan.stages.map((s) => s.stageId)).not.toContain('prep')
    const first = plan.stages[0]
    expect(first.index).not.toBe(0)
    expect(stageOrdinal(first)).toBe(first.index + 1)
  })
})

describe('freeMinForStage', () => {
  it('sums the window hosts\' duration_typical for Kadai\'s Cook Base stage', () => {
    const plan = derivePlan(KADAI)
    const cookBase = plan.stages.find((s) => s.stageId === 'cook_base')!
    expect(freeMinForStage(cookBase)).toBe(12)
  })

  it('is zero for a stage with no windows', () => {
    const plan = derivePlan(KADAI)
    const prep = plan.stages.find((s) => s.stageId === 'prep')!
    expect(freeMinForStage(prep)).toBe(0)
  })
})
