/**
 * Stage colours are assigned by position in `graph.stages`, cycling through six —
 * recipes have arbitrary stages, so `Stage.color_key` is not consulted. The six values
 * live on `:root` in index.css. See docs/DESIGN_SYSTEM.md.
 */
const STAGE_COUNT = 6

export function stageColor(index: number): string {
  return `var(--stage-${((index % STAGE_COUNT) + STAGE_COUNT) % STAGE_COUNT})`
}
