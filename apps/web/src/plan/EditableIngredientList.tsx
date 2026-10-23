import { Fragment, useEffect, useRef, type ReactNode } from 'react'

import type { ServingsChoice } from '@/lib/servings'
import { asWrittenLine, importedLines, removeWarning, type FieldState } from '@/library/ingredientEditor'
import { importedLine, stepUsage } from '@/library/recipeEdits'
import { EDIT_THE_STEP, RENAME_NOTE_COPY, renameNoteSteps } from '@/library/renameNote'

import { EditedTag } from './EditedTag'
import { PencilIcon } from './editorParts'
import { IngredientEditorBody } from './IngredientEditorBody'
import { IngredientRow } from './IngredientRow'
import type { IngredientListGroup } from './ingredientGroups'
import type { StepChoiceGroup } from './stepRows'
import type { PlanEditing, useRecipeEditing } from './useRecipeEditing'

/** What the recipe page needs to draw editing: the saved entry's context and the session. */
export interface IngredientsEdit {
  editing: PlanEditing
  api: ReturnType<typeof useRecipeEditing>
  /** The page's servings choice, for the A1 line. */
  choice: ServingsChoice | null
  /** R6b D8: the picker's options, one group per stage card in page order. */
  stepGroups: StepChoiceGroup[]
  /** R6b B4: the rename note's "Edit the step": scrolls to that step and opens it. Blocked exits stay put. */
  goToStep: (nodeId: string) => void
}

/**
 * The one sticky edit bar (D7, A24): the hint and Done, shown only while editing so Done stays reachable down
 * a long page. Outside edit mode the header's Edit pill is the way in, and nothing shows here.
 */
export function EditToolbar({ edit, hint }: { edit: IngredientsEdit; hint: string }) {
  const { api } = edit
  if (api.session.mode !== 'edit') return null
  return (
    <div className="sticky top-[var(--plan-bar-h,0px)] z-10 flex items-center justify-between gap-3 border-b border-home-rule bg-home-ground px-5 pb-2 pt-3">
      <p className="min-w-0 flex-1 text-[13px] leading-[1.4] text-home-ink-2">{hint}</p>
      <button
        type="button"
        onClick={() => api.guard('done', () => {})}
        className="inline-flex h-11 flex-shrink-0 items-center rounded-full bg-home-ink px-5 text-[13px] font-semibold text-home-ground"
      >
        Done
      </button>
    </div>
  )
}

function RowEditor({ edit, field, rowId }: { edit: IngredientsEdit; field: FieldState; rowId: string }) {
  const { api, editing } = edit
  const overlay = editing.ctx.overlay
  const edited = overlay.edited.has(rowId)
  const row = overlay.payload.graph.ingredients.find((r) => r.id === rowId)
  const steps = stepUsage(editing.ctx.payload, rowId)
  return (
    <IngredientEditorBody
      field={field}
      onChange={api.change}
      factorLine={asWrittenLine(edit.choice)}
      imported={row ? importedLines(overlay.importedRows.get(rowId) ?? null, row) : null}
      onRestore={edited ? () => api.restore(rowId) : null}
      remove={{
        warning: removeWarning(steps),
        // A removed imported row can be restored, so it only needs a confirm when a step uses it;
        // an added row is deleted for good, so it always does.
        confirm: steps > 0 || overlay.added.has(rowId),
        onRemove: () => api.remove(rowId),
      }}
      writeError={api.session.writeError}
      onDone={api.commitOpen}
      doneLabel="Save"
      stepPicker={overlay.added.has(rowId) ? { groups: edit.stepGroups, value: field.stepNodeId, onChange: (stepNodeId) => api.change({ stepNodeId }) } : null}
    />
  )
}

/** D9: under a row that was just renamed, when a step that uses it still says the old name. */
function RenameNote({ edit, rowId, oldNames }: { edit: IngredientsEdit; rowId: string; oldNames: string[] }) {
  const steps = renameNoteSteps(edit.editing.ctx, rowId, oldNames)
  if (steps.length === 0) return null
  return (
    <li className="my-1 rounded-home-mini bg-home-surface px-3 py-2">
      <p className="text-[13px] leading-[1.4] text-home-ink-2">{RENAME_NOTE_COPY}</p>
      {steps.length === 1 && (
        <button
          type="button"
          onClick={() => edit.goToStep(steps[0])}
          className="flex h-11 items-center text-[13px] font-medium text-home-ink underline underline-offset-2"
        >
          {EDIT_THE_STEP}
        </button>
      )}
    </li>
  )
}

/**
 * The list in edit-capable form: Edited tags, pencils in edit mode, the open row in place, and
 * the Add form at the end (U2, A19).
 */
