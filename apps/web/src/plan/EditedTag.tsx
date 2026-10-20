/**
 * The quiet "Edited" word after an edited ingredient (R6a) or step (R6b). It is a button: tapping it
 * enters edit mode with that row or step open (A4). The ::after widens the tap area without growing the line.
 */
export function EditedTag({ onClick }: { onClick: () => void }) {
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
