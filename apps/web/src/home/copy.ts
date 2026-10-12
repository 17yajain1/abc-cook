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

export const CONTINUE = {
  resume: 'Resume',
  resumeLabel: (title: string) => `Resume cooking ${title}`,
  stepLine: (n: number, total: number) => `Step ${n} of ${total}`,
} as const

export const TILES = {
  cookbookTitle: 'My cookbook',
  cookbookEmpty: 'Your first recipe lands here',
  cookbookEmptyCta: 'Paste your first link',
  plannerTitle: 'Meal planner',
  plannerSub: 'Plan meals, track nutrition',
  comingSoon: 'Coming soon',
} as const

export function recipeCount(n: number): string {
  return n === 1 ? '1 recipe' : `${n} recipes`
}

export const PLANNER = {
  screenTitle: 'Planner',
  heading: 'Meal planner is coming',
  body: 'Plan your week from your cookbook and see protein, carbs and fat for each day.',
  notify: 'Notify me',
  noted: 'Noted',
  notedTitle: 'Noted.',
  notedBody: 'The meal planner will show up right here when it’s ready.',
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
