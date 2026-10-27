import { useState } from 'react'

import { thumbnailUrlFor } from '@/library/sourceKey'

/** YouTube answers a missing thumbnail with a 120 px grey placeholder rather than a 404. */
const YT_PLACEHOLDER_WIDTH = 120

/**
 * The recipe's picture at the top of the page (D4): 16:9, card radius. YouTube only, derived from the
 * source key (`thumbnailUrlFor`), never stored. With no key, a key that isn't YouTube's, a failed image
 * or the grey placeholder it renders nothing at all, so the title sits where it always did, with no gap.
 * `onLoaded` marks the import timer when a real picture has painted. Not a link and no play glyph: real thumbnails carry none, and it would imply tap-to-play.
 */
export function RecipeThumbnail({ sourceKey, onLoaded }: { sourceKey: string | null; onLoaded?: () => void }) {
  const url = sourceKey ? thumbnailUrlFor(sourceKey, 'large') : null
  const [hidden, setHidden] = useState(false)
  if (!url || hidden) return null
  return (
    <div className="mb-3.5 aspect-video w-full overflow-hidden rounded-home-card border border-home-rule bg-home-thumb">
      <img
        key={url}
        src={url}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setHidden(true)}
        onLoad={(e) => {
          if (e.currentTarget.naturalWidth === YT_PLACEHOLDER_WIDTH) setHidden(true)
          else onLoaded?.()
        }}
      />
    </div>
  )
}
