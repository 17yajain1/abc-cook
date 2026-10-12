/**
 * Build/runtime flags for the Home shell. Both read the environment once at call time and
 * take the URL search string as an argument so they are testable without a `window`.
 */

/** The dev fixture picker (the server's sample recipes). Requires a dev build *and*
 * `?dev=1`, so a production build never exposes it. */
export function devToolsEnabled(search: string = window.location.search): boolean {
  return import.meta.env.DEV && new URLSearchParams(search).get('dev') === '1'
}

/** The public-recipes feed on Home. OFF by default: on only with
 * `VITE_FEATURE_FEED=1`, or `?feed=1` in a dev build. */
export function feedEnabled(search: string = window.location.search): boolean {
  if (import.meta.env.VITE_FEATURE_FEED === '1') return true
  return import.meta.env.DEV && new URLSearchParams(search).get('feed') === '1'
}
