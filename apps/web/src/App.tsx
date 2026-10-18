import { useCallback, useMemo, useRef, useState } from 'react'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import { ApiError, fetchPlan, fetchServerInfo, reprocess } from './api/client'
import { createServerVersion } from './api/serverVersion'
import { deriveCookingModel } from './cooking/model'
import { createSessionStore } from './cooking/store'
import { canResolveConflictTarget, resolveConflictTarget } from './cooking-mode/conflictResolve'
import { CookingModeScreen } from './cooking-mode/CookingModeScreen'
import { planKeyFor, type PlanOrigin } from './cooking-mode/planKey'
import { startIfNone } from './cooking-mode/startCooking'
import { ImportScreen } from './import/ImportScreen'
import type { FinishedImport, ImportHandlers, SaveState } from './import/handOff'
import type { ImportExtras } from './import/importExtras'
import { canonicalSourceKey } from './library/sourceKey'
import { openSavedChecked, openSavedNow, type Marker, type OpenDeps } from './library/openSaved'
import { sessionBlocksRefresh } from './library/staleness'
import { createLibrary } from './library/store'
import { createOutbox, type SessionFinished } from './metrics/outbox'
import { derivePlan, type RenderPlan } from './plan/derive'
import { PlanScreen } from './plan/PlanScreen'
import type { StalenessMarker } from './plan/staleness'
import type { AlreadySaved } from './plan/AlreadySavedNotice'
import type { SaveControl } from './plan/RecipeHeader'
import { NO_IMPORT_META } from './feed/saveFromFeed'
import { AppShell } from './shell/AppShell'

/** Single instance for the app's lifetime — reads `localStorage` once, synchronously,
 * at module load; every save/read after that goes through this same closure (M2.12
 * design: this becomes M3's Zustand `persist` storage unchanged). */
const library = createLibrary()

/** The server's `POSTPROCESS_VERSION`, learned lazily from `/health` and from import and
 * reprocess responses. Same module-scope pattern as `library` and `sessionStore`. */
const serverVersion = createServerVersion(fetchServerInfo)

/** Same instantiation pattern as `library` above — one `SessionStore` for the app's
 * lifetime, reading `localStorage['abc-cook:session:v1']` once at module load
 * (`@/cooking/store.ts`). `useSession` binds React to it with `useSyncExternalStore`. */
const sessionStore = createSessionStore(window.localStorage, () => Date.now())

/** M5 completion metric: confirmed session completions land in a local, de-duplicated
 * outbox (`abc-cook:events:v1`). Nothing sends them anywhere yet — transport is later M5
 * work. A failed append is intentionally ignored: it must never block finishing a cook. */
const outbox = createOutbox()
const emitCompletion = (event: SessionFinished): void => {
  outbox.append(event)
}

/** Ends the stored session only when it belongs to library entry `id` (the store holds one
 * session at most, and `end` clears whichever it has). Emits no metric: ending a stale
 * session is not a completion (staleness plan A3). */
const endSessionIfFor = (id: string): void => {
  if (sessionStore.getState()?.planKey === `library:${id}`) sessionStore.dispatch({ type: 'end', now: Date.now() })
}

/** Effects the open path needs, bound to the real stores. The feed chunk is loaded lazily,
 * and only for an entry that has no `original`. */
const openDeps: OpenDeps = {
  library,
  serverVersion,
  reprocess,
  findInFeed: (sourceKey) =>
    import('./feed/source').then((m) => m.loadFeedSource()).then((feed) => feed.findBySourceKey(sourceKey)),
  getSession: () => sessionStore.getState(),
  endSessionIfFor,
  now: () => Date.now(),
}

type View =
  | { kind: 'home' }
  | { kind: 'import'; initialUrl?: string; skipDuplicateCheck?: boolean }
  | { kind: 'loading'; label: string }
  | {
      kind: 'plan'
      plan: RenderPlan
      origin: PlanOrigin
      saveState: SaveState
      /** A6: null for a fixture recipe (never went through `/import`). */
      importMeta: ImportMeta | null
      /** The raw payload `plan` was derived from — Cooking Mode's
       * `deriveCookingModel` needs the full graph (`depends_on`, `consumes`,
       * `interruptible`…), which `RenderPlan` doesn't retain. */
      payload: RecipePlanResponse
      /** Set when the open path found the saved plan stale or couldn't check. */
      staleness?: StalenessMarker
      /** Set only when a pasted URL matched this saved entry (the duplicate path). */
      alreadySaved?: AlreadySaved
    }
  | { kind: 'cooking'; payload: RecipePlanResponse; planKey: string; returnTo: View }
  | { kind: 'error'; message: string }

