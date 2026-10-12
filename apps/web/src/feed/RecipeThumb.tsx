import { InstagramIcon, LinkIcon, TextLinesIcon, YoutubeIcon } from '@/home/icons'

import type { FeedItem, FeedPlatform } from './types'

/**
 * Every feed thumbnail: ground `home-thumb`, a 1px inner border, and the platform badge
 * bottom-left. `card` is the 4:3 centre crop (`object-cover`) with the 24px badge inset 8px;
 * `row` is the 72×72 list exception with a 14px badge inset 4px. With no image the dish
 * name sits on peach in the title face — never an icon (docs/DESIGN_SYSTEM.md).
 */
export function RecipeThumb({ item, variant }: { item: FeedItem; variant: 'card' | 'row' }) {
  const row = variant === 'row'
  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-home-thumb ${row ? 'h-[72px] w-[72px] rounded-[12px]' : 'aspect-[4/3] w-full'}`}
    >
      {item.thumbnail ? (
        <img src={item.thumbnail.src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-home-peach p-2 text-center">
          <span
            className={`font-bold text-home-terracotta-text ${row ? 'line-clamp-4 text-[12px] leading-[13px]' : 'line-clamp-4 text-[18px] leading-[19.8px] tracking-[-0.2px]'}`}
          >
            {item.title}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 border border-[rgba(234,223,211,0.6)]" />
      <span
        className={`absolute flex items-center justify-center bg-[rgba(255,255,255,0.94)] text-home-ink ${
          row ? 'bottom-1 left-1 h-3.5 w-3.5 rounded-[4px] text-[10px]' : 'bottom-2 left-2 h-6 w-6 rounded-[7px] text-[14px]'
        }`}
      >
        <PlatformGlyph platform={item.platform} />
      </span>
    </div>
  )
}

function PlatformGlyph({ platform }: { platform: FeedPlatform }) {
  if (platform === 'youtube') return <YoutubeIcon />
  if (platform === 'instagram') return <InstagramIcon />
  if (platform === 'text') return <TextLinesIcon />
  return <LinkIcon />
}
