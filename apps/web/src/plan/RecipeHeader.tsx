import type { RenderPlan } from './derive'

/**
 * The top of the Plan view. A gradient stands in for the food photo until import
 * (M4) — fabricating a stock image URL per recipe would be exactly the kind of
 * hardcoded demo data the prototype is full of.
 */
export function RecipeHeader({ plan }: { plan: RenderPlan }) {
  return (
    <header className="relative flex-shrink-0 overflow-hidden px-5 pb-4 pt-7">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 15% 0%, rgba(232,160,32,0.22), transparent 60%), ' +
            'radial-gradient(120% 90% at 100% 100%, rgba(196,82,26,0.18), transparent 55%)',
        }}
      />
      <div className="relative">
        <h1 className="text-3xl font-bold leading-tight text-ink">{plan.title}</h1>
        {plan.cuisine && <p className="mt-1 text-sm text-ink-muted">{plan.cuisine}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span className="tabular">
            {plan.servings} {plan.servings === 1 ? 'serving' : 'servings'}
          </span>
          <span className="tabular">{formatMinutes(plan.totalMin)} total</span>
        </div>

        {plan.savedMin > 0 && (
          <p className="mt-3 text-sm font-medium text-saffron">
            This plan saves you{' '}
            <span className="tabular">{formatMinutes(plan.savedMin)}</span> by prepping
            while things cook.
          </p>
        )}
      </div>
    </header>
  )
}

/** "34 min", "1 hr 18 min". Presentational only — the value is `plan.total_min`. */
function formatMinutes(min: number): string {
  const whole = Math.round(min)
  if (whole < 60) return `${whole} min`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}
