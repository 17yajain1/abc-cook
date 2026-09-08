import { useCallback, useEffect, useState } from 'react'

import type { RecipeSummary } from '@abc-cook/schema'

import { ApiError, fetchPlan, fetchRecipes } from './api/client'
import { derivePlan, type RenderPlan } from './plan/derive'
import { PlanScreen } from './plan/PlanScreen'

type View =
  | { kind: 'picker' }
  | { kind: 'loading'; recipeId: string }
  | { kind: 'plan'; plan: RenderPlan }
  | { kind: 'error'; message: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'picker' })

  const openRecipe = useCallback((recipeId: string) => {
    setView({ kind: 'loading', recipeId })
    fetchPlan(recipeId)
      .then((payload) => setView({ kind: 'plan', plan: derivePlan(payload) }))
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
          <p className="text-ink">{view.message}</p>
          <button
            type="button"
            onClick={backToPicker}
            className="mt-4 rounded-full bg-saffron px-4 py-2 text-sm font-semibold text-ground"
          >
            Back
          </button>
        </Centered>
      )
    case 'plan':
      return <PlanScreen plan={view.plan} onPickAnother={backToPicker} />
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
    <div className="flex h-full flex-col px-6 pt-16">
      <h1 className="text-2xl font-bold text-ink">ABC Cook</h1>
      <p className="mt-1 text-sm text-ink-muted">Pick a recipe to see its cooking plan.</p>

      {error && <p className="mt-6 text-sm text-terracotta">{error}</p>}

      <ul className="mt-8 space-y-2.5">
        {recipes?.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              onClick={() => onPick(recipe.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3.5 text-left"
            >
              <span className="font-semibold text-ink">{recipe.title}</span>
              <span className="tabular text-xs text-ink-dim">
                {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'} ›
              </span>
            </button>
          </li>
        ))}
        {!recipes && !error && <li className="text-sm text-ink-dim">Loading…</li>}
      </ul>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-ink-muted">
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
