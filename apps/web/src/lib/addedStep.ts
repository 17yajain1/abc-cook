import { platformOfUrl } from '@/home/clipboard'

/**
 * The line under a step ABC Cook added because the source skips it (FGC-3). "Not in the
 * video" for a YouTube or Instagram link, "not in the recipe" for anything else (a blog, pasted
 * text, a photo): the cook is told what the step is not part of, in the words they know the
 * source by. Copy only; whether a step is added comes from `NodeProvenance.origin`.
 */
export function addedStepLabel(source: { kind: string; value: string } | null | undefined): string {
  const video =
    source?.kind === 'url' &&
    (platformOfUrl(source.value) === 'youtube' || platformOfUrl(source.value) === 'instagram')
  return `Added by ABC Cook, not in the ${video ? 'video' : 'recipe'}`
}
