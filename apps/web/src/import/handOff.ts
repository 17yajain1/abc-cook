import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { RenderPlan } from '../plan/derive'
import type { ImportExtras } from './importExtras'

/** Whether the finished import's entry is in the Cookbook. `error` keeps the plan's Save
 * control live so the person can retry. */
export type SaveState = { status: 'idle' | 'saved' | 'error'; message?: string }

/** A built, validated plan with everything `App` needs to save it and to open it. */
export interface FinishedImport {
  plan: RenderPlan
  payload: RecipePlanResponse
  importMeta: ImportMeta
  extras: ImportExtras
  saveState: SaveState
}

/** What the import flow asks of `App`, split in two so saving and opening can happen at
 * different moments: `save` is called once when the plan is done, `open` once when the person
 * is looking at it (their tap, or straight away when there was nothing to read). */
export interface ImportHandlers {
  save(payload: RecipePlanResponse, importMeta: ImportMeta, extras: ImportExtras): SaveState
  open(finished: FinishedImport): void
}

/**
 * How a finished import reaches the recipe page. When the reading screen showed anything
 * (the source's lines or the draft), the cook is reading it, so the page does not change
 * under them: they tap "Your plan is ready". When it showed nothing (a cache hit, or a job
 * that finished before anything streamed) there is nothing to interrupt, and it opens at
 * once, as it always did.
 */
export function handOffFor(shownReadable: boolean): 'tap' | 'auto' {
  return shownReadable ? 'tap' : 'auto'
}

/**
 * The done step of an import: save the entry, then either open it or park it for a tap.
 * The save always comes first and happens exactly once, so a finished import is in the
 * Cookbook even if the cook closes the screen without tapping.
 */
export function completeImport(
  done: Omit<FinishedImport, 'saveState'>,
  shownReadable: boolean,
  handlers: ImportHandlers,
): { kind: 'opened' } | { kind: 'ready'; finished: FinishedImport } {
  const saveState = handlers.save(done.payload, done.importMeta, done.extras)
  const finished: FinishedImport = { ...done, saveState }
  if (handOffFor(shownReadable) === 'auto') {
    handlers.open(finished)
    return { kind: 'opened' }
  }
  return { kind: 'ready', finished }
}
