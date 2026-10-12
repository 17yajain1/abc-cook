import { heroPhoto } from '@/assets/home'

import { HERO } from './copy'
import { InstagramIcon, LinkIcon, TextLinesIcon, YoutubeIcon } from './icons'

/** The Copy-a-recipe hero: the screen's one terracotta ground, with the fixed hero photo
 * in a circle at the right and a Now / Meanwhile card (names only) over its corner. */
export function CopyHero({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative h-[220px] overflow-hidden rounded-home-tile bg-home-terracotta text-home-ground">
      <img
        src={heroPhoto}
        alt=""
        className="absolute -right-[93px] top-0 h-[236px] w-[236px] rounded-full object-cover"
      />
      <div className="relative flex h-full flex-col px-5 pb-4 pt-5">
        <h2 className="text-[30px] font-bold leading-8 tracking-[-0.5px]">{HERO.title}</h2>
        <p className="mt-2 max-w-[190px] text-[15px] leading-[18px]">{HERO.sub}</p>
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
      <div className="absolute bottom-3 right-3 w-[150px] rounded-home-mini bg-home-surface p-2.5 text-home-ink">
        <p className="mb-1 text-[12px] text-home-ink-2">{HERO.exampleLabel}</p>
        <p className="text-[12px] font-semibold">{HERO.now}</p>
        <p className="text-[14px] font-semibold leading-[17px]">{HERO.nowStep}</p>
        <div className="my-1.5 h-px bg-home-rule" />
        <p className="text-[12px] font-semibold text-home-sage-text">{HERO.meanwhile}</p>
        <p className="text-[14px] font-semibold leading-[17px]">{HERO.meanwhileStep}</p>
      </div>
    </section>
  )
}
