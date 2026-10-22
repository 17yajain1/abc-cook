import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { RenderPlan } from '../plan/derive'
import type { ImportExtras } from './importExtras'
import type { ScrollAnchor } from './scrollAnchor'

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
  /** Where the cook was reading on the importing page, so the plan page opens at the same place. */
  scrollAnchor: ScrollAnchor | null
}

/** What the import flow asks of `App`: `save` is called once when the plan is done, `open` straight after. */
export interface ImportHandlers {
  save(payload: RecipePlanResponse, importMeta: ImportMeta, extras: ImportExtras): SaveState
  open(finished: FinishedImport): void
}

/**
 * The done step of an import: save the entry, then open it at once. There is no tap to wait for: the
 * importing page is the recipe page, and the finished plan replaces its draft in place (D1). The save
 * always comes first and happens exactly once, so a finished import is in the Cookbook whatever happens
 * to the screen next.
 */
export function completeImport(done: Omit<FinishedImport, 'saveState'>, handlers: ImportHandlers): void {
  const saveState = handlers.save(done.payload, done.importMeta, done.extras)
  handlers.open({ ...done, saveState })
}
