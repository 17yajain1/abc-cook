import type { RenderStage } from './derive'

/**
 * The badge number of each stage on the page: 1..N over the stages that actually render, in order. A stage
 * whose steps were all moved into another stage's wait window has no card and takes no number; a stage drawn
 * as more than one card keeps one number across them. Each card's colour is still the stage's graph index
 * (`stageColor(stage.index)`), so the number and the colour are independent.
 */
export function stageOrdinals(stages: readonly RenderStage[]): Map<string, number> {
  const ordinals = new Map<string, number>()
  for (const stage of stages) if (!ordinals.has(stage.stageId)) ordinals.set(stage.stageId, ordinals.size + 1)
  return ordinals
}

/**
 * The number each step wears on the recipe page, 1..N across the stages in the order they are drawn:
 * a stage's inline steps in order, each followed by the steps of the wait window it hosts. Counting
 * what is on screen, nothing more: no figure here comes from the schedule. Cooking mode shows the
 * same number (PR 2).
 */
export function stepNumbers(stages: readonly RenderStage[]): Map<string, number> {
  const numbers = new Map<string, number>()
  let n = 0
  for (const stage of stages) {
    const windowByHost = new Map(stage.windows.map((w) => [w.hostNodeId, w]))
    for (const task of stage.inlineTasks) {
      numbers.set(task.nodeId, ++n)
      for (const t of windowByHost.get(task.nodeId)?.tasks ?? []) numbers.set(t.nodeId, ++n)
    }
  }
  return numbers
}
