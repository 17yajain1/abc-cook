import type { ImportMeta } from '@abc-cook/schema'

import { handsOnTileText } from '@/lib/duration'
import { unscaledCount } from '@/lib/quantity'
import { choiceFactor, servingsLine } from '@/lib/servings'

import type { RenderPlan } from './derive'
import { headerMeta } from './headerMeta'
import type { PanelServings } from './IngredientsPanel'
import { ServingsSubline, ServingsTile, type ServingsControlState } from './ServingsControl'

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="min-w-0 rounded-home-mini border border-home-rule bg-home-surface px-3 py-2.5">
      <div className="tabular text-[17px] font-bold leading-[1.15] text-home-ink">{value}</div>
      <div className="mt-0.5 text-[12px] leading-[1.25] text-home-ink-2">{label}</div>
    </div>
  )
}

/** The servings control's state for the tile, from the page's resolved servings (R4). */
function controlState(servings: PanelServings, plan: RenderPlan): ServingsControlState {
  const choice = servings.kind === 'gated' ? null : servings.choice
  if (servings.kind === 'gated' || choice == null) return { kind: 'gated' }
  if (servings.kind === 'locked') return { kind: 'locked', choice }
  const items = plan.ingredientGroups.flatMap((g) => g.items)
  return { kind: 'live', choice, unscaled: unscaledCount(items, choiceFactor(choice)) }
}

/**
 * The fact tiles under the title (D7): start to finish, hands-on, servings. Every figure is the
 * scheduler's (`headerMeta`, `handsOnTileText`) or the recipe's own; none is computed here. A tile with
 * nothing to say is left out rather than shown empty: a multi-sitting recipe's range lives in the
 * plan-ahead card, and a plan saved before `summary` has no hands-on figure.
 */
export function RecipeFacts({
  plan,
  importMeta,
  servings,
  hasCard,
}: {
  plan: RenderPlan
  importMeta?: ImportMeta | null
  servings?: PanelServings
  /** The plan-ahead card is showing, so the multi-sitting range is its job. */
  hasCard: boolean
}) {
  const timing = headerMeta(plan.summary, plan.totalMin, hasCard)
  const handsOn = handsOnTileText(plan.summary)
  const state = servings ? controlState(servings, plan) : null
  const staticLine = servingsLine(plan.servingsSource, importMeta)
  const showServings = state != null ? state.kind !== 'gated' || staticLine != null : staticLine != null
  const count = (timing.primary ? 1 : 0) + (handsOn ? 1 : 0) + (showServings ? 1 : 0)
  if (count === 0) return null

  return (
    <div className="mt-3.5">
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns:
            count === 3 ? 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr)' : `repeat(${count}, minmax(0,1fr))`,
        }}
      >
        {timing.primary && <Tile value={timing.primary} label="start to finish" />}
        {handsOn && <Tile value={handsOn} label="hands-on" />}
        {showServings &&
          (state && servings ? (
            <ServingsTile state={state} staticLine={staticLine} onChange={(c) => servings.onChange(c)} />
          ) : (
            <Tile value={staticLine ?? ''} label="" />
          ))}
      </div>
      {state && servings && (
        <div className="mt-2">
          <ServingsSubline state={state} onChange={(c) => servings.onChange(c)} />
        </div>
      )}
    </div>
  )
}
