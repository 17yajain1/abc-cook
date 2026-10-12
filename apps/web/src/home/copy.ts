/** All Home microcopy in one place, so a wording change is one file. Sentence case
 * throughout (docs/DESIGN_SYSTEM.md bans Title Case on Home). */

export const WORDMARK = 'ABC Cook'

export const HERO = {
  title: 'Copy a recipe',
  // No "photo": image import doesn't exist yet (ROADMAP § Later).
  sub: 'Paste a reel, link or recipe text… Get a step-by-step cooking plan.',
  worksWith: 'Works with',
  cta: 'Paste a link',
  /** The two lines of the Now / Meanwhile card. Names only, deliberately without a
   * duration: a duration on Home would be a cooking figure not read from a plan. */
  now: 'Now',
  nowStep: 'Temper jeera',
  meanwhile: 'Meanwhile',
  meanwhileStep: 'Chop tomatoes',
} as const

export const SHEET = {
  title: 'Copy a recipe',
  sub: 'We’ll read it and build your cooking plan.',
  clipboardFound: 'Found a link in your clipboard',
  pasteText: 'Paste text',
  or: 'or',
  urlPlaceholder: 'Paste any URL',
  paste: 'Paste',
  hint: 'YouTube, Instagram reels and most recipe blogs',
  copyIt: 'Copy it',
  close: 'Close',
  slow: 'This is taking longer than expected.',
  keepWaiting: 'Keep waiting',
} as const
