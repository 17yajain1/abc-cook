import { CopyHero } from './CopyHero'
import { WORDMARK } from './copy'

/** Home tab: wordmark header, then (top to bottom) the Copy-a-recipe hero. Later H1
 * commits add the Continue strip above it and the tiles and feed below. */
export function HomeScreen({ onOpenCopy }: { onOpenCopy: () => void }) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto px-5 pb-28 pt-16">
      <h1 className="mb-1 text-[24px] font-bold leading-none tracking-[-0.4px] text-home-ink">{WORDMARK}</h1>
      <CopyHero onOpen={onOpenCopy} />
    </div>
  )
}
