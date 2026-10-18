# Owner decision: incomplete methods (FGC-3)

Recorded verbatim from the owner. Implemented by `docs/plans/fix-fgc-345-quality.md` (PR 2).

---
Decision: (b) fill the gaps, labelled. When a source's method is incomplete (example: vanilla cupcakes: ingredients + "bake at 180 °C for 20–25 min" but no batter step), ABC Cook adds the standard missing steps and marks each one "Added by ABC Cook, not in the video" (or "…not in the recipe" for blogs/text).
Why: more useful than refusing; still honest about provenance ("approximate timing is fine; wrong advice is not").
Constraints:
- Added steps are always visibly labelled, never silent.
- Added steps never override or contradict a stated step, time or temperature from the source.
- Notes/alternatives ("butter can be replaced with oil") are not steps (FGC-4): handle together or before.
- Times on added steps are estimates (provenance inferred), never shown as stated.
- vanilla-cupcakes known-wrong fixture is the first test case.
---
