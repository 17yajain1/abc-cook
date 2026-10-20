import { isServingWaitNode } from '@/library/recipeEdits'

import type { RenderPlan, RenderStage, RenderTask } from './derive'

/**
 * R6b D8/B18: the steps of a card in the order the Plan tab draws them. A card draws each inline
 * task and, right after a task that hosts a wait window, that window's tasks ("Meanwhile, do these").
 * The "Which step uses it?" picker lists steps in exactly this order, so it reads like the page.
 */
export function stageTaskOrder(stage: RenderStage): RenderTask[] {
  const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
  return stage.inlineTasks.flatMap((task) => [task, ...(windowByHost.get(task.nodeId)?.tasks ?? [])])
}

/** The picker's first and default option (Q9). */
export const NO_STEP_LABEL = 'None'

export interface StepChoice {
  nodeId: string
  /** The step's label; with " · " and the start of its text when another step has the same label. */
  label: string
}

export interface StepChoiceGroup {
  /** The card's key (a stage that is drawn as two cards gives two groups). */
  key: string
  stageLabel: string
  choices: StepChoice[]
}

const HEAD_GRAPHEMES = 40

/** The first ~40 grapheme clusters of `text`, so a Devanagari conjunct is never cut in half. */
function head(text: string): string {
  const one = text.replace(/\s+/gu, ' ').trim()
  const clusters =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(one)].map((s) => s.segment)
      : Array.from(one)
  return clusters.length > HEAD_GRAPHEMES ? `${clusters.slice(0, HEAD_GRAPHEMES).join('')}…` : one
}

/**
 * The options of the step picker, one group per stage card, in page order. The serving-wait node is
 * never offered (Q2). `plan` is drawn from the overlaid payload, so a repeated label is told apart by
 * the text as the cook sees it now.
 */
export function stepChoiceGroups(plan: RenderPlan): StepChoiceGroup[] {
  const cards = plan.stages.map((stage) => ({ stage, tasks: stageTaskOrder(stage).filter((t) => !isServingWaitNode(t.nodeId)) }))
  const counts = new Map<string, number>()
  for (const { tasks } of cards) for (const t of tasks) counts.set(t.label, (counts.get(t.label) ?? 0) + 1)
  return cards.map(({ stage, tasks }) => ({
    key: stage.key,
    stageLabel: stage.label,
    choices: tasks.map((t) => ({
      nodeId: t.nodeId,
      label: (counts.get(t.label) ?? 0) > 1 ? `${t.label} · ${head(t.instruction)}` : t.label,
    })),
  }))
}
