import { useLayoutEffect, useRef, useState } from 'react'

import { END_OF_PAGE_COPY as COPY, removeConfirmLine, type EndOfPageBlock } from './endOfPage'

/** What Remove needs from the page: whether a cook ends with it, and the removal itself. */
export interface RemoveControl {
  cookInProgress: boolean
  /** Returns the failure message, or null when the recipe is gone (the page is then replaced). */
  onRemove: () => string | null
}

/**
 * R5: the end of the Plan tab. "Where this came from" (a platform line, and the paste when
 * there is one) and "Remove from Cookbook" with an inline confirm: no modal, no browser
 * dialog. View only: `endOfPage.ts` decides what is shown, `App` does the removal.
 */
export function EndOfPageSection({ block, remove }: { block: EndOfPageBlock | null; remove: RemoveControl | null }) {
  if (!block && !remove) return null
  return (
    <section className="mt-8 border-t border-home-rule pb-2 pt-5">
      {block && (
        <>
          <h2 className="text-[15px] font-semibold text-home-ink">{COPY.heading}</h2>
          <p className="mt-1 text-[13px] text-home-ink-2">{block.platformLine}</p>
          {block.paste != null && <AsWritten text={block.paste} />}
        </>
      )}
      {remove && <RemoveRow remove={remove} />}
    </section>
  )
}

/** The paste, expanded in place under a toggle. Capped at 11rem with "Show all" when it is longer. */
function AsWritten({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const bodyRef = useRef<HTMLPreElement>(null)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (open && el && !all) setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [open, all, text])

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 items-center text-[13px] font-medium text-home-ink-2 underline underline-offset-2"
      >
        {open ? COPY.hideWritten : COPY.showWritten}
      </button>
      {open && (
        <div className="rounded-home-mini bg-home-surface px-4 py-3">
          <pre
            ref={bodyRef}
            className={`whitespace-pre-wrap break-words font-[inherit] text-[15px] leading-[1.45] text-home-ink ${
              all ? '' : 'max-h-[11rem] overflow-hidden'
            }`}
          >
            {text}
          </pre>
          {!all && overflows && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="mt-1 flex h-11 items-center text-[13px] font-medium text-home-ink-2 underline underline-offset-2"
            >
              {COPY.showAll}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RemoveRow({ remove }: { remove: RemoveControl }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-2 flex h-11 items-center text-[15px] font-medium text-home-ink underline underline-offset-2"
      >
        {COPY.remove}
      </button>
    )
  }
  return (
    <div className="mt-2" role="group" aria-live="polite">
      <p className="text-[15px] leading-[1.4] text-home-ink">{removeConfirmLine(remove.cookInProgress)}</p>
      {error && <p className="mt-2 text-[13px] text-home-terracotta-text">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button
          type="button"
          onClick={() => setError(remove.onRemove())}
          className="h-11 rounded-full bg-home-destructive px-6 text-[15px] font-bold text-home-ground"
        >
          {COPY.confirmRemove}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          className="h-11 rounded-full border border-home-ink px-6 text-[15px] font-bold text-home-ink"
        >
          {COPY.keep}
        </button>
      </div>
    </div>
  )
}
