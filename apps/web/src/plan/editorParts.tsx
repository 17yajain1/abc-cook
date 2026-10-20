import type { ReactNode } from 'react'

/** Small pieces both editors share (the ingredient editor and the step editor). */

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-[13px] text-home-ink-2">
      {children}
    </label>
  )
}

export function ErrorLine({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1 text-[13px] text-home-terracotta-text">
      {children}
    </p>
  )
}

export function LinkButton({ onClick, children, small }: { onClick: () => void; children: ReactNode; small?: boolean }) {
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

export function PencilIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </svg>
  )
}
