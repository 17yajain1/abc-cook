import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import kadhiFixture from '@/__fixtures__/kadhi-pakora.plan-response.json'
import sabudanaFixture from '@/__fixtures__/sabudana-khichdi.plan-response.json'

import { derivePlan, type RenderStage } from './derive'
import { NO_STEP_LABEL, stageTaskOrder, stepChoiceGroups } from './stepRows'

const KADHI = kadhiFixture as RecipePlanResponse
const SABUDANA = sabudanaFixture as RecipePlanResponse

/** The order the Plan tab draws a card's rows: each inline task, then (if it hosts a window) that window's tasks. */
function renderedOrder(stage: RenderStage): string[] {
  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
  return stage.inlineTasks.flatMap((t) => [t.nodeId, ...(windowByHost.get(t.nodeId)?.tasks.map((w) => w.nodeId) ?? [])])
}

describe('stageTaskOrder (B18)', () => {
  it('is the order the card draws: a window\'s tasks come right after their host', () => {
    const plan = derivePlan(KADHI)
    for (const stage of plan.stages) {
      expect(stageTaskOrder(stage).map((t) => t.nodeId)).toEqual(renderedOrder(stage))
    }
  })

  it('kadhi has windows, so the test above is not vacuous', () => {
    const plan = derivePlan(KADHI)
    expect(plan.stages.some((s) => s.windows.length > 0)).toBe(true)
  })
})

describe('stepChoiceGroups (D8, B18)', () => {
  it('lists the steps in the order the Plan tab shows them, by stage card, minus the serving-wait node', () => {
    const plan = derivePlan(KADHI)
    const groups = stepChoiceGroups(plan)
    expect(groups.map((g) => g.stageLabel)).toEqual(plan.stages.map((s) => s.label))
    const listed = groups.flatMap((g) => g.choices.map((c) => c.nodeId))
    const page = plan.stages.flatMap(renderedOrder).filter((id) => !id.startsWith('step_wait_before_serving'))
    expect(listed).toEqual(page)
    expect(listed).not.toContain('step_wait_before_serving')
  })

  it('pins kadhi: window tasks follow their host, not the end of the stage', () => {
    const plan = derivePlan(KADHI)
    const listed = stepChoiceGroups(plan).flatMap((g) => g.choices.map((c) => c.nodeId))
    const hostWindow = plan.stages.flatMap((s) => s.windows).find((w) => !w.hostNodeId.startsWith('step_wait_before_serving'))!
    const at = listed.indexOf(hostWindow.hostNodeId)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(listed.slice(at + 1, at + 1 + hostWindow.tasks.length)).toEqual(hostWindow.tasks.map((t) => t.nodeId))
  })

  it('offers every editable step exactly once', () => {
    for (const payload of [KADHI, SABUDANA]) {
      const plan = derivePlan(payload)
      const listed = stepChoiceGroups(plan).flatMap((g) => g.choices.map((c) => c.nodeId))
      const editable = payload.graph.nodes.map((n) => n.id).filter((id) => !id.startsWith('step_wait_before_serving'))
      expect([...listed].sort()).toEqual([...editable].sort())
    }
  })

  it('uses the label as the option text when labels are unique', () => {
    const plan = derivePlan(SABUDANA)
    const labels = stepChoiceGroups(plan).flatMap((g) => g.choices.map((c) => c.label))
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toContain('Soak sabudana')
  })

  it('disambiguates a repeated label with " · " and the start of the current text', () => {
    const p = structuredClone(KADHI)
    const nodes = p.graph.nodes as unknown as { label: string; instruction: string }[]
    nodes[4].label = 'Fry'
    nodes[6].label = 'Fry'
    nodes[4].instruction = 'Heat oil in a deep pan and drop small dollops of the batter.'
    const choices = stepChoiceGroups(derivePlan(p)).flatMap((g) => g.choices)
    const fry = choices.filter((c) => c.label.startsWith('Fry'))
    expect(fry).toHaveLength(2)
    expect(fry.every((c) => c.label.startsWith('Fry · '))).toBe(true)
    expect(new Set(fry.map((c) => c.label)).size).toBe(2)
    expect(choices.find((c) => c.nodeId === (nodes[4] as unknown as { id: string }).id)!.label).toBe('Fry · Heat oil in a deep pan and drop small do…')
  })

  it('cuts at graphemes: a Devanagari conjunct is never split', () => {
    const p = structuredClone(KADHI)
    const nodes = p.graph.nodes as unknown as { label: string; instruction: string; id: string }[]
    nodes[4].label = 'Fry'
    nodes[6].label = 'Fry'
    nodes[4].instruction = `${'क्ष'.repeat(39)}्त्र्य and more text after`
    const label = stepChoiceGroups(derivePlan(p)).flatMap((g) => g.choices).find((c) => c.nodeId === nodes[4].id)!.label
    const head = label.slice('Fry · '.length).replace(/…$/, '')
    const seg = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(nodes[4].instruction)]
    expect(seg.map((s) => s.segment).join('').startsWith(head)).toBe(true)
    expect(head.endsWith('्')).toBe(false)
    expect([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(head)].length).toBeLessThanOrEqual(40)
  })

  it('reads the current (overlaid) text for the disambiguation', () => {
    const p = structuredClone(KADHI)
    const nodes = p.graph.nodes as unknown as { label: string; instruction: string; id: string }[]
    nodes[4].label = 'Fry'
    nodes[6].label = 'Fry'
    nodes[6].instruction = 'Fry them again.'
    const choices = stepChoiceGroups(derivePlan(p)).flatMap((g) => g.choices)
    expect(choices.find((c) => c.nodeId === nodes[6].id)!.label).toBe('Fry · Fry them again.')
  })

  it('names the empty choice "None"', () => {
    expect(NO_STEP_LABEL).toBe('None')
  })
})
