import { useCallback, useEffect, useRef, useState } from 'react'

import type { Ingredient, RecipeEdit } from '@abc-cook/schema'

import {
  editField,
  editStepText,
  EDITOR_COPY,
  leave,
  openAddForm,
  openRow,
  openStepForm,
  startEditing,
  startEditingAt,
  startEditingAtStep,
  type EditContext,
  type EditSession,
  type LeaveKind,
  type WriteEdits,
} from '@/library/ingredientEditor'
import { discardEdit, newEditId, removeRow, restoreEdit, restoreRow, unlinkAdd, type Orphan } from '@/library/recipeEdits'
import { restoreStep } from '@/library/stepEditor'

/** What the recipe page needs to offer editing. Absent for a recipe with no saved entry (Q4). */
export interface PlanEditing {
  /** The imported payload, the stored edits, and the overlay they make. */
  ctx: EditContext
  /** The imported rows: what decides whether the servings control is gated (A13). */
  gateLines: ReadonlyArray<Ingredient>
  /** Writes the edits to the saved entry; `ok: false` when the write failed (A8). */
  write: WriteEdits
}

const CLOSED: EditSession = { mode: 'view', open: null, add: null, step: null, writeError: null, renameNote: null, savedStep: null }

const deps = () => ({ now: new Date().toISOString(), newId: newEditId })

/**
 * R6a/R6b: the edit session for the recipe page, as React state around the pure machine in
 * `library/ingredientEditor`. One session serves both tabs: an ingredient row, the Add form or a
 * step is open at most one at a time. `guard` is the one door out of the editor (A24): Done, a
 * tab, Start cooking, back and closing the open step's card all go through it, so a changed field
 * is committed or kept open, never dropped.
 */
