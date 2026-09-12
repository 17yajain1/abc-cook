import { useCallback, useEffect, useState } from 'react'

import type { RecipeSummary } from '@abc-cook/schema'

import { ApiError, fetchPlan, fetchRecipes } from './api/client'
import { layoutMap, type MapLayout } from './map/layout'
import { derivePlan, type RenderPlan } from './plan/derive'
import { PlanScreen } from './plan/PlanScreen'

type View =
  | { kind: 'picker' }
  | { kind: 'loading'; recipeId: string }
  | { kind: 'plan'; plan: RenderPlan; map: MapLayout }
  | { kind: 'error'; message: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'picker' })

  const openRecipe = useCallback((recipeId: string) => {
    setView({ kind: 'loading', recipeId })
    fetchPlan(recipeId)
      .then((payload) =>
        setView({ kind: 'plan', plan: derivePlan(payload), map: layoutMap(payload) }),
      )
      .catch((err: unknown) =>
        setView({ kind: 'error', message: messageFor(err) }),
      )
  }, [])

  const backToPicker = useCallback(() => setView({ kind: 'picker' }), [])

  switch (view.kind) {
    case 'loading':
      return <Centered>Scheduling {view.recipeId}…</Centered>
    case 'error':
      return (
        <Centered>
          <p className="text-[15px] text-ink">{view.message}</p>
          <button
            type="button"
            onClick={backToPicker}
            className="mt-5 rounded-control bg-signal px-4 py-2 text-[15px] font-semibold text-paper"
          >
            Back
          </button>
        </Centered>
      )
    case 'plan':
      return <PlanScreen plan={view.plan} map={view.map} onPickAnother={backToPicker} />
    default:
      return <RecipePicker onPick={openRecipe} />
  }
}

function RecipePicker({ onPick }: { onPick: (recipeId: string) => void }) {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRecipes()
      .then((r) => setRecipes(r.recipes))
      .catch((err: unknown) => setError(messageFor(err)))
  }, [])

  return (
    <div className="flex h-full flex-col bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">ABC Cook</h1>
      <p className="mt-1 text-[15px] text-ink-2">Pick a recipe to see its cooking plan.</p>

      {error && <p className="mt-6 text-[15px] text-signal">{error}</p>}

      <ul className="mt-8 border-t border-rule">
        {recipes?.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              onClick={() => onPick(recipe.id)}
              className="flex w-full items-baseline justify-between gap-3 border-b border-rule py-3.5 text-left active:bg-paper-sunk"
            >
              <span className="text-[15px] font-medium text-ink">{recipe.title}</span>
              <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
                {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}
              </span>
            </button>
          </li>
        ))}
        {!recipes && !error && (
          <li className="py-3.5 text-[15px] text-ink-3">Loading…</li>
        )}
      </ul>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-paper px-8 text-center text-[15px] text-ink-2">
      {children}
    </div>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "That recipe isn't on the server."
    if (err.status === 0) return err.message
    return `The server had a problem (${err.status}).`
  }
  return 'Something went wrong loading the plan.'
}
