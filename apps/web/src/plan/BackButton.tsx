import { ArrowLeftIcon } from '@/home/icons'

/**
 * The recipe page's back control (R1): a 44×44 tap target, top-left. `circled` draws the
 * white circle used in the full header; the compact bar uses the bare arrow. Focus ring
 * for keyboard only, like the stage headers.
 */
export function BackButton({ onClick, circled = false }: { onClick: () => void; circled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back"
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[22px] text-home-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-home-ink"
    >
      <span
        className={`flex h-10 w-10 items-center justify-center rounded-full ${
          circled ? 'border border-home-rule bg-home-surface' : ''
        }`}
      >
        <ArrowLeftIcon />
      </span>
    </button>
  )
}
