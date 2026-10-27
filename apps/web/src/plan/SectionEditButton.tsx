/**
 * CP5.1 U1: the quiet "Edit" on a section heading (What you need, Steps). It does what the header's Edit
 * pill does, then the page scrolls to this section, so the cook who is reading a step lands editing that
 * step's list rather than at the top. Shown only where the pill is (a saved recipe, not already editing).
 * The visible text is small; the `after:` inset makes the tap target 44 px.
 */
export function SectionEditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex-shrink-0 text-[14px] font-semibold leading-5 text-home-ink-2 after:absolute after:-inset-x-3 after:-inset-y-3 after:content-['']"
    >
      Edit
    </button>
  )
}
