import type { SavedRecipe } from '@abc-cook/schema'

import { ContinueStrip } from './ContinueStrip'
import type { ContinueInfo } from './continueCooking'
import { CookbookTile } from './CookbookTile'
import { CopyHero } from './CopyHero'
import { WORDMARK } from './copy'
import { PlannerTile } from './PlannerTile'

/** Home tab: wordmark header, then (top to bottom) the Copy-a-recipe hero and the
 * Cookbook / Planner tiles, with the Continue strip above the hero when a session is
 * active. A later H1 commit adds the feed below the tiles. */
export function HomeScreen({
  recipes,
  continueInfo,
  onResume,
  onOpenCopy,
  onOpenCookbook,
  onOpenPlanner,
}: {
  recipes: SavedRecipe[]
  /** Non-null only while a session is active (see `selectContinue`). */
  continueInfo: ContinueInfo | null
  onResume: (planKey: string) => void
  onOpenCopy: () => void
  onOpenCookbook: () => void
  onOpenPlanner: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-28 pt-16">
      <h1 className="mb-1 text-[24px] font-bold leading-none tracking-[-0.4px] text-home-ink">{WORDMARK}</h1>
      {continueInfo && <ContinueStrip info={continueInfo} onResume={() => onResume(continueInfo.planKey)} />}
      <CopyHero onOpen={onOpenCopy} />
      <div className="grid grid-cols-2 gap-3">
        <CookbookTile recipes={recipes} onOpen={onOpenCookbook} onPasteFirst={onOpenCopy} />
        <PlannerTile onOpen={onOpenPlanner} />
      </div>
    </div>
  )
}
