# Decisions 2026-10-19: R5 (end of the recipe page)

Owner decisions made while planning R5 (`docs/plans/r5-end-of-page.md`, owner amendments A3). R5 itself is web only: no schema change, no API change, `POSTPROCESS_VERSION` stays 14.

## Cook history
- Cook history is **minimal Option B, built after M5**. The open questions D1-D6 stay open; they are decided together with the manual "I cooked this" control below.
- `feat/cooking-history-foundation` is **stale: redo it, don't rebase it.**

## "Took ..." never ships
The "Took ..." line (the study frame's per-cook duration) never ships in any version (owner, Q2).

## Manual "I cooked this"
Decided **together with D1-D6**, not in R5.

## Public toggle
The per-recipe Visibility toggle is **omitted until H2**. There is no switch component in the design system, and a toggle with no feed behind it promises something the app cannot do. FGC-51 (a trustworthy creator field) is a prerequisite for listing anything publicly (`PRODUCT.md` § Public recipes requires attribution).

## Remove from Cookbook
- It is the first way to delete a saved recipe, so the wording elsewhere is now "never deleted **automatically**" (the staleness plans and `library/openSaved.ts`).
- Removing a recipe ends a cook in progress on it (a cook started before Save keeps its `import:<graph id>` key, so the match is `library:<entry id>` or `import:<graph id>`).
- Remove is available whenever the plan on screen has a saved entry, not by origin: it works right after an import that was auto-saved.

## Related follow-ups
FGC-16 (closed by R5: the "Plan simplified" line moved under the title), FGC-51 (creator, H2 prerequisite), FGC-52 ("what we read" for URL imports, after M5), FGC-53 (a degraded plan hides "Plan simplified" while the staleness line shows) in `docs/plans/followup-golden-corpus.md`.
