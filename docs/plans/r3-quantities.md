# R3 — quantities that keep their shape, one scaleQuantity, chips

## Owner amendments

Approved 2026-10-19. These win over everything below.

- **Q1–Q11:** all as recommended.
- **A1. Package sizes.** `parse_amount` returns `None` when a measure unit (in the `qty_text` rest
  or in `unit`) is followed by a container word: can, tin, jar, packet, pack, bottle, box, sachet,
  carton (plural-folded, case-folded). "15 oz can" → `None`. The ×⅔ / ×2 cells for that line in
  the worked table read "unchanged". Test rows: "15 oz can", "1 can (400 g)", "2 packets", and "2"
  with unit "packet" (a count, so it stays scalable: whole packets are a count, not a package size).
- **A2. Unit vocabulary.** Add ounce/ounces, pound/pounds/lbs, gram/grams, kilogram/kilograms,
  millilitre/milliliter, litre/litres/liter/liters, tablespoons/teaspoons. HARD STOP A includes a
  table of every distinct unit in the corpus (the unit field, or the first word of rest) → its
  class, with a count for each.
- **A3. Factor tests.** `scaleQuantity` tests also cover factors 1/2, 4/3, 3/2, 5/3 and 3, computed
  as chosen/original servings in floating point (e.g. `4 / 3`, not 1.3333), including a case where
  float error sits next to a rounding boundary.
- **A4.** FGC-43 also records package sizes (A1) as unscalable.

---

## Context

R4 (servings control) needs a quantity that can be multiplied without lying. Today
`Ingredient.qty` is one float (ranges collapse to the low end, "1 cup" → null) and the screens
render `qty_text` verbatim, so there is nothing safe to scale. R3 adds a **structured amount
parsed on the backend**, one pure web function `scaleQuantity(ingredient, factor)`, and routes
every quantity render through it at factor 1, **byte-identical to today**. No visible UI change,
no servings UI (R4), ₹0. Read from `origin/main` @ `5af7ca7` (PPV 13).

## Step 0 — old worktrees (read-only audit)

| | `ABC cook-f2` | `ABC cook-t1b` |
|---|---|---|
| Branch / HEAD | `feat/f2-ingredient-chips` @ `d788dac` | `feat/t1b-quantified-chips` @ `b836ccf` |
| Last 5 | d788dac F2 chips · 4f1a00a V2.1 hierarchy · 9e2f31b PR #36 · fa328b0 · 54c6c4b | b836ccf T1b spacing · fb22369 T1b chip box · 660fc0f F2 chips · 7d3cef3 PR #37 · 6138054 |
| `status -s` | clean | 3 untracked: `apps/web/render-t1b.html`, `src/__render_t1b__/main.tsx`, `vite.render.config.ts` |
| On main? | d788dac **not** on main; never pushed; no PR. `git range-diff` shows d788dac **= 660fc0f** (same patch, rebased) — merged via PR #38 | Yes: ancestor of origin/main; PR #38 MERGED 2026-10-10 |
| Diff vs main | 7 files, +385/−12 (all the F2 chip work already on main) | none (merged) |
| What it was | first F2 chip implementation, pre-rebase | F2 chips + T1b chip styling, shipped |
| Reuse / conflict | nothing to reuse; no conflict | the untracked **render-only harness** (vite config + `render-t1b.html` boots `CookingShell` on a fixture at 390 px) is the pattern for any R3 screenshot; nothing conflicts |
| Recommend | **safe to remove** (branch is local-only and superseded) | **safe to remove** (copy the 3 harness files to `notes/` first if wanted) |

Owner decides; nothing is removed by R3.

## Step 1 — what exists today

### 1.1 Where a quantity is rendered

