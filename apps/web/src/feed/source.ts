import type { FeedSource } from './types'

/**
 * The one place the app chooses a feed source. H1 returns the mock, through a dynamic
 * `import()` so its fixtures stay out of the default bundle; H2 replaces the body with the
 * API-backed source.
 */
export function loadFeedSource(): Promise<FeedSource> {
  return import('./mock').then((m) => m.createMockFeedSource())
}