export function useRecipeEditing(editing: PlanEditing | undefined) {
  const [session, setSession] = useState<EditSession>(CLOSED)
  /** Counts the times an exit was blocked or a write failed, so the page can scroll the open editor into view (A32). */
  const [blocked, setBlocked] = useState(0)
  const bump = useCallback(() => setBlocked((n) => n + 1), [])
  /** The step just opened from outside its own row (the Edited tag, "Edit the step"), which the page centres once. */
  const [landing, setLanding] = useState<string | null>(null)
  const clearLanding = useCallback(() => setLanding(null), [])
  const latest = useRef({ editing, session })
  useEffect(() => {
    latest.current = { editing, session }
  })

  /** Runs `then` once the editor lets the cook go. A committed edit has already been written and
   * the page is about to re-render with it, so `then` runs after that render. */
  const guard = useCallback((kind: LeaveKind, then: () => void) => {
    const { editing: ed, session: s } = latest.current
    if (!ed || s.mode === 'view') {
      then()
      return
    }
    const res = leave(s, kind, ed.ctx, ed.write, deps())
    setSession(res.session)
    if (!res.proceed) {
      bump()
      return
    }
    if (res.edits) queueMicrotask(then)
    else then()
  }, [bump])

  const enter = useCallback(() => {
    if (latest.current.editing) setSession(startEditing())
  }, [])

  /** Opens `rowId`: from view mode (A4's Edited tag) it enters edit mode with that row open. */
  const openRowById = useCallback((rowId: string) => {
    const { editing: ed, session: s } = latest.current
    if (!ed) return
    if (s.mode === 'view') {
      setSession(startEditingAt(ed.ctx, rowId))
      return
    }
    const sameRow = s.open?.target.kind === 'row' && s.open.target.id === rowId
    const res = leave(s, 'row', ed.ctx, ed.write, deps())
    if (!res.proceed) {
      setSession(res.session)
      bump()
      return
    }
    setSession(sameRow ? res.session : { ...res.session, open: openRow(ed.ctx, rowId), renameNote: null, savedStep: null })
  }, [bump])

  /** Opens step `nodeId`: from view mode (the step's Edited tag) it enters edit mode with that step open. */
  const openStepById = useCallback((nodeId: string) => {
    const { editing: ed, session: s } = latest.current
    if (!ed) return
    if (s.mode === 'view') {
      setSession(startEditingAtStep(ed.ctx, nodeId))
      setLanding(nodeId)
      return
    }
    const sameStep = s.step?.target.nodeId === nodeId
    const res = leave(s, 'row', ed.ctx, ed.write, deps())
    if (!res.proceed) {
      setSession(res.session)
      bump()
      return
    }
    setSession(sameStep ? res.session : openStepForm(res.session, ed.ctx, nodeId))
  }, [bump])

  /**
   * B4: lands on step `nodeId` after `guard('tab')` has already committed or closed whatever was open.
   * It does not look at the session, which may not have re-rendered yet: a second commit of the same
   * edits would be harmless but wrong.
   */
  const enterAtStep = useCallback((nodeId: string) => {
    const { editing: ed } = latest.current
    if (!ed) return
    setSession(startEditingAtStep(ed.ctx, nodeId))
    setLanding(nodeId)
  }, [])

  /** The open row's, the Add form's or the open step's own Save: commits it and closes it, or keeps it open. */
  const commitOpen = useCallback(() => {
    const { editing: ed, session: s } = latest.current
    if (!ed) return
    const res = leave(s, 'row', ed.ctx, ed.write, deps())
    setSession(res.session)
    if (!res.proceed) bump()
  }, [bump])

  const openAdd = useCallback(() => {
    const { editing: ed, session: s } = latest.current
    if (!ed) return
    const res = leave(s, 'row', ed.ctx, ed.write, deps())
    setSession(res.proceed ? openAddForm(res.session) : res.session)
    if (!res.proceed) bump()
  }, [bump])

  const change = useCallback((patch: Parameters<typeof editField>[1]) => {
    setSession((s) => editField(s, patch))
  }, [])

  const changeStep = useCallback((text: string) => {
    setSession((s) => editStepText(s, text))
  }, [])

  /** Writes `next`; closes the open editor on success, keeps it open with the A8 message otherwise. */
  const writeAndClose = useCallback((next: RecipeEdit[]) => {
    const { editing: ed } = latest.current
    if (!ed) return
    if (ed.write(next).ok) setSession((s) => ({ ...s, open: null, step: null, writeError: null }))
    else {
      setSession((s) => ({ ...s, writeError: EDITOR_COPY.writeFailed }))
      bump()
    }
  }, [bump])

  /** Restore original: deletes every edit on the row. */
  const restore = useCallback(
    (rowId: string) => {
      const { editing: ed } = latest.current
      if (ed) writeAndClose(restoreRow(ed.ctx.edits, ed.ctx.payload, rowId))
    },
    [writeAndClose],
  )

  /** Restore original on a step: deletes its text edit. */
  const restoreStepText = useCallback(
    (nodeId: string) => {
      const { editing: ed } = latest.current
      if (ed) writeAndClose(restoreStep(ed.ctx, nodeId))
    },
    [writeAndClose],
  )

  const remove = useCallback(
    (rowId: string) => {
      const { editing: ed } = latest.current
      if (ed) writeAndClose(removeRow(ed.ctx.edits, ed.ctx.payload, rowId, { id: newEditId(), now: new Date().toISOString() }))
    },
    [writeAndClose],
  )

  /** A26: restores a removed ingredient by deleting its remove edit. A failed write shows the A8 line. */
  const restoreRemoved = useCallback(
    (editId: string) => {
      const { editing: ed } = latest.current
      if (!ed) return
      if (ed.write(restoreEdit(ed.ctx.edits, editId)).ok) setSession((s) => ({ ...s, writeError: null }))
      else {
        setSession((s) => ({ ...s, writeError: EDITOR_COPY.writeFailed }))
        bump()
      }
    },
    [bump],
  )

  /**
   * The orphan review's button. A step or ingredient change is discarded; a link orphan is unlinked:
   * the add is rewritten with no step and the ingredient stays (Q3). Returns the failure message, or null.
   */
  const discard = useCallback((orphan: Orphan): string | null => {
    const { editing: ed } = latest.current
    if (!ed) return null
    const next = orphan.kind === 'link' ? unlinkAdd(ed.ctx.edits, orphan.id) : discardEdit(ed.ctx.edits, orphan.id)
    return ed.write(next).ok ? null : EDITOR_COPY.writeFailed
  }, [])

  return {
    session,
    blocked,
    landing,
    clearLanding,
    enter,
    openRowById,
    openStepById,
    enterAtStep,
    commitOpen,
    openAdd,
    change,
    changeStep,
    restore,
    restoreStepText,
    restoreRemoved,
    remove,
    discard,
    guard,
  }
}
