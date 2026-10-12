import { heroPhoto } from '@/assets/home'

import { HERO } from './copy'
import { InstagramIcon, LinkIcon, TextLinesIcon, YoutubeIcon } from './icons'

/** The Copy-a-recipe hero: the screen's one terracotta ground, with the fixed hero photo
 * in a circle at the right. */
export function CopyHero({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative min-h-[220px] overflow-hidden rounded-home-tile bg-home-terracotta text-home-ground">
      <img
        src={heroPhoto}
        alt=""
        className="absolute -right-[93px] top-0 h-[236px] w-[236px] rounded-full object-cover"
      />
      <div className="relative flex min-h-[220px] flex-col px-5 pb-4 pt-5">
        <h2 className="text-[30px] font-bold leading-8 tracking-[-0.5px]">{HERO.title}</h2>
        <p className="mt-2 max-w-[170px] text-[15px] leading-[18px]">{HERO.sub}</p>
        <div className="mt-2.5 flex items-center gap-2 text-[13px] text-home-ground/70">
          <span>{HERO.worksWith}</span>
          <LinkIcon className="text-[16px]" />
          <InstagramIcon className="text-[16px]" />
          <YoutubeIcon className="text-[16px]" />
          <TextLinesIcon className="text-[16px]" />
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="mt-auto h-11 self-start rounded-full bg-home-ground px-6 text-[15px] font-semibold text-home-terracotta-text"
        >
          {HERO.cta}
        </button>
      </div>
    </section>
  )
}
