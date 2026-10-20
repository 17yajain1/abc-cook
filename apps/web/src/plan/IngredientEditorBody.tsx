import { useId, useState, type ReactNode } from 'react'

import { NO_UNIT_CHIP, pressFraction, unitChoices, unitSelected, type FieldState } from '@/library/ingredientEditor'

type Patch = Partial<Pick<FieldState, 'name' | 'mode' | 'amount' | 'rangeOpen' | 'range' | 'unit'>>

const FIELD =
  'h-11 rounded-home-mini border bg-home-surface px-3 text-[16px] text-home-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-home-ink'
const FRACTIONS = ['½', '¼', '¾', '⅓'] as const

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[13px] text-home-ink-2">
      {children}
    </label>
  )
}

function ErrorLine({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-[13px] text-home-terracotta-text">
      {children}
    </p>
  )
}

function Pill({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'inline-flex h-11 items-center justify-center rounded-full px-4 text-[13px] font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-home-ink',
        on ? 'bg-home-ink text-home-ground' : 'border border-home-rule bg-home-surface text-home-ink',
      )}
    >
      {children}
    </button>
  )
}

function LinkButton({ onClick, children, small }: { onClick: () => void; children: ReactNode; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-11 items-center font-medium text-home-ink underline underline-offset-2',
        small ? 'text-[13px]' : 'text-[15px]',
      )}
    >
      {children}
    </button>
  )
}

export interface IngredientEditorBodyProps {
  field: FieldState
  onChange: (patch: Patch) => void
  /** A1: shown when the page is at a size other than as written. */
  factorLine: string | null
  /** The imported name and amount line, for each part an edit changed. */
  imported: { name: string | null; line: string | null } | null
  onRestore: (() => void) | null
  /** Offered for imported and added rows alike; the Add form passes null. */
  /** `confirm` is false when nothing needs saying: a removed row can be restored (A26). */
  remove: { warning: string | null; confirm: boolean; onRemove: () => void } | null
  writeError: string | null
  onDone: () => void
  doneLabel: string
}

/**
 * R6a: the in-place ingredient editor (U2). One editor for an open row and for the Add form:
 * name, amount (a number, a range, or to taste, with the fraction buttons) and the unit picker.
 * It draws a `FieldState` and reports what the cook does; every rule lives in `ingredientEditor`.
 */
export function IngredientEditorBody(p: IngredientEditorBodyProps) {
  const { field: f } = p
  const id = useId()
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const choices = unitChoices(f.importedUnit)
  const unitsOff = f.mode === 'taste'

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${id}-name`}>Name</Label>
        <input
          id={`${id}-name`}
          type="text"
          value={f.name}
          maxLength={200}
          autoComplete="off"
          aria-invalid={f.errors.name ? true : undefined}
          aria-describedby={f.errors.name ? `${id}-name-err` : undefined}
          onChange={(e) => p.onChange({ name: e.target.value })}
          className={cx(FIELD, 'w-full', f.errors.name ? 'border-[1.5px] border-home-destructive' : 'border-home-rule')}
        />
        {f.errors.name && <ErrorLine id={`${id}-name-err`}>{f.errors.name}</ErrorLine>}
      </div>

      {p.factorLine && <p className="text-[13px] leading-[1.4] text-home-ink-2">{p.factorLine}</p>}

      <div>
        <div className="flex gap-2">
          <Pill on={f.mode === 'number'} onClick={() => p.onChange({ mode: 'number' })}>
            Amount
          </Pill>
          <Pill on={f.mode === 'taste'} onClick={() => p.onChange({ mode: 'taste' })}>
            To taste
          </Pill>
        </div>
        {f.mode === 'number' && (
          <div className="mt-3">
            <Label htmlFor={`${id}-amount`}>Amount</Label>
            <div className="flex items-center gap-2">
              <input
                id={`${id}-amount`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                value={f.amount}
                aria-invalid={f.errors.amount ? true : undefined}
                aria-describedby={f.errors.amount ? `${id}-amount-err` : undefined}
                onChange={(e) => p.onChange({ amount: e.target.value })}
                className={cx(FIELD, 'tabular w-[84px] flex-shrink-0', f.errors.amount ? 'border-[1.5px] border-home-destructive' : 'border-home-rule')}
              />
              {FRACTIONS.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-label={`Set the fraction to ${g}`}
                  onClick={() => p.onChange({ amount: pressFraction(f.amount, g) })}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-home-rule bg-home-surface text-[18px] text-home-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-home-ink"
                >
                  {g}
                </button>
              ))}
            </div>
            {f.errors.amount && <ErrorLine id={`${id}-amount-err`}>{f.errors.amount}</ErrorLine>}
            {f.rangeOpen ? (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] text-home-ink-2">to</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    aria-label="Top of the range"
                    value={f.range}
                    aria-invalid={f.errors.range ? true : undefined}
                    onChange={(e) => p.onChange({ range: e.target.value })}
                    className={cx(FIELD, 'tabular w-[84px] flex-shrink-0', f.errors.range ? 'border-[1.5px] border-home-destructive' : 'border-home-rule')}
                  />
                  <LinkButton small onClick={() => p.onChange({ rangeOpen: false, range: '' })}>
                    Remove range
                  </LinkButton>
                </div>
                {f.errors.range && <ErrorLine>{f.errors.range}</ErrorLine>}
              </div>
            ) : (
              <LinkButton small onClick={() => p.onChange({ rangeOpen: true })}>
                Add a range
              </LinkButton>
            )}
          </div>
        )}
      </div>

      <div className={cx(unitsOff && 'opacity-50')}>
        <Label>Unit</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Unit">
          {choices.chips.map((chip) => (
            <Pill
              key={chip}
              on={!unitsOff && unitSelected(f.unit, chip)}
              onClick={() => !unitsOff && p.onChange({ unit: chip === NO_UNIT_CHIP ? null : chip })}
            >
              {chip}
            </Pill>
          ))}
        </div>
      </div>

      {p.imported && (p.imported.name != null || p.imported.line != null) && (
        <div>
          {p.imported.name != null && <p className="text-[13px] text-home-ink-2">Imported: {p.imported.name}</p>}
          {p.imported.line != null && <p className="text-[13px] text-home-ink-2">Imported: {p.imported.line}</p>}
        </div>
      )}
      {p.onRestore && <LinkButton small onClick={p.onRestore}>Restore original</LinkButton>}

      {p.remove &&
        (confirmingRemove && p.remove.confirm ? (
          <div>
            {p.remove.warning && <p className="text-[15px] leading-[1.4] text-home-ink">{p.remove.warning}</p>}
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={p.remove.onRemove}
                className="h-11 rounded-full bg-home-destructive px-6 text-[15px] font-bold text-home-ground"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="h-11 rounded-full border border-home-ink px-6 text-[15px] font-bold text-home-ink"
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <LinkButton onClick={() => (p.remove?.confirm ? setConfirmingRemove(true) : p.remove?.onRemove())}>Remove ingredient</LinkButton>
        ))}

      {p.writeError && <ErrorLine>{p.writeError}</ErrorLine>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={p.onDone}
          className="h-11 rounded-full bg-home-terracotta px-6 text-[15px] font-bold text-home-ground"
        >
          {p.doneLabel}
        </button>
      </div>
    </div>
  )
}
