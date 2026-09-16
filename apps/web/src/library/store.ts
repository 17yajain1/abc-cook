import type { ImportMeta, RecipePlanResponse, SavedLibrary, SavedRecipe } from '@abc-cook/schema'

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
  | { ok: true; recipe: SavedRecipe; replaced: boolean }
  | { ok: false; message: string }

export interface Library {
  /** Saved entries, newest `updated_at` first. */
  list(): SavedRecipe[]
  get(id: string): SavedRecipe | undefined
  findBySource(sourceKey: string): SavedRecipe | undefined
  /** Saves `payload`. Replaces the existing entry in place when its source was already
   * saved (keeps `id`/`saved_at`, bumps `updated_at`); otherwise creates one.
   * `importMeta` is `null` for a fixture recipe (never went through `/import`). */
  save(payload: RecipePlanResponse, importMeta?: ImportMeta | null): SaveResult
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

    save(payload: RecipePlanResponse, importMeta: ImportMeta | null = null): SaveResult {
      const sourceKey = canonicalSourceKey(payload.graph.source)
      const existing = recipes.find((r) => r.source_key === sourceKey)
      const timestamp = now().toISOString()

      const recipe: SavedRecipe = existing
        ? { ...existing, payload, import_meta: importMeta, updated_at: timestamp }
        : {
            id: generateId(),
            source_key: sourceKey,
            saved_at: timestamp,
            updated_at: timestamp,
            payload,
            import_meta: importMeta,
          }

      const next = existing ? recipes.map((r) => (r.id === recipe.id ? recipe : r)) : [...recipes, recipe]

      const written = writeLibrary(storage, next)
      if (!written.ok) return written

      recipes = next
      return { ok: true, recipe, replaced: existing != null }
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

  return parsed.recipes.filter(isStructurallyValidRecipe)
}

function writeLibrary(storage: StorageLike, recipes: SavedRecipe[]): { ok: true } | { ok: false; message: string } {
  const body: SavedLibrary = { version: 1, recipes }
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

function isSavedLibraryShape(value: unknown): value is SavedLibrary {
  return isPlainObject(value) && value.version === 1 && Array.isArray(value.recipes)
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
