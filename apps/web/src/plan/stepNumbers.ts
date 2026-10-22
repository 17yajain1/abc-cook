import type { RenderStage } from './derive'

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
