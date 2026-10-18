# Decisions — 2026-10-15: servings scaling + user editing

Source: owner review of two competitor screen recordings (ReciMe servings + edit; Copymenu edit), checked against repo, ROADMAP and handoffs. Owner approved all three decisions below.

## Status before this review
- Servings: R4 listed "servings" with no design; ROADMAP Later #2. Open question "frontend scaling OK?" since 13 Oct → now answered.
- Editing: not planned anywhere (R3–R5, ROADMAP, PRODUCT.md).

## Competitor failures to avoid (seen in recordings)
- ReciMe scaling multiplies only the first number: "2 - 5 garlic cloves" → "4 - 5" → "6 - 5". Parenthetical "(2 tsp minced garlic)" never scales. "0.5 / 1.5 stock cube", "1 packs", "1 green onions". Step text never scales.
- ReciMe edit = free-text lines (Heading/Normal toggle, drag reorder, photo per step). Fine for them; structure lost.
- Copymenu edit = structured rows (qty keypad, unit chips, name, ×, Add ingredient; step text + duration chip, Add a step, Notes). Step text edits don't update which ingredients it uses; durations unchecked.

## Code finding (verify in planning)
- `apps/api/abc_cook/extract/graph.py` `_parse_qty` only parses "2", "2.5", "1/2". Ranges ("2-3"), mixed numbers ("1 1/2"), "½" become `qty: null`, and the graph keeps no raw text. Check how the Ingredients tab renders these today.

## Decision 1 — Servings scaling in the frontend: APPROVED (R3/R4)
- Quantity arithmetic, not a cooking figure; the "frontend never computes cooking figures" rule still holds.
- One pure function `scaleQuantity(ingredient, factor)` used everywhere a quantity renders: Ingredients tab, "You'll need" (`quantityLine`), R3 step chips.
- Rules: ranges scale both ends; cooking fractions (½ ¼ ¾ ⅓), never 0.33; count units (egg, cube, packet, medium onion) round to nearest ½; grams round to 5; "to taste" / null qty unchanged.
- Worked example, kadai paneer 3 → 2 servings: Onion 2 medium → 1⅓ → 1½ medium; Paneer 250 g → 166.7 → 165 g; Oil 3 tbsp → 2 tbsp; Salt to taste unchanged.
- Numbers inside step text are not rewritten. When servings ≠ original and a step's text contains a number: "Amounts in this step's text are for N servings."
- Times never change. When factor ≥ 2: "Times are for N servings. A bigger batch can take longer."
- Backend prerequisite: preserve ranges and mixed numbers (e.g. qty_low/qty_high or raw qty text alongside).
- Chosen servings persist per saved recipe.

## Decision 2 — Editing: Tier A as R6, before M5: APPROVED
- Tier A (no timing change, frontend only):
  - Edit ingredient qty / unit / name with structured rows; Indian units: tsp, tbsp, cup, g, ml, pinch, piece, inch, clove, to taste.
  - Add ingredient, with optional "Which step uses it?" so it gets a chip. Remove ingredient (warn if steps use it).
  - Edit a step's text.
  - Every edited item shows "Edited" + "Restore original" (imported value kept).
- Tier B (after M5): step duration, add/delete step, hands-on vs hands-free. Needs new `POST /plan {graph}` endpoint: validate invariants + Python scheduler, no LLM. No drag-to-reorder; "Add step after X" is the safe default.
- Why before M5: extraction will sometimes be wrong; a tester who can't fix "4 tbsp" → "1 tbsp" stops trusting the plan, which is what M5 measures.

## Decision 3 — Edits stored as a patch: APPROVED (fix 4)
- User edits are stored as a patch over the original imported graph, so a POSTPROCESS_VERSION bump / reprocessing replays them instead of overwriting them.
- Add to fix 4 (saved-recipe staleness) plan prompt: "Design storage so user edits survive a POSTPROCESS bump (edits as a patch over the original import), even though editing ships later in R6."

## Updated order
Fix 1 (Meanwhile prereqs) → fix 2 (offset not duration) → fix 3 (window unclaimed dependency) → fix 4 (staleness, + edits-as-patch) → R3 (chips + qty preservation + scaleQuantity) → R4 (servings UI) → R5 → R6 (Tier A editing) → M5.

Still pending owner decision: "widen the golden corpus" step (3–5 new real recipes). Claude's lean: yes, after fixes 1–2, before R3.

Note 2026-10-19: the 'code finding' predates Ingredient.qty_text; see r3-quantities.md Step 1.
