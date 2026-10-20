import { useEffect, useRef, type ReactNode } from 'react'

import type { ServingsChoice } from '@/lib/servings'
import { asWrittenLine, importedLines, removeWarning, type FieldState } from '@/library/ingredientEditor'
import { importedLine, stepUsage } from '@/library/recipeEdits'

import { IngredientEditorBody } from './IngredientEditorBody'
import { IngredientRow } from './IngredientRow'
import type { IngredientListGroup } from './ingredientGroups'
import type { PlanEditing, useIngredientEditing } from './useIngredientEditing'

/** What the Ingredients tab needs to draw editing: the saved entry's context and the session. */
export interface IngredientsEdit {
  editing: PlanEditing
  api: ReturnType<typeof useIngredientEditing>
  /** The page's servings choice, for the A1 line. */
  choice: ServingsChoice | null
}

function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  )
}

/** "Edit" / "Done" and the hint, above the list. */
export function EditToolbar({ edit }: { edit: IngredientsEdit }) {
  const { api } = edit
  const editing = api.session.mode === 'edit'
  return (
    <div className="sticky top-[var(--plan-bar-h,0px)] z-10 flex items-center justify-between gap-3 bg-home-ground px-5 pb-2 pt-3">
      <p className="min-w-0 flex-1 text-[13px] leading-[1.4] text-home-ink-2">{editing ? 'Tap an ingredient to change it.' : ''}</p>
      <button
        type="button"
        onClick={() => (editing ? api.guard('done', () => {}) : api.enter())}
        className={`inline-flex h-11 flex-shrink-0 items-center rounded-full px-5 text-[13px] font-semibold ${
          editing ? 'bg-home-ink text-home-ground' : 'border border-home-ink text-home-ink'
        }`}
      >
        {editing ? 'Done' : 'Edit'}
      </button>
    </div>
  )
}

function EditedTag({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative ml-2 align-baseline text-[13px] font-normal text-home-ink-2 underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
    >
      Edited
    </button>
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
        confirm: steps > 0 || rowId.startsWith('ing_user_'),
        onRemove: () => api.remove(rowId),
      }}
      writeError={api.session.writeError}
      onDone={api.commitOpen}
      doneLabel="Save"
    />
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
        <div key={group.key} className="mb-6 last:mb-0">
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
              return (
                <IngredientRow
                  key={item.key}
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
