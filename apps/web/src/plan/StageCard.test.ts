import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse, StageSpan } from '@abc-cook/schema'

import { stageColor } from '@/lib/stageColor'

import { derivePlan, type RenderTask } from './derive'
import { freeMinForStage, stageDurationText, stageOrdinal, taskDurationText } from './StageCard'
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

function span(overrides: Partial<StageSpan>): StageSpan {
  return {
    stage_id: 's',
    start_min: 0,
    end_min: 0,
    elapsed_min: 0,
    work_min: 0,
    windowed_work_min: 0,
    inline_work_min: 0,
    node_ids: [],
    ...overrides,
  }
}

describe('stageDurationText (C1)', () => {
  it('splits hands-on and waiting minutes when both fields are present and there is waiting time', () => {
    const cookBase = span({ inline_work_min: 17, hands_on_min: 5, unattended_min: 12 })
    expect(stageDurationText(cookBase)).toBe('5 min hands-on · 12 min waiting')
  })

  it('formats long waits as hours', () => {
    const s = span({ inline_work_min: 1165, hands_on_min: 20, unattended_min: 1145 })
    expect(stageDurationText(s)).toBe('20 min hands-on · 19 hr 5 min waiting')
  })

  it('falls back to the plain ~N min figure when the stage is entirely hands-on', () => {
    const prep = span({ inline_work_min: 5, hands_on_min: 5, unattended_min: 0 })
    expect(stageDurationText(prep)).toBe('~5 min')
  })

  it('falls back to the plain ~N min figure when the fields are absent (a pre-C1 saved recipe)', () => {
    const oldSave = span({ inline_work_min: 12 })
    expect(stageDurationText(oldSave)).toBe('~12 min')
  })
})

function task(overrides: Partial<RenderTask>): RenderTask {
  return {
    nodeId: 'n',
    label: 'Task',
    instruction: '',
    durationTypical: 0,
    donenessCue: null,
    attention: 'hands_on',
    durationProvenance: null,
    homeStageIndex: 0,
    ...overrides,
  }
}

describe('taskDurationText (C2)', () => {
  it('formats a long duration as hours, with no estimate cue', () => {
    expect(taskDurationText(task({ durationTypical: 270 }))).toBe('4 hr 30 min')
  })

  it('prefixes "about " for a non-hands-on row whose duration provenance is inferred', () => {
    const t = task({ attention: 'unattended', durationProvenance: 'inferred', durationTypical: 10 })
    expect(taskDurationText(t)).toBe('about 10 min')
  })

  it('does not mark a hands-on row, even if its provenance is inferred', () => {
    const t = task({ attention: 'hands_on', durationProvenance: 'inferred', durationTypical: 10 })
    expect(taskDurationText(t)).toBe('10 min')
  })

  it('does not mark a defaulted duration as an estimate', () => {
    const t = task({ attention: 'unattended', durationProvenance: 'defaulted', durationTypical: 10 })
    expect(taskDurationText(t)).toBe('10 min')
  })

  it('does not mark an extracted duration as an estimate', () => {
    const t = task({ attention: 'unattended', durationProvenance: 'extracted', durationTypical: 10 })
    expect(taskDurationText(t)).toBe('10 min')
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
