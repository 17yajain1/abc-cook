import type { ImportMeta, ImportOriginal, RecipePlanResponse, SavedLibrary, SavedRecipe } from '@abc-cook/schema'

import { reconcileChoice, type ServingsChoice } from '@/lib/servings'

import { toStored } from './servingsPersist'
import { canonicalSourceKey } from './sourceKey'

/**
 * The saved-recipe library: pure logic over an injected storage, so it runs under
 * Vitest's node environment and becomes M3's Zustand `persist` storage unchanged
 * (M2.12 design decisions 1-2). No I/O of its own — `createLibrary` is the only place
 * that touches `storage`.
 */

const STORAGE_KEY = 'abc-cook:library:v1'

/** The subset of the `Storage` interface this module needs — real `localStorage`
 * satisfies it, and tests inject an in-memory fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type SaveResult =
  | { ok: true; recipe: SavedRecipe; replaced: boolean; withoutOriginal: boolean }
  | { ok: false; message: string }

/** What an import adds beside the payload: the post-processing inputs and the version
 * stamp of the code that produced the payload. Both optional: a feed save has neither. */
export interface SaveExtras {
  original?: ImportOriginal | null
  postprocess_version?: number | null
  /** The cook's servings choice. `undefined` keeps an existing entry's value (a new entry
   * gets null); anything else, null included, replaces it (R4b Q4). */
  servings_choice?: ServingsChoice | null
}

/** A re-derived copy of a saved recipe's payload (reprocess, or a feed replacement). */
export interface RefreshInput {
  payload: RecipePlanResponse
  import_meta: ImportMeta | null
  postprocess_version: number
}

export type RefreshResult = { ok: true; recipe: SavedRecipe } | { ok: false; message: string }

export interface Library {
  /** Saved entries, newest `updated_at` first. */
  list(): SavedRecipe[]
  get(id: string): SavedRecipe | undefined
  findBySource(sourceKey: string): SavedRecipe | undefined
  /** Saves `payload`. Replaces the existing entry in place when its source was already
   * saved (keeps `id`/`saved_at`, bumps `updated_at`); otherwise creates one.
   * `importMeta` is `null` for a fixture recipe (never went through `/import`).
   * If the write fails while `extras.original` is set, retries once without it: the
   * recipe is worth more than its refresh inputs (`SaveResult.withoutOriginal`). */
  save(payload: RecipePlanResponse, importMeta?: ImportMeta | null, extras?: SaveExtras): SaveResult
  /** Replaces the derived copy (payload, import_meta, stamp) of entry `id` in place:
   * `id`, `source_key`, both timestamps, `original` and `edits` are untouched, so the
   * Cookbook order doesn't move. Rejects a payload whose source key differs. */
  refresh(id: string, next: RefreshInput): RefreshResult
  /** Stores the cook's servings choice on entry `id`, and nothing else: both timestamps and
   * the Cookbook order are untouched. Factor 1 is stored as null, and the value is
   * reconciled against the entry's own payload first. */
  setServingsChoice(id: string, choice: ServingsChoice | null): RefreshResult
}

/** Builds a `Library` backed by `storage` (`window.localStorage` by default) and reads
 * it once, synchronously, at construction. */
export function createLibrary(
  storage: StorageLike = window.localStorage,
  now: () => Date = () => new Date(),
): Library {
  let recipes: SavedRecipe[] = readLibrary(storage, now)

  return {
    list(): SavedRecipe[] {
      return [...recipes].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    },

    get(id: string): SavedRecipe | undefined {
      return recipes.find((r) => r.id === id)
    },

    findBySource(sourceKey: string): SavedRecipe | undefined {
      return recipes.find((r) => r.source_key === sourceKey)
    },

    save(payload: RecipePlanResponse, importMeta: ImportMeta | null = null, extras?: SaveExtras): SaveResult {
      const sourceKey = canonicalSourceKey(payload.graph.source)
      const existing = recipes.find((r) => r.source_key === sourceKey)
      const timestamp = now().toISOString()
      const stamp = extras?.postprocess_version ?? null
      // Q4: a provided choice wins, `undefined` keeps what the entry had; either way it must
      // still fit the payload being stored.
      const choice = reconcileChoice(
        extras?.servings_choice !== undefined ? extras.servings_choice : existing?.servings_choice,
        payload.graph,
        importMeta,
      )

      const build = (original: ImportOriginal | null): SavedRecipe =>
        existing
          ? {
              ...existing,
              payload,
              import_meta: importMeta,
              original,
              postprocess_version: stamp,
              edits: existing.edits ?? [],
              servings_choice: choice,
              updated_at: timestamp,
            }
          : {
              id: generateId(),
              source_key: sourceKey,
              saved_at: timestamp,
              updated_at: timestamp,
              payload,
              import_meta: importMeta,
              original,
              postprocess_version: stamp,
              edits: [],
              servings_choice: choice,
            }
      const replaceIn = (list: SavedRecipe[], recipe: SavedRecipe) =>
        existing ? list.map((r) => (r.id === recipe.id ? recipe : r)) : [...list, recipe]

      let recipe = build(extras?.original ?? null)
      let written = writeLibrary(storage, replaceIn(recipes, recipe))
      let withoutOriginal = false
      if (!written.ok && recipe.original != null) {
        // `original` is the bulky part. Keep the plan the user just paid for; this entry
        // simply can't be refreshed free later and falls back to Re-import.
        recipe = build(null)
        written = writeLibrary(storage, replaceIn(recipes, recipe))
        withoutOriginal = true
      }
      if (!written.ok) return written

      recipes = replaceIn(recipes, recipe)
      return { ok: true, recipe, replaced: existing != null, withoutOriginal }
    },

    refresh(id: string, next: RefreshInput): RefreshResult {
      const existing = recipes.find((r) => r.id === id)
      if (!existing) return { ok: false, message: 'That recipe is no longer saved.' }
      if (canonicalSourceKey(next.payload.graph.source) !== existing.source_key) {
        return { ok: false, message: 'The refreshed recipe is for a different source.' }
      }

      const recipe: SavedRecipe = {
        ...existing,
        payload: next.payload,
        import_meta: next.import_meta,
        postprocess_version: next.postprocess_version,
        servings_choice: reconcileChoice(existing.servings_choice, next.payload.graph, next.import_meta),
      }
      const list = recipes.map((r) => (r.id === id ? recipe : r))
      const written = writeLibrary(storage, list)
      if (!written.ok) return written

      recipes = list
      return { ok: true, recipe }
    },

    setServingsChoice(id: string, choice: ServingsChoice | null): RefreshResult {
      const existing = recipes.find((r) => r.id === id)
      if (!existing) return { ok: false, message: 'That recipe is no longer saved.' }

      const recipe: SavedRecipe = {
        ...existing,
        servings_choice: toStored(reconcileChoice(choice, existing.payload.graph, existing.import_meta)),
      }
      const list = recipes.map((r) => (r.id === id ? recipe : r))
      const written = writeLibrary(storage, list)
      if (!written.ok) return written

      recipes = list
      return { ok: true, recipe }
    },
  }
}

