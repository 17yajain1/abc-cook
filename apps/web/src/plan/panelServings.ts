import type { ImportMeta, Ingredient } from '@abc-cook/schema'

import { choiceFactor, originalChoice, reconcileChoice, servingsControlKind, type ServingsChoice } from '@/lib/servings'

import type { RenderPlan } from './derive'
import type { PanelServings } from './IngredientsPanel'

/**
 * R4: what the Ingredients tab's servings control is for this recipe, or `undefined` when the
 * caller gave no way to change it (the control would do nothing). The choice is reconciled
 * against the plan first, so a stale one can never scale a recipe it wasn't made for.
 */
export function panelServings(
  plan: RenderPlan,
  importMeta: ImportMeta | null | undefined,
  choice: ServingsChoice | null,
  locked: boolean,
  onChange: ((choice: ServingsChoice | null) => void) | undefined,
  gateLines?: ReadonlyArray<Pick<Ingredient, 'qty_text' | 'qty' | 'qty_amount'>>,
): (PanelServings & { choice: ServingsChoice | null }) | undefined {
  if (!onChange) return undefined
  // A13: whether the control is gated is a fact about the imported recipe. `gateLines` are the
  // imported rows, so an edit can never switch the control between gated and live.
  const lines = gateLines ?? plan.ingredientGroups.flatMap((g) => g.items)
  const kind = servingsControlKind(plan.servingsSource, importMeta, lines)
  if (kind === 'gated') return { kind: 'gated', choice: null, onChange }
  const effective =
    reconcileChoice(choice, plan.servingsSource, importMeta) ?? originalChoice(plan.servingsSource, importMeta)
  return {
    kind: locked ? 'locked' : 'live',
    choice: effective,
    // Back at the original is "no choice", so nothing is stored for a recipe left as written.
    onChange: (next) => onChange(choiceFactor(next) === 1 ? null : next),
  }
}