export default function App() {
  const [view, setView] = useState<View>({ kind: 'home' })

  // Bumped by every navigation. A late `openSaved` check compares against it, so a slow
  // response can never overwrite a view the person has since moved to.
  const navToken = useRef(0)

  const openRecipe = useCallback((recipeId: string) => {
    navToken.current += 1
    setView({ kind: 'loading', label: recipeId })
    fetchPlan(recipeId)
      .then((payload) =>
        setView({
          kind: 'plan',
          plan: derivePlan(payload),
          origin: { kind: 'server', recipeId },
          saveState: { status: 'idle' },
          importMeta: null,
          payload,
        }),
      )
      .catch((err: unknown) => setView({ kind: 'error', message: messageFor(err) }))
  }, [])

  // The plan is already on the device, so a recipe whose stamp is known current (or whose
  // cook is in progress) opens at once with no request. Anything else shows a loading
  // state for at most `OPEN_BUDGET_MS` while `openSavedChecked` refreshes or marks it.
  const openSaved = useCallback((id: string, opts?: { alreadySaved?: boolean }) => {
    const token = ++navToken.current
    const show = (outcome: Awaited<ReturnType<typeof openSavedChecked>>) => {
      if (navToken.current !== token) return
      if ('missing' in outcome) {
        setView({ kind: 'error', message: "That recipe isn't in your library any more." })
        return
      }
      const { recipe, marker } = outcome
      setView({
        kind: 'plan',
        plan: derivePlan(recipe.payload, recipe.import_meta?.provenance ?? null),
        origin: { kind: 'library', id },
        saveState: { status: 'saved' },
        importMeta: recipe.import_meta ?? null,
        payload: recipe.payload,
        staleness: stalenessFor(marker, recipe.payload.graph.source.value, () =>
          setView({
            kind: 'import',
            initialUrl: recipe.payload.graph.source.value,
            skipDuplicateCheck: true,
          }),
        ),
        // Only the duplicate path sets it. The Cookbook, the feed and a conflict "Go to" never do.
        alreadySaved:
          opts?.alreadySaved && recipe.payload.graph.source.kind === 'url'
            ? {
                onImportAgain: () =>
                  setView({
                    kind: 'import',
                    initialUrl: recipe.payload.graph.source.value,
                    skipDuplicateCheck: true,
                  }),
              }
            : undefined,
      })
    }

    const now = openSavedNow(openDeps, id)
    if (now) {
      show(now)
      return
    }
    setView({ kind: 'loading', label: library.get(id)?.payload.graph.title ?? '' })
    void openSavedChecked(openDeps, id).then(show)
  }, [])

  // A feed recipe opens as an unsaved import, so the header's Save and `saveCurrent` handle
  // "save from the plan" with no new path. TODO(H2): `emitCompletion` records only
  // `plan_key`, so a feed-opened plan reports `import:<graph.id>` (or `library:<id>` once
  // saved) — H2 must decide whether feed opens get their own key.
  const openFeedRecipe = useCallback((payload: RecipePlanResponse) => {
    navToken.current += 1
    setView({
      kind: 'plan',
      plan: derivePlan(payload),
      origin: { kind: 'import', payload, importMeta: NO_IMPORT_META, fromFeed: true },
      saveState: { status: 'idle' },
      importMeta: NO_IMPORT_META,
      payload,
    })
  }, [])

  // Back from a plan: the shell remounts on the tab the person left from (Home or Cookbook).
  // TODO(R1): a recipe opened from the feed's See all list comes back to Home, not to See
  // all — the shell's `seeAll` state is lost when it unmounts for the plan.
  const backToHome = useCallback(() => {
    navToken.current += 1
    setView({ kind: 'home' })
  }, [])
  const openImport = useCallback(() => {
    navToken.current += 1
    setView({ kind: 'import' })
  }, [])
  // Every finished import lands in the library as soon as the job is done (`saveImported`),
  // whether or not the cook has opened it yet; re-importing the same source replaces its
  // entry (`library.save` dedups by source key). Opening it (`openImported`) is a separate
  // step: the cook's tap on "Your plan is ready", or at once when nothing was on screen to
  // read. On a failed write the origin stays `import`, so the header's Save control still
  // offers a retry.
  const saveImported = useCallback(
    (payload: RecipePlanResponse, importMeta: ImportMeta, extras: ImportExtras): SaveState => {
      const result = library.save(payload, importMeta, extras)
      if (extras.postprocess_version != null) serverVersion.note(extras.postprocess_version)
      // A re-import replaces an existing entry, so a stale session on it goes too, unless
      // a cook is in progress: that one is left alone and keeps the existing conflict
      // behaviour.
      if (result.ok && result.replaced && !sessionBlocksRefresh(sessionStore.getState(), result.recipe.id, Date.now())) {
        endSessionIfFor(result.recipe.id)
      }
      return result.ok ? { status: 'saved' } : { status: 'error', message: result.message }
    },
    [],
  )
  const openImported = useCallback(({ plan, payload, importMeta, extras, saveState }: FinishedImport) => {
    setView({
      kind: 'plan',
      plan,
      origin: { kind: 'import', payload, importMeta, extras },
      saveState,
      importMeta,
      payload,
    })
  }, [])
  const importHandlers = useMemo<ImportHandlers>(
    () => ({ save: saveImported, open: openImported }),
    [saveImported, openImported],
  )

  // P1 #6 §C5: the side effect (starting a session if none is open) happens here, in
  // the click handler — never inside the `setView` updater, and never a mount effect.
  // `main.tsx` renders in `StrictMode`, which double-invokes both of those; an event
  // handler runs exactly once per click regardless. Reading `view` from the closure
  // (not a functional update) is what lets `startIfNone` see the same payload/origin
  // `setView` is about to commit.
  const startCooking = useCallback(() => {
    if (view.kind !== 'plan') return
    const model = deriveCookingModel(view.payload, view.importMeta?.provenance ?? null)
    const key = planKey(view.origin)
    startIfNone(sessionStore, model, key, Date.now(), view.payload.graph.title)
    setView({ kind: 'cooking', payload: view.payload, planKey: key, returnTo: view })
  }, [view])

  const exitCooking = useCallback(() => {
    setView((prev) => (prev.kind === 'cooking' ? prev.returnTo : prev))
  }, [])

  // CP1b conflict actions. Neither touches `sessionStore` — "Go to" only ever switches
  // which plan `CookingModeScreen` is mounted against, so its own `session.open()` finds
  // and opens the *same* stored session rather than creating or replacing one.
  const canGoToConflict = useCallback(
    (targetPlanKey: string) => canResolveConflictTarget(targetPlanKey, (id) => library.get(id) != null),
    [],
  )

  // Resolves only through paths the app already has: the library store, or `fetchPlan`
  // (the same call `openRecipe` already makes) — never a new endpoint. `import:` plan
  // keys are never passed here (`canGoToConflict` hides "Go to" for them); a `library:`
  // id can still race a deletion between render and click, or a `server:` fetch can
  // fail — both fall back to this app's existing degraded paths (a no-op, or the
  // existing `error` view), never an invented destination.
  const goToConflict = useCallback((targetPlanKey: string) => {
    const target = resolveConflictTarget(targetPlanKey, (id) => library.get(id) != null)

    if (target.kind === 'library') {
      const recipe = library.get(target.id)
      if (!recipe) return
      const planView: View = {
        kind: 'plan',
        plan: derivePlan(recipe.payload, recipe.import_meta?.provenance ?? null),
        origin: { kind: 'library', id: target.id },
        saveState: { status: 'saved' },
        importMeta: recipe.import_meta ?? null,
        payload: recipe.payload,
      }
      setView({ kind: 'cooking', payload: recipe.payload, planKey: targetPlanKey, returnTo: planView })
      return
    }

    if (target.kind === 'server') {
      navToken.current += 1
      setView({ kind: 'loading', label: target.recipeId })
      fetchPlan(target.recipeId)
        .then((payload) => {
          const planView: View = {
            kind: 'plan',
            plan: derivePlan(payload),
            origin: { kind: 'server', recipeId: target.recipeId },
            saveState: { status: 'idle' },
            importMeta: null,
            payload,
          }
          setView({ kind: 'cooking', payload, planKey: targetPlanKey, returnTo: planView })
        })
        .catch((err: unknown) => setView({ kind: 'error', message: messageFor(err) }))
      return
    }

    // 'unresolved' — canGoToConflict would have hidden the button; nothing to navigate.
  }, [])

  // No network, no LLM call — `library.save` writes straight to `localStorage`
  // (M2.12 acceptance requirement 2). A functional update avoids a stale `view` closure.
  const saveCurrent = useCallback(() => {
    setView((prev) => {
      if (prev.kind !== 'plan' || prev.origin.kind !== 'import') return prev
      // A feed recipe stores `import_meta: null`, exactly as the card's "Add to cookbook"
      // does, so the staleness check can tell it from a real import.
      const { payload, importMeta, extras, fromFeed } = prev.origin
      const result = library.save(payload, fromFeed ? null : importMeta, extras)
      if (!result.ok) {
        return { ...prev, saveState: { status: 'error', message: result.message } }
      }
      return { ...prev, saveState: { status: 'saved' } }
    })
  }, [])

  switch (view.kind) {
    case 'import':
      return (
        <ImportScreen
          importHandlers={importHandlers}
          onCancel={backToHome}
          initialUrl={view.initialUrl}
          findSaved={(key) => library.findBySource(key)}
          onDuplicate={(saved) => openSaved(saved.id, { alreadySaved: true })}
          skipDuplicateCheck={view.skipDuplicateCheck}
        />
      )
    case 'loading':
      return <Centered>Scheduling {view.label}…</Centered>
    case 'error':
      return (
        <Centered>
          <p className="text-[15px] text-ink">{view.message}</p>
          <button
            type="button"
            onClick={backToHome}
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
          onBack={backToHome}
          onStartCooking={startCooking}
          save={saveControlFor(view.origin, view.saveState, saveCurrent)}
          importMeta={view.importMeta}
          staleness={view.staleness}
          alreadySaved={view.alreadySaved}
        />
      )
    case 'cooking':
      return (
        <CookingModeScreen
          key={view.planKey}
          payload={view.payload}
          provenance={
            view.returnTo.kind === 'plan' ? (view.returnTo.importMeta?.provenance ?? null) : null
          }
          planKey={view.planKey}
          store={sessionStore}
          onExit={exitCooking}
          onGoTo={goToConflict}
          canGoTo={canGoToConflict}
          onFinish={backToHome}
          emitCompletion={emitCompletion}
        />
      )
    default:
      return (
        <AppShell
          library={library}
          sessionStore={sessionStore}
          onResume={goToConflict}
          onOpenSaved={openSaved}
          onPick={openRecipe}
          onImport={openImport}
          importHandlers={importHandlers}
          onOpenFeedRecipe={openFeedRecipe}
        />
      )
  }
}

/** Maps the open path's marker to what `PlanScreen` renders. Re-import needs a URL to
 * prefill, which `openSaved` only allows for a url source. */
function stalenessFor(marker: Marker, url: string, onReimport: () => void): StalenessMarker | undefined {
  if (!marker) return undefined
  if (marker.kind === 'unchecked') return { kind: 'unchecked' }
  return marker.reimport && url ? { kind: 'stale', onReimport } : { kind: 'stale' }
}

/** `planKeyFor` (`@/cooking-mode/planKey.ts`, CP1c), bound to the real `library`. Kept
 * as a thin wrapper here — same call shape as before CP1c (`planKey(origin)`) — so every
 * existing call site (`PlanScreen`'s `key`, `startCooking`) is unchanged; the identity
 * logic itself now lives in the pure, testable module. */
function planKey(origin: PlanOrigin): string {
  return planKeyFor(origin, (sourceKey) => library.findBySource(sourceKey))
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
