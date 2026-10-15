import type { ImportOriginal, ImportResult } from '@abc-cook/schema'

/** What a finished import carries for the saved copy: the post-processing inputs and the
 * `POSTPROCESS_VERSION` that produced the plan. Both are null when the server sent
 * neither (an older API), which the staleness check treats as "stale". */
export interface ImportExtras {
  original: ImportOriginal | null
  postprocess_version: number | null
}

/** Pure sibling of `importMetaFrom`: lifts the two fields off a done `ImportResult`. */
export function importExtrasFrom(result: Pick<ImportResult, 'original' | 'postprocess_version'>): ImportExtras {
  return {
    original: result.original ?? null,
    postprocess_version: result.postprocess_version ?? null,
  }
}
