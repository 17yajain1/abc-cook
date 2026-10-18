export type ImportMark =
  | 'submit'
  | 'thumbnail'
  | 'title'
  | 'acquired'
  | 'ingredients'
  | 'firstStep'
  | 'plan'
  | 'ready'
  | 'open'

/**
 * Wall-clock marks for one import, relative to the submit tap, so the preview speed is
 * measured on a real phone rather than assumed. Each mark records the first time it is
 * set; `report()` is what the single `[import-timing]` console line prints. The clock is
 * injectable so this tests without a browser.
 */
export function createImportTimer(now: () => number = () => performance.now()) {
  const marks: Partial<Record<ImportMark, number>> = {}

  return {
    mark(name: ImportMark): void {
      if (marks[name] !== undefined) return
      marks[name] = now()
      try {
        performance.mark(`import:${name}`)
      } catch {
        // No Performance API (or a test environment without it): the numbers still report.
      }
    },
    /** Milliseconds from `submit` for every mark set so far. */
    report(): Partial<Record<ImportMark, number>> {
      const start = marks.submit
      const out: Partial<Record<ImportMark, number>> = {}
      if (start === undefined) return out
      for (const [name, at] of Object.entries(marks) as [ImportMark, number][]) {
        out[name] = Math.round(at - start)
      }
      return out
    },
  }
}