export function EditableIngredientList({ groups, edit }: { groups: IngredientListGroup[]; edit: IngredientsEdit }) {
  const { api, editing } = edit
  const { session } = api
  const inEdit = session.mode === 'edit'
  const overlay = editing.ctx.overlay
  const openRef = useRef<HTMLLIElement>(null)
  const addRef = useRef<HTMLDivElement>(null)

  // A32: when an exit is blocked or a write fails, the open row's error comes into view.
  useEffect(() => {
    if (api.blocked === 0) return
    const host = openRef.current ?? addRef.current
    const target = host?.querySelector('[role="alert"]') ?? host
    target?.scrollIntoView({ block: 'center' })
  }, [api.blocked])

  const add: ReactNode = session.add ? (
    <div ref={addRef} className="mt-4 rounded-home-card border border-home-ink bg-home-surface p-3">
      <IngredientEditorBody
        field={session.add}
        onChange={api.change}
        factorLine={asWrittenLine(edit.choice)}
        imported={null}
        onRestore={null}
        remove={null}
        writeError={session.writeError}
        onDone={api.commitOpen}
        doneLabel="Add ingredient"
        stepPicker={{ groups: edit.stepGroups, value: session.add.stepNodeId, onChange: (stepNodeId) => api.change({ stepNodeId }) }}
      />
    </div>
  ) : inEdit ? (
    <button
      type="button"
      onClick={api.openAdd}
      className="mt-2 flex h-11 items-center text-[15px] font-medium text-home-ink underline underline-offset-2"
    >
      Add ingredient
    </button>
  ) : null

  return (
    <>
      {groups.map((group) => (
        <div key={group.key} className="mt-6 first:mt-0">
          {group.heading && <h3 className="mb-1 text-[13px] font-semibold text-home-ink">{group.heading}</h3>}
          <ul>
            {group.items.map((item) => {
              if (session.open?.target.kind === 'row' && session.open.target.id === item.key) {
                return (
                  <li key={item.key} ref={openRef} className="my-2 rounded-home-card border border-home-ink bg-home-surface p-3">
                    <RowEditor edit={edit} field={session.open} rowId={item.key} />
                  </li>
                )
              }
              const edited = overlay.edited.has(item.key)
              const note = session.renameNote?.rowId === item.key ? session.renameNote : null
              return (
                <Fragment key={item.key}>
                  <IngredientRow
                    primary={
                      <>
                        {inEdit ? (
                          <button type="button" onClick={() => api.openRowById(item.key)} className="text-left">
                            {item.name}
                          </button>
                        ) : (
                          item.name
                        )}
                        {item.optional && <span className="ml-2 text-[13px] text-home-ink-2">optional</span>}
                        {edited && <EditedTag onClick={() => api.openRowById(item.key)} />}
                      </>
                    }
                    trailing={
                      <span className="inline-flex items-center gap-1">
                        <span className="text-right">
                          {item.trailing}
                          {item.note && <span className="block text-[12px] font-normal">{item.note}</span>}
                        </span>
                        {inEdit && (
                          <button
                            type="button"
                            aria-label={`Edit ${item.name}`}
                            onClick={() => api.openRowById(item.key)}
                            className="flex h-11 w-9 items-center justify-end text-home-ink"
                          >
                            <PencilIcon />
                          </button>
                        )}
                      </span>
                    }
                  />
                  {note && inEdit && <RenameNote edit={edit} rowId={item.key} oldNames={note.oldNames} />}
                </Fragment>
              )
            })}
          </ul>
        </div>
      ))}
      {inEdit && overlay.removed.length > 0 && (
        <div className="mb-6 mt-6">
          <h3 className="mb-1 text-[13px] font-semibold text-home-ink">Removed by you</h3>
          <ul>
            {overlay.removed.map((r) => (
              <IngredientRow
                key={r.editId}
                primary={<span className="text-home-ink-2">{r.row.name}</span>}
                trailing={
                  <span className="inline-flex items-center gap-3">
                    <span>{importedLine(r.row)}</span>
                    <button
                      type="button"
                      onClick={() => api.restoreRemoved(r.editId)}
                      className="flex h-11 items-center text-[13px] font-medium text-home-ink underline underline-offset-2"
                    >
                      Restore original
                    </button>
                  </span>
                }
              />
            ))}
          </ul>
          {session.writeError && !session.open && !session.add && (
            <p role="alert" className="mt-1 text-[13px] text-home-terracotta-text">
              {session.writeError}
            </p>
          )}
        </div>
      )}
      {add}
    </>
  )
}