| Screen | File:line | Formatter |
|---|---|---|
| Recipe page, Ingredients tab | `apps/web/src/plan/ingredientGroups.ts:31` | `joinQtyUnit(qty_text ?? formatQty(qty), unit)` (`lib/quantity.ts:21,54`) |
| Cooking mode F2 chips | `cooking-mode/quantity.ts:49` via `viewModel.ts:423` → `CookingShell.tsx:89-91` | `[qty_text ?? String(qty), unit, name].join(' ')`; special case `qty==null && unit==='to taste'` (`:47`). **No** `joinQtyUnit` |
| `quantityLine` (chips joined " · ") | `cooking-mode/quantity.ts:37` | same as chips; `view.qty` is always `null` now (`viewModel.ts:364,401`), `CookingShell.tsx:120` is dead |
| Streamed draft (S2) | `import/draftView.ts:30` | `joinQtyUnit(NormalizedIngredient.qty, unit)` — model text before `graph.py`; not an `Ingredient` |
| Plan "You'll need" | `plan/StageCard.tsx:156-170` | **names only**, no quantity |

Two pre-existing divergences, both preserved by the factor-1 invariant: chips print a
legacy float with `String` ("1.5 cup water", `maggi-2min`) where the tab prints `formatQty`
("1 1/2 cup"), and chips repeat a glued unit ("1 cup cup chole") where the tab dedups.

### 1.2 Flow
Model `NormalizedIngredient.qty: str | None` (`schema/normalized.py:80-96`) →
`graph.py:1776-1786` builds `Ingredient(qty=_parse_qty(norm.qty), qty_text=norm.qty, unit=norm.unit)`
→ `Ingredient` (`schema/ingredient.py`: `qty: float|None`, `qty_text: str|None`, `unit`) →
`RecipePlanResponse` → web. `_parse_qty` (`graph.py:251-292`) already parses mixed "1 1/4",
"1-1/4", vulgar "½"/"1½", ranges → **low end**; anything else (incl. "1 cup", "8-10 pieces",
"1&1/2") → `None`. **The Appendix A "code finding" is stale**: mixed, ½ and ranges parse, and
`qty_text` keeps the raw text; what is still lost is the range's high end and any number with
text after it.

### 1.3 Census (15 fixtures, 201 ingredients; 59 are hand goldens with only a float `qty`)

| Form | n | Example (fixture) | `qty` today | `qty_text` | Screen (tab / chip) |
|---|---|---|---|---|---|
| integer | ~70 | "2" medium (kadhi), "12" (sabudana) | 2.0 | "2" | "2 nos" / "2 nos dry red chilly" |
| integer + unit glued | 33 | "1 cup", unit "cup" (chole ×23, FGC-25); "1 tbsp", unit null (sabudana ×10) | **None** | "1 cup" | "1 cup" / **"1 cup cup chole"** |
| decimal | 2 (goldens only) | 1.5 l, 1.5 cup | 1.5 | — | "1 1/2 cup" / "1.5 cup water" |
| a/b | 31 | "3/4" tsp | 0.75 | "3/4" | "3/4 tsp" |
| mixed "a b/c" | 5 | "2 1/2" cups (pumpkin) | 2.5 | verbatim | "2 1/2 cups" |
| mixed "a&b/c" | 2 | "1&1/2", "1& 1/2" (cupcakes) | None | verbatim | verbatim |
| unicode ½ / "1 ½" | 9 | "1 ½" cups (kadhi) | 1.5 | verbatim | "1 ½ cups" |
| range | 4 | "3-4", "8-10 pieces", "4-5" cups, "1 1/2 to 2 cups" | 3.0 / None / 4.0 / None | verbatim | verbatim |
| approximate | **0** | — | | | |
| vague | 4 | "to taste" ×3, "taste hisab se" | None | verbatim | "to taste" / **"to taste salt"** (special case only fires on `unit==='to taste'`) |
| Hindi/Hinglish number words | **0** | (FGC-6: आधा/डेढ़ seen only in transcript; the model wrote digits) | | | |
| parenthetical only | 3 | "(washing aur soaking ke lie)" (chole) | None | verbatim | verbatim |
| second amount in qty_text | 3 | "5 tbsp (50g) for dough and 15 tbsp (150g)…", "1 tbsp + 1 tsp", "¼ cup or 45" | None | verbatim | verbatim |
| second amount in **unit** | 11 | unit "Cup (200g)", "cups (190 g)" (cupcakes); "gms / ½ cup", "ml / ¾ cup" (dal) | number | verbatim | "1 Cup (200g)" |
| qty null | 10 | pumpkin toppings, sabudana water | None | null | "" / name only |

