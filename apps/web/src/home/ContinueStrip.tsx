import { thumbnailUrlFor } from '@/library/sourceKey'

import type { ContinueInfo } from './continueCooking'
import { CONTINUE } from './copy'

/** Above the hero while a session is active: the highest-priority action on Home, so it
 * outranks starting a new copy. Resume is terracotta. The step line and progress fill
 * appear only when `info.step` exists (the payload is on this device). */
export function ContinueStrip({ info, onResume }: { info: ContinueInfo; onResume: () => void }) {
  const thumbnail = info.sourceKey ? thumbnailUrlFor(info.sourceKey) : null
  return (
    <section className="flex items-center gap-3 rounded-home-card border border-home-rule bg-home-surface p-2.5">
      <div className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-home-thumb px-1 text-center text-[11px] font-bold leading-[12px] text-home-terracotta-text">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <span className="line-clamp-3">{info.title}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold leading-[19px]">{info.title}</p>
        {info.step && (
          <>
            <p className="text-[13px] leading-[17px] text-home-ink-2">
              {CONTINUE.stepLine(info.step.n, info.step.total)}
            </p>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-home-rule">
              <div
                className="h-full rounded-full bg-home-terracotta"
                style={{ width: `${((info.step.n - 1) / info.step.total) * 100}%` }}
              />
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onResume}
        aria-label={CONTINUE.resumeLabel(info.title)}
        className="h-11 shrink-0 rounded-full bg-home-terracotta px-5 text-[15px] font-semibold text-home-ground"
      >
        {CONTINUE.resume}
      </button>
    </section>
  )
}
