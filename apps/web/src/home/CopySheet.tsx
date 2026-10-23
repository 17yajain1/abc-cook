import { useState } from 'react'

import type { Phase } from '@/import/useImportJob'

import { displayUrl, platformOfUrl } from './clipboard'
import { SHEET } from './copy'
import { CloseIcon, InstagramIcon, LinkIcon, YoutubeIcon } from './icons'

/** The bottom sheet behind the hero's CTA: a clipboard shortcut (when one was found), the
 * Paste text route, and a URL field. Import itself runs in the shell's `useImportJob`; the
 * sheet only collects input and shows the inline `error` phase (`slow` takes over the whole screen). */
export function CopySheet({
  url,
  onUrlChange,
  clipboardUrl,
  phase,
  onSubmit,
  onPasteTap,
  onPasteText,
  onClose,
}: {
  url: string
  onUrlChange: (url: string) => void
  clipboardUrl: string | null
  phase: Phase
  /** Called from a click handler only — never a mount effect (StrictMode would double-fire). */
  onSubmit: (url: string) => void
  onPasteTap: () => Promise<string | null>
  onPasteText: () => void
  onClose: () => void
}) {
  const [pasting, setPasting] = useState(false)
  const empty = !url.trim()

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end">
      <button
        type="button"
        aria-label={SHEET.close}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(35,16,10,0.42)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={SHEET.title}
        className="relative rounded-t-[24px] bg-home-surface px-5 pb-8 pt-3"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-home-rule" />
        <div className="mt-5 flex items-start justify-between">
          <div>
            <h2 className="text-[22px] font-bold leading-[26px] tracking-[-0.3px]">{SHEET.title}</h2>
            <p className="mt-1 text-[15px] text-home-ink-2">{SHEET.sub}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={SHEET.close}
            className="-mr-2 -mt-1 flex h-11 w-11 items-center justify-center text-[22px] text-home-ink"
          >
            <CloseIcon />
          </button>
        </div>

        {clipboardUrl && (
          <div className="mt-5 flex items-center gap-3 rounded-home-card border border-home-peach-rule bg-home-peach p-3">
            <PlatformGlyph url={clipboardUrl} className="shrink-0 text-[24px] text-home-terracotta" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold leading-[18px]">{SHEET.clipboardFound}</p>
              <p className="truncate text-[13px] text-home-ink-2">{displayUrl(clipboardUrl)}</p>
            </div>
            <button
              type="button"
              onClick={() => onSubmit(clipboardUrl)}
              className="h-11 shrink-0 rounded-full bg-home-terracotta px-4 text-[15px] font-semibold text-home-ground"
            >
              {SHEET.copyIt}
            </button>
          </div>
        )}

        <div className="mt-5 flex h-[54px] items-center gap-3 rounded-[14px] border border-home-rule bg-home-ground px-4">
          <LinkIcon className="shrink-0 text-[20px] text-home-ink-2" />
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !empty) onSubmit(url)
            }}
            placeholder={SHEET.urlPlaceholder}
            aria-label={SHEET.urlPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-home-ink outline-none placeholder:text-home-ink-2"
          />
          <button
            type="button"
            disabled={pasting}
            onClick={() => {
              setPasting(true)
              void onPasteTap()
                .then((text) => {
                  if (text) onUrlChange(text)
                })
                .finally(() => setPasting(false))
            }}
            className="h-11 shrink-0 text-[15px] font-semibold text-home-terracotta-text"
          >
            {SHEET.paste}
          </button>
        </div>
        <p className="mt-2 text-[13px] text-home-ink-2">{SHEET.hint}</p>

        {phase.kind === 'error' && <p className="mt-3 text-[13px] text-home-nonveg">{phase.message}</p>}

        <button
          type="button"
          disabled={empty}
          onClick={() => onSubmit(url)}
          className="mt-4 h-14 w-full rounded-full bg-home-terracotta text-[15px] font-semibold text-home-ground disabled:bg-[#f1e7de] disabled:text-[#8c7a6f]"
        >
          {SHEET.copyIt}
        </button>

        <div className="my-3 flex items-center gap-3 text-[13px] text-home-ink-2">
          <div className="h-px flex-1 bg-home-rule" />
          {SHEET.or}
          <div className="h-px flex-1 bg-home-rule" />
        </div>
        <button
          type="button"
          onClick={onPasteText}
          className="mx-auto block h-11 text-[13px] text-home-ink-2 underline underline-offset-4"
        >
          {SHEET.pasteText}
        </button>
      </div>
    </div>
  )
}

function PlatformGlyph({ url, className }: { url: string; className: string }) {
  const platform = platformOfUrl(url)
  if (platform === 'instagram') return <InstagramIcon className={className} />
  if (platform === 'youtube') return <YoutubeIcon className={className} />
  return <LinkIcon className={className} />
}
