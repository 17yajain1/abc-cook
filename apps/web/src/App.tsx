import { useCallback, useState } from 'react'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import { ApiError, fetchPlan } from './api/client'
import { ImportScreen } from './import/ImportScreen'
import { LibraryScreen } from './library/LibraryScreen'
import { canonicalSourceKey } from './library/sourceKey'
import { createLibrary } from './library/store'
import { layoutMap, type MapLayout } from './map/layout'
import { derivePlan, type RenderPlan } from './plan/derive'
import { PlanScreen } from './plan/PlanScreen'
import type { SaveControl } from './plan/RecipeHeader'

/** Single instance for the app's lifetime — reads `localStorage` once, synchronously,
 * at module load; every save/read after that goes through this same closure (M2.12
 * design: this becomes M3's Zustand `persist` storage unchanged). */
const library = createLibrary()

/** Where the plan currently on screen came from — decides what the Save control shows. */
type PlanOrigin =
  | { kind: 'server'; recipeId: string }
  | { kind: 'import'; payload: RecipePlanResponse; importMeta: ImportMeta }
  | { kind: 'library'; id: string }

type SaveState = { status: 'idle' | 'saved' | 'error'; message?: string }

type View =
  | { kind: 'picker' }
  | { kind: 'import' }
  | { kind: 'loading'; recipeId: string }
  | {
      kind: 'plan'
      plan: RenderPlan
      map: MapLayout
      origin: PlanOrigin
      saveState: SaveState
      /** A6: null for a fixture recipe (never went through `/import`). */
      importMeta: ImportMeta | null
    }
  | { kind: 'error'; message: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'picker' })

  const openRecipe = useCallback((recipeId: string) => {
    setView({ kind: 'loading', recipeId })
    fetchPlan(recipeId)
      .then((payload) =>
        setView({
          kind: 'plan',
          plan: derivePlan(payload),
          map: layoutMap(payload),
          origin: { kind: 'server', recipeId },
          saveState: { status: 'idle' },
          importMeta: null,
        }),
      )
      .catch((err: unknown) => setView({ kind: 'error', message: messageFor(err) }))
  }, [])

  // Synchronous: the recipe is already on the device, so there is no loading state and
  // no network request — `PlanScreen` remounts (via its `key`) exactly as it would for
  // a server open (`PlanScreen.tsx`'s Map-animation ref assumes that).
  const openSaved = useCallback((id: string) => {
    const recipe = library.get(id)
    if (!recipe) {
      setView({ kind: 'error', message: "That recipe isn't in your library any more." })
      return
    }
    setView({
      kind: 'plan',
      plan: derivePlan(recipe.payload),
      map: layoutMap(recipe.payload),
      origin: { kind: 'library', id },
      saveState: { status: 'saved' },
      importMeta: recipe.import_meta ?? null,
    })
  }, [])

  const backToPicker = useCallback(() => setView({ kind: 'picker' }), [])
  const openImport = useCallback(() => setView({ kind: 'import' }), [])
  const onImported = useCallback(
    (plan: RenderPlan, map: MapLayout, payload: RecipePlanResponse, importMeta: ImportMeta) =>
      setView({
        kind: 'plan',
        plan,
        map,
        origin: { kind: 'import', payload, importMeta },
        saveState: { status: 'idle' },
        importMeta,
      }),
    [],
  )

  // No network, no LLM call — `library.save` writes straight to `localStorage`
  // (M2.12 acceptance requirement 2). A functional update avoids a stale `view` closure.
  const saveCurrent = useCallback(() => {
    setView((prev) => {
      if (prev.kind !== 'plan' || prev.origin.kind !== 'import') return prev
      const result = library.save(prev.origin.payload, prev.origin.importMeta)
      if (!result.ok) {
        return { ...prev, saveState: { status: 'error', message: result.message } }
      }
      return { ...prev, saveState: { status: 'saved' } }
    })
  }, [])

  switch (view.kind) {
    case 'import':
      return <ImportScreen onImported={onImported} onCancel={backToPicker} />
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
      return (
        <PlanScreen
          key={planKey(view.origin)}
          plan={view.plan}
          map={view.map}
          onPickAnother={backToPicker}
          save={saveControlFor(view.origin, view.saveState, saveCurrent)}
          importMeta={view.importMeta}
        />
      )
    default:
      return (
        <LibraryScreen
          savedRecipes={library.list()}
          onOpenSaved={openSaved}
          onPick={openRecipe}
          onImport={openImport}
        />
      )
  }
}

/** Uniquely identifies a plan's origin for `PlanScreen`'s `key`, so a library open
 * remounts just like a server open — never conflated with a same-slug/same-id recipe
 * opened a different way. */
function planKey(origin: PlanOrigin): string {
  switch (origin.kind) {
    case 'server':
      return `server:${origin.recipeId}`
    case 'library':
      return `library:${origin.id}`
    case 'import':
      return `import:${origin.payload.graph.id}`
  }
}

/** The Save control shown for a given origin (M2.12 design decision 4): nothing for a
 * fixture recipe, the static "Saved" mark for one opened from the library, and a live
 * Save / Update saved copy / Saved / error control for a freshly imported one. */
function saveControlFor(
  origin: PlanOrigin,
  saveState: SaveState,
  onSave: () => void,
): SaveControl | undefined {
  if (origin.kind === 'server') return undefined
  if (origin.kind === 'library') return { status: 'saved', existing: true, onSave: () => {} }

  const existing = library.findBySource(canonicalSourceKey(origin.payload.graph.source)) != null
  return { status: saveState.status, existing, message: saveState.message, onSave }
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
