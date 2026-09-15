import { useEffect, useState } from 'react'

import type { RecipeSummary, SavedRecipe } from '@abc-cook/schema'

import { ApiError, fetchRecipes } from '@/api/client'

import { thumbnailUrlFor } from './sourceKey'

/**
 * The Recipes list (formerly `RecipePicker` in `App.tsx`): saved recipes from this
 * device, then the server's sample recipes. Same row idiom for both — no grid, no
 * redesign (M2.12 design decision — this milestone is persistence, not a new layout).
 */
export function LibraryScreen({
  savedRecipes,
  onOpenSaved,
  onPick,
  onImport,
}: {
  savedRecipes: SavedRecipe[]
  onOpenSaved: (id: string) => void
  onPick: (recipeId: string) => void
  onImport: () => void
}) {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchRecipes()
      .then((r) => setRecipes(r.recipes))
      .catch((err: unknown) => setError(messageFor(err)))
  }, [])

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-paper px-5 pt-16">
      <h1 className="text-[22px] font-semibold text-ink">ABC Cook</h1>
      <p className="mt-1 text-[15px] text-ink-2">Pick a recipe to see its cooking plan.</p>

      <section className="mt-8">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Your recipes
        </h2>
        {savedRecipes.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-3">
            Recipes you save from a link will show up here.
          </p>
        ) : (
          <ul className="mt-2 border-t border-rule">
            {savedRecipes.map((recipe) => (
              <SavedRow key={recipe.id} recipe={recipe} onOpen={() => onOpenSaved(recipe.id)} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-ink-3">
          Sample recipes
        </h2>

        {error && <p className="mt-3 text-[15px] text-signal">{error}</p>}

        <ul className="mt-2 border-t border-rule">
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
          {!recipes && !error && <li className="py-3.5 text-[15px] text-ink-3">Loading…</li>}
        </ul>
      </section>

      <button
        type="button"
        onClick={onImport}
        className="mb-10 mt-6 self-start text-[13px] text-ink-3 underline underline-offset-4"
      >
        or paste a recipe link
      </button>
    </div>
  )
}

function SavedRow({ recipe, onOpen }: { recipe: SavedRecipe; onOpen: () => void }) {
  const thumbnail = thumbnailUrlFor(recipe.source_key)
  const { title, servings } = recipe.payload.graph

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 border-b border-rule py-3 text-left active:bg-paper-sunk"
      >
        {thumbnail && (
          <img
            src={thumbnail}
            alt=""
            className="h-14 w-14 flex-shrink-0 rounded-control object-cover"
            onError={(e) => {
              // Thumbnail loads must never block or break the recipe (M2.12 acceptance
              // requirement 7) — hide the broken image, keep the row fully usable.
              e.currentTarget.style.display = 'none'
            }}
          />
        )}
        <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
          <span className="truncate text-[15px] font-medium text-ink">{title}</span>
          <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
            {servings} {servings === 1 ? 'serving' : 'servings'}
          </span>
        </span>
      </button>
    </li>
  )
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return err.message
    return `The server had a problem (${err.status}).`
  }
  return 'Something went wrong loading recipes.'
}
