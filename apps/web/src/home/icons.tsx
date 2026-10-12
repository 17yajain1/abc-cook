/** Inline SVG glyphs for the Home register — no icon library. 24×24 viewBox, stroked in
 * `currentColor`, so the caller sets colour and size with text classes. */
import type { ReactNode, SVGProps } from 'react'

function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

type P = SVGProps<SVGSVGElement>

export const HomeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />
  </Icon>
)
export const BookIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 6c-1.6-1.2-3.8-1.7-7-1.7v13c3.2 0 5.4.5 7 1.7 1.6-1.2 3.8-1.7 7-1.7v-13c-3.2 0-5.4.5-7 1.7zM12 6v13" />
  </Icon>
)
export const CalendarIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
    <path d="M4 10h16M8.5 3.5v3.5M15.5 3.5v3.5" />
  </Icon>
)
export const LinkIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
)
export const InstagramIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="12" cy="12" r="3.6" />
    <circle cx="16.8" cy="7.2" r=".6" fill="currentColor" />
  </Icon>
)
export const YoutubeIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="6" width="18" height="12" rx="4" />
    <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" />
  </Icon>
)
export const TextLinesIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 8h14M5 12h14M5 16h9" />
  </Icon>
)
export const ClockIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)
export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
)
export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
)
export const ArrowLeftIcon = (p: P) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
)
export const GridViewIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="4.5" width="16" height="9" rx="2" />
    <path d="M4 18h16" />
  </Icon>
)
export const ListViewIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="5" width="4.5" height="4.5" rx="1" />
    <rect x="4" y="14.5" width="4.5" height="4.5" rx="1" />
    <path d="M12 7.25h8M12 16.75h8" />
  </Icon>
)
