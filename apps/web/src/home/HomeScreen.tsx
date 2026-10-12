import type { SavedRecipe } from '@abc-cook/schema'

import { CookbookTile } from './CookbookTile'
import { CopyHero } from './CopyHero'
import { WORDMARK } from './copy'
import { PlannerTile } from './PlannerTile'

/** Home tab: wordmark header, then (top to bottom) the Copy-a-recipe hero and the
 * Cookbook / Planner tiles. Later H1 commits add the Continue strip above the hero and
 * the feed below the tiles. */
export function HomeScreen({
  recipes,
  onOpenCopy,
  onOpenCookbook,
  onOpenPlanner,
}: {
  recipes: SavedRecipe[]
  onOpenCopy: () => void
  onOpenCookbook: () => void
  onOpenPlanner: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-28 pt-16">
      <h1 className="mb-1 text-[24px] font-bold leading-none tracking-[-0.4px] text-home-ink">{WORDMARK}</h1>
      <CopyHero onOpen={onOpenCopy} />
      <div className="grid grid-cols-2 gap-3">
        <CookbookTile recipes={recipes} onOpen={onOpenCookbook} onPasteFirst={onOpenCopy} />
        <PlannerTile onOpen={onOpenPlanner} />
      </div>
    </div>
  )
}
