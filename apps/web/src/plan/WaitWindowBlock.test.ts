import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan } from './derive'
import { attentionLine, hasMultiHomeStage } from './WaitWindowBlock'
import chickenBiryani from './__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from './__fixtures__/kadai-paneer.plan-response.json'

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse

describe('attentionLine', () => {
  it('reads "checking the pan now and then" for a periodic host', () => {
    expect(attentionLine('periodic')).toBe('checking the pan now and then')
  })

  it('reads "your hands are free" for an unattended host', () => {
    expect(attentionLine('unattended')).toBe('your hands are free')
  })

  it('matches Kadai Paneer\'s real periodic window (cook_tomato_base)', () => {
    const plan = derivePlan(KADAI)
    const window = plan.stages.find((s) => s.stageId === 'cook_base')!.windows[0]
    expect(window.hostAttention).toBe('periodic')
    expect(attentionLine(window.hostAttention)).toBe('checking the pan now and then')
  })
})

describe('hasMultiHomeStage', () => {
  it('is false for every real window in both shipped fixtures', () => {
    for (const payload of [KADAI, BIRYANI]) {
      const plan = derivePlan(payload)
      for (const window of plan.stages.flatMap((s) => s.windows)) {
        expect(hasMultiHomeStage(window.tasks)).toBe(false)
      }
    }
  })

  it('is true for a synthetic window spanning two home stages', () => {
    expect(hasMultiHomeStage([{ homeStageIndex: 0 }, { homeStageIndex: 1 }])).toBe(true)
  })
})
