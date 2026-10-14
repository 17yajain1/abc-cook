# Follow-up plan: saved recipes keep a stale `summary`

**Status:** proposal, written 2026-10-15 during PR-B3. **Not implemented.** Needs an owner decision before any code.

## 1. Problem

A recipe saved on a device stores the whole `RecipePlanResponse` (graph, plan, stages, **summary**) under the `localStorage` key `abc-cook:library:v1` (`apps/web/src/library/store.ts`). Reopening reads `recipe.payload` straight back (`App.tsx` ~l.84-95 for the Plan tab, ~l.173-183 for Cooking mode). Nothing recomputes it and nothing records which post-processing produced it.

So any change to `schedule/` or `summarize()` (bumping `POSTPROCESS_VERSION`) fixes only new imports. A pizza saved before PR-B3 keeps showing "Come back ~19 hr later" indefinitely, which is the exact wrong advice PR-B3 fixes. The same applies to every future scheduler fix.

Re-importing the same URL does fix an entry: `library.save` dedups by source key and replaces the payload in place (keeps `id` and `saved_at`). But the PR-B3 bump forces a cache miss, so that costs a full import (about 2 min and an LLM call) for a fix that needs no LLM.

## 2. Proposal

Two parts, no LLM anywhere:

1. **Stamp the version.** Add `postprocess_version: int | None` to the saved payload (or to `SavedRecipe`). Written on every `save`; `None` for entries saved before the stamp existed, which counts as stale. Schema change, so Pydantic first and `make types` after.
2. **Re-summarise endpoint.** `POST /recipes/resummarize` takes the stored `graph`, reruns `schedule()` and `summarize()` (both pure and deterministic), and returns a fresh `RecipePlanResponse` stamped with the current version. The web app calls it on open when the stamp is missing or older than the server's current version, then replaces the stored payload in place.

Why the endpoint rather than recomputing in the browser: the frontend must never derive scheduling figures (CLAUDE.md), and the scheduler is Python.

Failure behaviour: if the call fails (offline, kitchen wifi), show the stored payload unchanged. The app must never fail to show a recipe.

Alternatives considered: recompute on open client-side (rejected: breaks the renderer-only rule); a forced re-import (rejected: LLM cost and latency for no new information).

## 3. Open items to trace before implementing

None of these were traced during PR-B3.

- **Feed items.** `feed/saveFromFeed.ts` calls `library.save(payload, null)` with a payload fetched from the server. Check whether it carries a version stamp, and whether the stamp and refresh logic must also cover entries with `import_meta: null`.
- **Server-stored public payloads.** Check how public recipes are stored (whole `RecipePlanResponse` or the graph only) and whether they hold a stale `summary` too. If they do, the Home feed shows old advice to everyone, and the server needs its own re-summarise sweep keyed on the version.
- **Cooking session store.** A replaced payload changes node timings and phase boundaries under a live session. Check how the session store (`cooking/`, `planKey`, `startIfNone`) behaves: whether it keys on the plan, whether a replaced plan orphans or corrupts a session in progress, and whether to refuse refresh while a session is active for that recipe.
- **Interaction with re-import.** A re-import replaces the entry via source-key dedup; confirm the stamp is overwritten and that an in-progress session is handled the same way as above.
- **Version source.** Decide how the client learns the server's current `POSTPROCESS_VERSION` (a field on the health or config endpoint, or a header on every response).

## 4. Out of scope

Rewriting saved graphs (the graph itself is not stale, only what is derived from it), and any change to extraction.
