import { createContext, useContext } from 'react'

import type { SavedStep } from '@/library/ingredientEditor'
import type { StepFieldState } from '@/library/stepEditor'

/**
 * R6b: what a step row needs to be editable. `PlanScreen` provides it around the Plan tab when the
 * recipe has a saved entry to edit; without it (an unsaved view) a row draws exactly as before.
 * It carries state and callbacks only: every rule lives in `library/`.
 */
export interface StepEditApi {
  /** Edit mode is on (the Plan tab's Edit control, shared with the Ingredients tab). */
  inEdit: boolean
  /** Ids of the steps whose text an edit changed. */
  edited: ReadonlySet<string>
  /** For an edited step, its instruction as imported. */
  importedSteps: ReadonlyMap<string, string>
  /** The open step, if any. */
  step: StepFieldState | null
  /** The step saved last in this sitting, for the amount hint (B20). */
  savedStep: SavedStep | null
  /** A1: shown above the field when the page is at a size other than as written. */
  factorLine: string | null
  writeError: string | null
  /** Counts blocked exits, so the open editor scrolls into view (A32). */
  blocked: number
  /** The step to centre when it opens from outside its own row (the Edited tag, "Edit the step"). */
  landing: string | null
  onLanded: () => void
  open: (nodeId: string) => void
  change: (text: string) => void
  save: () => void
  restore: (nodeId: string) => void
}

export const StepEditContext = createContext<StepEditApi | null>(null)

export function useStepEdit(): StepEditApi | null {
  return useContext(StepEditContext)
}

/** B25: whether step `nodeId`'s editor is open, so its row can give the editor the full width. */
export function useStepOpen(nodeId: string): boolean {
  return useContext(StepEditContext)?.step?.target.nodeId === nodeId
}
