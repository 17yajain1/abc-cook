import { heroPhoto } from '@/assets/home'

import { HERO } from './copy'

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
        <p className="mt-2 max-w-[185px] text-[15px] leading-[18px]">{HERO.sub}</p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-6 h-11 self-start rounded-full bg-home-ground px-6 text-[15px] font-semibold text-home-terracotta-text"
        >
          {HERO.cta}
        </button>
      </div>
    </section>
  )
}
