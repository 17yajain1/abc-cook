import { useEffect, useId, useLayoutEffect, useRef } from 'react'

import { textHasTimePhrase } from '@/lib/stepNote'
import type { StepFieldState } from '@/library/stepEditor'

import { ErrorLine, LinkButton } from './editorParts'

export interface StepEditorBodyProps {
  field: StepFieldState
  onChange: (text: string) => void
  /** A1: shown when the page is at a size other than as written. */
  factorLine: string | null
  /** The step as imported, when an edit changed it. */
  importedText: string | null
  /** The length the plan uses for this step (`stepTimeNote`); shown under the text when it names a time. */
  timeNote: string | null
  onRestore: (() => void) | null
  writeError: string | null
  onSave: () => void
  /** Counts blocked exits and failed writes; a change scrolls this editor into view (A32). */
  blocked: number
  /** Set when this step was opened from outside its own row: centre it, then say so. */
  centre: boolean
  onCentred: () => void
}

/**
 * R6b: the in-place step editor (Q5 (a)). A real textarea at 16 px, so iOS does not zoom on focus, that
 * grows with its text. What the cook types is shown exactly as typed; whitespace is tidied once, at Save.
 * The time note is live under the field (Q4 (b)): the timer does not move when the text does.
 */
export function StepEditorBody(p: StepEditorBodyProps) {
  const { field: f } = p
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [f.text])

  // Opens in view. From the row's own pencil it only has to be on screen; from the Edited tag or
  // "Edit the step" the cook arrives from elsewhere, so it is brought to the middle (B4).
  useEffect(() => {
    rootRef.current?.scrollIntoView({ block: p.centre ? 'center' : 'nearest' })
    if (p.centre) p.onCentred()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on open only
  }, [])

  const seen = useRef(p.blocked)
  useEffect(() => {
    if (p.blocked === seen.current) return
    seen.current = p.blocked
    const target = rootRef.current?.querySelector('[role="alert"]') ?? rootRef.current
    target?.scrollIntoView({ block: 'center' })
  }, [p.blocked])

  return (
    <div ref={rootRef} data-testid="step-editor" className="mt-2 block rounded-home-mini bg-home-ground p-3">
      <div className="space-y-3">
        {p.factorLine && <p className="text-[13px] leading-[1.4] text-home-ink-2">{p.factorLine}</p>}
        <div>
          <textarea
            ref={areaRef}
            id={`${id}-text`}
            aria-label="Step text"
            value={f.text}
            autoComplete="off"
            rows={2}
            aria-invalid={f.errors.text ? true : undefined}
            aria-describedby={f.errors.text ? `${id}-err` : undefined}
            onChange={(e) => p.onChange(e.target.value)}
            className={`block w-full resize-none rounded-home-mini border bg-home-surface px-3 py-2 text-[16px] leading-[1.45] text-home-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-home-ink ${
              f.errors.text ? 'border-[1.5px] border-home-destructive' : 'border-home-rule'
            }`}
          />
          {f.errors.text && <ErrorLine id={`${id}-err`}>{f.errors.text}</ErrorLine>}
        </div>
        {p.timeNote && textHasTimePhrase(f.text) && <p className="text-[13px] leading-[1.4] text-home-ink-2">{p.timeNote}</p>}
        {p.importedText != null && (
          <div>
            <div className="line-clamp-3 text-[13px] leading-[1.4] text-home-ink-2 [overflow-wrap:anywhere]">Imported: {p.importedText}</div>
            {p.onRestore && <LinkButton small onClick={p.onRestore}>Restore original</LinkButton>}
          </div>
        )}
        {p.writeError && <ErrorLine>{p.writeError}</ErrorLine>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={p.onSave}
            className="h-11 rounded-full bg-home-terracotta px-6 text-[15px] font-bold text-home-ground"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