/** Reads and validates the stored library. Tolerant by design (CLAUDE.md: the app must
 * never fail to show a recipe) — every failure mode degrades to an empty library rather
 * than throwing, and unreadable data is preserved under a timestamped key rather than
 * silently dropped, so the very next `save()` doesn't overwrite it for good. */
function readLibrary(storage: StorageLike, now: () => Date): SavedRecipe[] {
  const raw = safeGetItem(storage, STORAGE_KEY)
  if (raw == null) return []

  const parsed = tryParseJson(raw)
  if (!isSavedLibraryShape(parsed)) {
    salvageUnreadable(storage, raw, now)
    return []
  }

  return parsed.recipes.filter(isStructurallyValidRecipe).map(migrateEntry)
}

/** Normalises one stored entry to the v2 shape. Spreads first, so unknown fields and
 * every v1 field (including a *missing* `import_meta`) pass through byte-identical; only
 * the three v2 fields are filled or repaired, and the servings choice is made safe for the
 * payload it sits beside. A bad `original` or choice never drops the entry. */
export function migrateEntry(entry: SavedRecipe): SavedRecipe {
  return {
    ...entry,
    postprocess_version: Number.isInteger(entry.postprocess_version) ? entry.postprocess_version : null,
    original: isImportOriginalShape(entry.original) ? entry.original : null,
    edits: Array.isArray(entry.edits) ? entry.edits : [],
    servings_choice: reconcileChoice(entry.servings_choice, entry.payload.graph, entry.import_meta),
  }
}

/** Structural check only; the server does the real validation (a 422 is handled where
 * `original` is replayed). */
function isImportOriginalShape(value: unknown): value is ImportOriginal {
  return (
    isPlainObject(value) &&
    isPlainObject(value.recipe) &&
    isPlainObject(value.source) &&
    typeof value.source.value === 'string' &&
    typeof value.source_text === 'string' &&
    typeof value.raw_title === 'string' &&
    typeof value.graph_id === 'string'
  )
}

function writeLibrary(storage: StorageLike, recipes: SavedRecipe[]): { ok: true } | { ok: false; message: string } {
  const body: SavedLibrary = { version: 2, recipes }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(body))
    return { ok: true }
  } catch {
    return { ok: false, message: "Couldn't save on this device — storage may be full." }
  }
}

function salvageUnreadable(storage: StorageLike, raw: string, now: () => Date): void {
  try {
    storage.setItem(`${STORAGE_KEY}:unreadable-${now().getTime()}`, raw)
  } catch {
    // Storage itself is unusable (quota/private mode) — nothing more to do; the read
    // still degrades to an empty library rather than throwing.
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2)}`
}

function safeGetItem(storage: StorageLike, key: string): string | null {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSavedLibraryShape(value: unknown): value is { version: 1 | 2; recipes: unknown[] } {
  return isPlainObject(value) && (value.version === 1 || value.version === 2) && Array.isArray(value.recipes)
}

function isStructurallyValidRecipe(value: unknown): value is SavedRecipe {
  if (!isPlainObject(value)) return false
  const payload = value.payload
  return (
    typeof value.id === 'string' &&
    typeof value.source_key === 'string' &&
    typeof value.saved_at === 'string' &&
    typeof value.updated_at === 'string' &&
    isPlainObject(payload) &&
    'graph' in payload &&
    'plan' in payload &&
    'stages' in payload
  )
}
