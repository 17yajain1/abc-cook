import type { SavedRecipe } from '@abc-cook/schema'

import { thumbnailUrlFor } from '@/library/sourceKey'

import { recipeCount, TILES } from './copy'

/** Peach tile: the real saved count with up to three overlapping thumbnails, or the
 * empty state whose link opens the Copy sheet. The tile itself opens the Cookbook tab. */
export function CookbookTile({
  recipes,
  onOpen,
  onPasteFirst,
}: {
  recipes: SavedRecipe[]
  onOpen: () => void
  onPasteFirst: () => void
}) {
  const empty = recipes.length === 0
  return (
    <section className="relative h-[130px] rounded-home-tile border border-home-peach-rule bg-home-peach px-4 py-3.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label={TILES.cookbookTitle}
        className="absolute inset-0 rounded-home-tile"
      />
      <h2 className="relative text-[18px] font-bold leading-[22px]">{TILES.cookbookTitle}</h2>
      {empty ? (
        <>
          <p className="relative mt-1.5 text-[13px] leading-[17px] text-home-ink-2">{TILES.cookbookEmpty}</p>
          <button
            type="button"
            onClick={onPasteFirst}
            className="absolute bottom-1 left-4 z-10 h-11 text-left text-[13px] font-semibold text-home-terracotta-text"
          >
            {TILES.cookbookEmptyCta}
          </button>
        </>
      ) : (
        <>
          <div className="relative mt-2.5 flex h-10 items-center pl-0.5">
            {recipes.slice(0, 3).map((r, i) => (
              <StackedThumb key={r.id} recipe={r} first={i === 0} />
            ))}
          </div>
          <p className="relative mt-2 text-[13px] font-semibold">{recipeCount(recipes.length)}</p>
        </>
      )}
    </section>
  )
}

function StackedThumb({ recipe, first }: { recipe: SavedRecipe; first: boolean }) {
  const src = thumbnailUrlFor(recipe.source_key)
  return (
    <div
      className={`flex h-10 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[9px] bg-home-thumb px-1 text-center text-[10px] font-bold leading-[11px] text-home-terracotta-text ring-2 ring-home-peach ${first ? '' : '-ml-3'}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />
      ) : (
        <span className="line-clamp-3">{recipe.payload.graph.title}</span>
      )}
    </div>
  )
}