The exact table is regenerated by script at HARD STOP A.

### 1.4 "R3 ingredient chips" now
No R3 text exists in `docs/ROADMAP.md` (only "Later #2: Servings scaling and unit conversion").
Quotes: Appendix A — "`scaleQuantity` used everywhere a quantity renders: Ingredients tab, 'You'll
need' (`quantityLine`), R3 step chips"; `pr-s1-preview-honest-errors.md:190` / `pr-s2-streamed-draft.md:305`
— "R3 (chips) and R4 (servings) restyle one component (`IngredientList`) that both screens render";
`decisions-2026-10-16-ingredients-first.md` — "built so R3 (chips) and R4 (servings) reuse it".
**Step chips shipped** (F2 + T1b, PR #38). Screens without quantity chips: Plan stage cards
("You'll need" is names only) and the Ingredients tab (a list, not chips). **Nothing chip-wise
is required for R3**; R3's chip work is routing the existing chips through `scaleQuantity`.
(Owner Q5 for stage-card amounts.)

### 1.5 Is `Ingredient` text model-facing?
No. Extraction `output_type=NormalizedRecipe` (`normalize.py:337`), repair `RepairProposal`
(`repair.py:239,253`); the repair user turn lists `ing.name` only (`repair.py:125`). `Ingredient`
reaches only `ImportResult`, whose schema hash is `result_schema_sha256` in the cache fingerprint
(`cache.py:342`) — that identity changes (expected, alongside PPV 14). `NormalizedIngredient` is
**not touched**, so the request stays byte-identical; proven by dumps (below).

## Step 2 — design

### A. Structured quantity — **backend (recommended, matches Appendix A)**
Evidence for backend: `_parse_qty` and its vulgar table/tests already live there; the parser
needs `unit` too (11 lines carry a second amount in `unit`); `reprocess` refills saved recipes
for ₹0; R6 edits and Tier-B `POST /plan` want a typed amount server-side; TS gets the type from
`make types`. No evidence for the web.

- New `schema/ingredient.py` model + field (default `None`, so old JSON validates):
  ```python
  class QtyAmount(BaseModel):
      low: float            # > 0
      high: float | None    # None = exact; else a range with high > low
      prefix: str = ""      # approximate word kept verbatim, e.g. "about "
      rest: str = ""        # text after the number(s), verbatim: " cup", "g", " pieces"
  Ingredient.qty_amount: QtyAmount | None = None   # None = not scalable (any reason)
  ```
- New pure module `abc_cook/extract/quantity.py`: `parse_amount(qty_text, unit) -> QtyAmount | None`,
  reusing `_QTY_VULGAR_FRACTIONS` (moved there; `graph.py` imports it). `graph.py:1779` adds
  `qty_amount=parse_amount(norm_ing.qty, norm_ing.unit)`. `qty` and `qty_text` unchanged.
- `POSTPROCESS_VERSION` 13 → 14, append history hash; add `quantity.py` to `_EXTRACT_MODULES`
  in `tests/test_postprocess_version.py`.
- Hand-authored `*.graph.json` goldens are loaded, not built → `qty_amount` stays `None` there.

### B. Parse rules (`parse_amount`)
Grammar: `[prefix] N [sep N] rest`, N = int | decimal | a/b | int␠a/b | int-a/b | int&a/b | [int][␠]vulgar.
Return `None` unless every check passes. Never guess.

| Input (qty_text, unit) | Result |
|---|---|
| "2", medium | low 2 |
| "1.5" | low 1.5 |
| "3/4" | low 0.75 |
| "1 1/2", "1 ½", "1½" | low 1.5 |
| **"1-1/2"** | **low 1.5 (mixed)** — matches today's `_parse_qty`; a range would need low > high. Flagged Q1 |
| "1&1/2", "1& 1/2" | low 1.5 (new; cupcakes evidence) |
| "2-3", "2–3", "2 to 3" | low 2, high 3 |
| "2-3 medium" | low 2, high 3, rest " medium" |
| "1 1/2 to 2 cups" | low 1.5, high 2, rest " cups" |
| "8-10 pieces" | low 8, high 10, rest " pieces" |
| "250g" | low 250, rest "g" |
| "1 cup", unit "cup" | low 1, rest " cup" (FGC-25 shape; display keeps `joinQtyUnit`) |
| "about 2", "~2", "approx. 2", "लगभग 2" | low 2, prefix kept verbatim (corpus has 0; Q7) |
| "to taste", "a pinch", "a handful", "taste hisab se" | None |
| "(washing aur soaking ke lie)" | None (no leading number) |
| "(2 tsp minced)" after a number, "1 tbsp + 1 tsp", "¼ cup or 45", "5 tbsp (50g)…" | None — any digit/vulgar char in `rest` (Q2) |
| any qty with a digit in `unit` ("Cup (200g)", "gms / ½ cup") | None (Q2) |
| "2 or 3" | None ("or" is alternatives in the corpus) |
| range with high ≤ low; value 0; "1,5"; English words ("two", "half") | None |
| Hindi/Hinglish words (आधा, डेढ़, ढाई, सवा, paav) | None — **out of R3, left to FGC-6** (0 corpus occurrences; Q4) |
| "15", unit "oz can"; "15 oz can"; "1 can (400 g)" | None — measure unit followed by a container word (A1); the last also has a digit in rest |
| "2 packets"; "2", unit "packet" | low 2 (count; no measure unit before the container word) |
| null / "" | None |

Expected over the 140 text-bearing corpus lines: ≈109 scalable, ≈31 not.

### C. `scaleQuantity(ingredient, factor)` — `apps/web/src/lib/scaleQuantity.ts`, pure
Returns `{ text: string | null, scaled: boolean }`, the **amount text only** (unit and name are
still joined by each caller, so composition is untouched).

- `factor === 1` → `{ text: ingredient.qty_text ?? null, scaled: false }` — exactly today's input.
- `qty_amount` missing/null → same as above (not scalable; pre-v14 or unparseable).
- Otherwise `text = prefix + fmt(low·f) [+ "–" + fmt(high·f)] + rest`, `scaled: true`.
  Range ends round independently; if they meet, show one value.
- **Unit class** from a closed unit vocabulary (no ingredient names): the `unit` field, or the
  first word of `rest` when `unit` is empty. Never converts units; never pluralises.

| Class | Vocabulary (case-folded, plural-folded) | Rounding | Display |
|---|---|---|---|
| metric small | g, gm, gms, gram, grams; ml, millilitre, milliliter | ≥ 10 → nearest 5; < 10 → nearest 1; min 1 (Q3) | integer |
| metric large | kg, kilogram(s), l, litre(s), liter(s) | nearest 0.05; min 0.05 | trimmed decimal "1.25" |
| spoon/cup/imperial | tsp, teaspoon(s), tbsp, tablespoon(s), cup, katori, glass, oz, ounce(s), lb, lbs, pound(s), pint, quart | whole + nearest of {0, ¼, ⅓, ½, ⅔, ¾, 1}; **⅛ only when the value < ¼**; min ⅛ (Q9) | "1½", "⅔" glyphs (Q8) |
| count (everything else, incl. null unit) | medium, large, whole, nos, piece, clove, egg, cube, packet, sachet, inch, pinch, handful… | nearest ½; min ½ | "1½" |

- "to taste" / null `qty_text` → unchanged, `scaled: false`. Small results never reach 0 (mins above).

Worked example (test cases, kadai 3 → 2, f = ⅔): Onion "2" medium → 1.333 → **"1½"**; Paneer "250" g →
166.7 → **"165"**; Oil "3" tbsp → **"2"**; Salt null / to taste → unchanged, `scaled: false`.

Ten+ corpus lines (rendered `joinQtyUnit(text, unit)`):

| Line | ×1 | ×⅔ | ×2 |
|---|---|---|---|
| "1 ½" cups curd | 1 ½ cups | 1 cups | 3 cups |
| "3/4" tsp turmeric | 3/4 tsp | ½ tsp | 1½ tsp |
| "10" cups water | 10 cups | 6⅔ cups | 20 cups |
| "2" nos dry red chilly | 2 nos | 1½ nos | 4 nos |
| "2 1/2" cups flour | 2 1/2 cups | 1⅔ cups | 5 cups |
| "1/3" cup warm water | 1/3 cup | ¼ cup | ⅔ cup |
| "1 cup" / cup chole | 1 cup | ⅔ cup | 2 cup |
| "8-10 pieces" amla | 8-10 pieces | 5½–6½ pieces | 16–20 pieces |
| "1 1/2 to 2 cups" / cups | 1 1/2 to 2 cups | 1–1⅓ cups | 3–4 cups |
| "4-5" cups water | 4-5 cups | 2⅔–3⅓ cups | 8–10 cups |
| "1 inch" ginger | 1 inch | ½ inch | 2 inch |
| "15" oz can pumpkin | 15 oz can | unchanged (A1) | unchanged (A1) |
| "1" Cup (200g) sugar | 1 Cup (200g) | unchanged | unchanged |
| "to taste" salt | to taste | to taste | to taste |

("1 cups", "2 cup": words are never rewritten — Q11.)

### D. Factor-1 invariant
- `ingredientGroups.ts:31` → `joinQtyUnit(scaleQuantity(item, factor).text ?? formatQty(item.qty), item.unit)`;
  `quantity.ts:49` → `scaleQuantity(ingredient, factor).text ?? (qty != null ? String(qty) : null)`.
  `panelIngredientGroups`, `quantityPhrases`, `quantityLine` gain `factor = 1` (unused by any caller
  in R3; lets tests prove the path, and R4 passes the real factor).
- The legacy-float fallbacks stay at each site (they only fire on hand goldens with no `qty_text`).
- `draftView.ts` is **not** routed: it renders `NormalizedIngredient` before `graph.py`, and the
  draft never scales (S2 rule). Documented in its docstring.
- Proof: `quantityLine.golden.json` byte-unchanged and its test green; existing render tests
  unchanged; a new test keeps a frozen copy of the two old formatters and asserts equality for
  every ingredient in every web fixture plus synthetic edge cases ("", null, "1 cup"/cup, to
  taste, "a handful", "1 ½", float-only 1.5).

### E. Saved recipes from before v14
No `qty_amount` → `scaleQuantity` returns the plain `qty_text`, `scaled: false`; no fallback maths.
`reprocess()` → `postprocess` → `build_graph` fills `qty_amount` (test: reprocess each corpus
original and assert a non-null `qty_amount` on a known-scalable line). The web staleness refresh
(`library/openSaved.ts`) already calls `/recipes/reprocess` when the stamp < server PPV.

### F. Chips / UI
No visible change in R3 (identity at factor 1; `view.qty` dead). **No screenshot STOP is
needed unless** the owner adds stage-card amounts (Q5) or the chip unit fix (Q6); then a
390×844 render (t1b harness pattern, `darkreader-lock`) is a HARD STOP before the rest.

### G. Out of scope (R4)
Servings control, persisting chosen servings, step-text and bigger-batch notes, stated yield (FGC-8).
R4 needs: `CookingGraph.servings` (exists), `servings_stated` (exists; the graph's form of
`NormalizedRecipe.servings_source`), `yield_text` (exists), `Ingredient.qty_amount` (R3), and a new
per-saved-recipe chosen-servings field on `SavedRecipe` (`schema/library.py`, does not exist).

### H. One PR (recommended)
The web tolerates a missing `qty_amount`, so deploy order does not matter and the two-PR
pattern buys nothing; the web half is small and has no visible change.

## Files to change
- `apps/api/abc_cook/schema/ingredient.py` — `QtyAmount`, `Ingredient.qty_amount`
- `apps/api/abc_cook/extract/quantity.py` (new) — `parse_amount`; vulgar table moved here
- `apps/api/abc_cook/extract/graph.py` — import table; set `qty_amount` at :1779
- `apps/api/abc_cook/extract/cache.py` — `POSTPROCESS_VERSION = 14` + history note
- `apps/api/tests/fixtures/postprocess_versions.json` — append `"14"`
- `apps/api/tests/test_postprocess_version.py` — add `quantity.py`
- `apps/api/tests/test_quantity.py` (new) — parser table + corpus property test
- `packages/schema/…` — regenerated by `make types`
- `apps/web/src/__fixtures__/*.plan-response.json`, `postprocess-version.json` — `export_web_fixtures.py`
- `apps/web/src/lib/scaleQuantity.ts` (+ `.test.ts`) (new)
- `apps/web/src/plan/ingredientGroups.ts`, `apps/web/src/cooking-mode/quantity.ts` — routing
- `apps/web/src/cooking-mode/quantity.test.ts` / `plan/ingredientGroups.test.ts` — identity tests
- docs (after A): `docs/COOKING_GRAPH.md` §2 (field), `docs/plans/followup-golden-corpus.md`

## Tests (generic; recipe names only in test data)
- Python `test_quantity.py`: one parametrised row per Step 2B row; corpus property test over every
  fixture ingredient (never raises; `high > low`; `None` whenever `rest`/`unit` has a digit;
  `qty_text is None` ⇒ `None`). Existing `test_parse_qty` untouched.
- Python: `build_graph` sets `qty_amount`; `reprocess` fills it.
- TS `scaleQuantity.test.ts`: factor 1 identity; worked example; each unit class; ⅛ rule; mins;
  ranges (both ends, collapse); prefix/rest verbatim; unscalable → unchanged; missing field.
  Factors 1/2, 4/3, 3/2, 5/3, 3 built as `chosen / original` floats, incl. one case where float
  error sits next to a rounding boundary (A3).
  Expect ½ and Devanagari in sources (Write/Edit only).
- TS identity tests (D).

## Golden plan
- `PYTHONPATH=<abs>/apps/api python apps/api/scripts/regen_corpus_expected.py` — snapshots hold no
  ingredients, so the **expected diff is empty**. Any change → STOP.
- `apps/api/tests/test_schedule.py` goldens: unchanged. Any change → STOP.
- `export_web_fixtures.py`: diff must be only `+ "qty_amount": …` lines on built fixtures and
  `13 → 14` in `postprocess-version.json`; restore CRLF-only rewrites with `git checkout`.
  Anything else → STOP.

## Commit sequence (worktree `abc-cook-r3`, branch `feat/r3-quantities`)
0. `docs(plans): R3 quantities plan; servings decision` — **STOP**.
1. `test:` parser + scaleQuantity + identity tests (red).
2. `feat(extract):` `QtyAmount`, `parse_amount`, `graph.py`, PPV 14, history, hash list; regen corpus
   (expect no diff); export web fixtures.
3. `chore(schema):` `make types`.
4. `feat(web):` `scaleQuantity`, routing with `factor = 1`.
5. **HARD STOP A** — report: corpus parse table (every line → result); the corpus unit → class
   table with counts (A2); the golden diffs; request
   dumps byte-identical; factor-1 proof (golden JSON unchanged + identity test output); full test
   output; screenshots only if Q5/Q6 added UI.
6. After approval: `docs:` COOKING_GRAPH §2, FGC entries.
7. **HARD STOP B** — `git reset --soft origin/main`, one commit, `HEAD^{tree}` unchanged
   (compare before/after); show `git log`, diff stat, test output. No push until approved.

### Request-dump proof
At commit 0 (code = origin/main), into `notes/r3/request-dumps/base/`: `--label after-off` and
`--label after-on` (4 stream × strict each), plus an untracked wrapper calling
`capture(stream, strict, added=None)` for the unset case (4 files). Repeat at commit 4 into `head/`.
`cmp` every pair: 12/12 identical required.

### Commands
- Python: `PYTHONPATH=<abs>/apps/api`, `OPENAI_API_KEY=invalid LLM_API_KEY=invalid`,
  `pytest -m "not llm and not network"`; `ruff check`; `mypy --strict abc_cook/schema abc_cook/schedule`.
- Types: `npm ci` in `packages/schema`, then `make types PY=python`.
- Web: `npm ci` in `apps/web`, `npx vitest run`, `npx tsc --noEmit`.
- Never `ruff format .`; stop only own PIDs (9222 is the owner's).

## Setup steps (after approval, outside plan mode, then STOP)
1. `git fetch origin`; `git worktree add -b feat/r3-quantities C:\Users\ashya\Music\abc-cook-r3 origin/main`.
2. Write this plan to `docs\plans\r3-quantities.md` (owner amendments at the top).
3. Write Appendix A verbatim to `docs\plans\decisions-2026-10-15-servings-edit.md`, plus a final line:
   "Note 2026-10-19: the 'code finding' predates Ingredient.qty_text; see r3-quantities.md Step 1."
4. Add FGC-42..45 to `followup-golden-corpus.md`:
   - FGC-42 (P3, web): chips repeat a glued unit ("1 cup cup") and print "to taste salt" — `joinQtyUnit` and the to-taste case are not applied to chips.
   - FGC-43 (R4 input): 11 corpus lines carry a second amount in `unit` ("Cup (200g)", "gms / ½ cup"); R3 marks them unscalable, as it does package sizes ("15 oz can", A1).
   - FGC-44 (P3, fixtures): chips print a legacy float with `String` ("1.5 cup") where the tab prints "1 1/2 cup" (hand goldens only).
   - FGC-45 (FGC-6 addendum): Hindi number words as quantities (आधा, डेढ़, सवा, ढाई) are unscalable until FGC-6.
5. Mojibake grep (`Ã`, `â€`, `Â`, U+FFFD) on every touched file.
6. One commit `docs(plans): R3 quantities plan; servings decision`. STOP: no code, no push.
   Report `git worktree list` and the first 10 lines of the plan.

## Risks
- **Silent wrong amount** from a mis-parse → mitigated by the "digit anywhere else ⇒ None" rule and
  the corpus property test; unscalable lines simply show the source text.
- Another branch bumping PPV to 14 first → rebase and re-append (history is append-only).
- Cache identity changes twice (PPV + `result_schema_sha256`) → one invalidation, expected.
- Moving the vulgar table changes `graph.py`'s AST → covered by the PPV bump anyway.
- Mixed glyph styles at factor ≠ 1 ("1½" next to an unscalable "1/2") — R4 concern.

## Owner questions (recommendation first)
1. "1-1/2" = 1½ (mixed), not a range. **Recommend yes** (today's behaviour; a range would run backwards).
2. Second amounts (parenthetical with a number, "+", "or", a digit in `unit`): **recommend the whole line is unscalable, shown as written**; alternative is to scale both numbers (wrong for package sizes like "15 oz can" in `unit`).
3. g/ml below 10: **recommend nearest 1 g** (3 g salt ×⅔ = 2 g; strict nearest-5 gives 0 g, or 5 g with a floor — 2.5× too much); at 10 g and above, nearest 5 as approved.
4. Hindi number words: **recommend out of R3** (0 corpus lines; FGC-6 owns them).
5. Chips: **recommend nothing new in R3**; amounts on Plan stage cards would be a separate, rendered change.
6. FGC-25 on chips ("1 cup cup", "to taste salt"): **recommend keep strict factor-1 identity in R3** and fix as FGC-42 in its own small PR (golden JSON would not change, but real chole-like screens would).
7. Approximate prefixes ("about 2"): **recommend scalable, prefix kept verbatim**.
8. Display at factor ≠ 1: **recommend unicode glyphs "1½"** (Appendix A's example).
9. ⅛: **recommend only for values below ¼**; ⅔ allowed.
10. Worktrees: **recommend remove both** (`ABC cook-f2` superseded by PR #38; `ABC cook-t1b` merged — keep its render harness in `notes/` if wanted).
11. Words next to scaled numbers ("1 cups", "2 cup"): **recommend leave as written** (never rewrite source words).

## Verification
HARD STOP A evidence: pytest (all, `-m "not llm and not network"`), vitest, tsc, ruff, mypy green;
corpus parse table; `git diff --stat` of goldens (replay snapshots: none; schedule goldens: none;
web fixtures: `qty_amount` + PPV only); 12/12 request dumps `cmp`-identical; `quantityLine.golden.json`
unchanged plus the identity test.
