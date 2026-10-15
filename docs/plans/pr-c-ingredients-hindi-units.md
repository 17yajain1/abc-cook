# PR-C plan: D3 duplicate ingredients + D5 Hindi duration units

## Context

PR-C is the third fix from the sabudana investigation (fix order: PR-A → PR-B → **PR-C** → PR-D).
PR-A and PR-B are merged; `origin/main` = `fc0753e`, `POSTPROCESS_VERSION = 5`.

**Status:** plan approved by the owner, not yet implemented. The dry runs ran on a `git archive`
of `origin/main` outside the repo; nothing in the repo was changed to produce them.

### Where the specs are

Both are in `docs/investigations/sabudana-schedule-2026-10-13.md` (on main):

- **D3** (§5, owner decision): "deterministic code fix (home group + no-orphan guard, id-based
  independence). No prompt convention." The mechanism is F2's proposed fix (§2 F2, items 1–3):
  - resolve each step's ingredient names to ids using a *home group*;
  - an ingredient id that would be consumed by no step keeps its current consumers;
  - `_verify_independence_explicit` compares resolved **ids**, not names.
- **D5** (§5): "accept the Hindi unit table". The table is in Q4 item 4: corpus-side `मिनट`,
  `घंटा/घंटे`, `सेकंड` and romanized `ghanta/ghante`, plus "reuse `_HINDI_NUMBER_WORDS` and
  Devanagari digits". (Number words are deferred; see below.)
- **Warning text** (F5): reword "no duration phrase was found in its own text" when the phrase
  *is* in the step but not in the source. The fix order bundles "D3 + D5 + warning text, one
  POSTPROCESS bump".

### How the specs differ from the brief

- **D5 is about duration units used for grounding, not ingredient units.** No Hindi ingredient
  unit is normalised or displayed anywhere. D5 changes which durations count as stated in the
  source; it has no visible output of its own.
- **D3 never merges ingredients or combines quantities.** Two entries that share a name are two
  real portions, for example Roasted peanuts 1/4 cup (main list) and 4 tbsp (chutney). D3 decides
  which portion each step uses.

## Root cause of D3, verified

1. **Extraction (backend).** In `build_graph`, `name_to_ids` is keyed by lowercase name only
   (`apps/api/abc_cook/extract/graph.py:1238-1282`). `_ingredient_ids` returns *every* id with
   that name, so a step naming "Roasted peanuts" consumes both portions (`graph.py:1412`).
2. **False edges (backend).** The independence checks intersect raw step names:
   - `_verify_independence_explicit`, `graph.py:932-948`;
   - legacy `_shares_ingredient`, `graph.py:898-904`.

   So Temper (main-list cumin) "shares" with Make chutney (chutney cumin), which adds the false
   edge Temper ← chutney.
3. **Display (frontend).** `stageIngredients` (`apps/web/src/plan/derive.ts:221`) collects every
   consumed id in a stage. `StageCard.ingredientNames` (`StageCard.tsx:157`) joins the **names
   only**.

   **Dry-run finding:** even after a correct backend fix, sabudana's Cook stage holds both the
   chutney step and the Add sabudana/Grind steps. Its "You'll need" line still prints Roasted
   peanuts, Cumin seeds, Green chilli and Sendha namak twice. So the live symptom needs a
   display fix as well (owner decision: deduplicate names).
4. **The live example is a frozen golden.** The picker serves
   `apps/api/tests/fixtures/sabudana-khichdi.graph.json` through `load_graph`. That file still has
   the pre-D3 `consumes` and the false edge Temper ← chutney. A graph.py change alone never
   reaches it.

## Dry-run results

Two prototypes of graph.py were run against a copy of main: full D3 + D5, and D3 + D5 without
Hindi number words.

| Target | Result |
|---|---|
| 8 API goldens (`*.graph.json` → `schedule` vs `*.plan.json`) | all unchanged |
| 11 web fixtures (10 `plan-response` + 1 `import-warnings`) | all byte-identical to main's export (differences from the committed files are CRLF only, from Windows `write_text`) |
| dal-makhni replay (Butter and Garlic chopped, each main + "Tempering") | edges unchanged; `consumes` the same set. The prototype reordered `consumes`; the real guard restores ids in place so the output is byte-identical |
| pizza-dough replay | unchanged |
| Legacy path also id-based | no change anywhere |
| sabudana replay (stored graph + real Hindi transcript `captions-auto-hi.raw.json`, which is this video) | Temper ← [Roast peanuts] only (cumin edge gone); 17 → 14 "shares an ingredient" warnings; `validate() == []` |
| sabudana `consumes` | Grind, Temper and Add sabudana → main-list ids. Chutney → chutney ids, plus main-list "Green chilli 1 tbsp", which the guard restores because no other step names it (Temper names "Green chillies") |
| D5: Soak "2 hours" vs corpus "2 घंटे" | not grounded → grounded at 120, stated (F5 confirmed offline, no network needed) |
| D5: "3 to 4 minutes" vs a synthetic "3 से 4 मिनट" | not grounded until `से` is added as a range connector (added below) |
| D5: Cook briefly against the **real** transcript | the transcript says "तीन से 4 मिनट" (number word), so it **stays ungrounded** in PR-C, with the new warning text. This waits on the number-word follow-up |
| D5: transcript offsets | "एक घंटे बाद" and "4 मिनट बाद" are offsets. The 3 soak mentions ("2 घंटे के लिए") are not offsets and still ground |
| D5 **with** Hindi number words | **wrong advice**: "एक घंटे" grounds "After one hour, mix…" and turns Stir once into a stated 60-min step. Dropped (owner decision) |
| `\b` after `घंटे` / `घंटा` / `घंटों` | fails, because these end in a combining vowel sign. `(?!\w)` works, and is identical to `\b` for English units |

## Design

### D3 backend (`graph.py`)

- **New resolver.** Add a pure module-level function
  `_resolve_step_ingredient_ids(step_names, name_to_ids, group_of) -> list[list[str]]`. The tests
  and the golden script use it too.
  - Candidates per name: the existing exact match, else the existing substring fallback.
  - Home group: the most common `group` among the step's names that match exactly one id.
    Ungrouped (`None`) counts as a group. A tie, or no such names, means home = ungrouped.
  - An ambiguous name resolves to the ids in the home group; else the ungrouped ids; else all ids.
  - **No-orphan guard:** an id that is a candidate for at least one required step, but that no
    step resolved to, is restored to every step that had it as a candidate, at its original
    position. A recipe with no cross-group duplicates therefore produces byte-identical output.
- **Where it runs.** A pre-pass after the roles pass, before `_explicit_dependencies`. The node
  loop uses the resolved ids. "Not found in the ingredient list" warnings are still emitted in the
  node loop, so warning order doesn't change. The `roles.attach` note-only path keeps all
  candidates.
- **Independence on both paths.** `_verify_independence_explicit` and
  `_shares_ingredient`/`_verify_independence` take the shared set as:
  - the names of the shared **resolved ids**, plus
  - names that resolve to no ingredient (component names), which are still compared by name as
    today.

  The staple and produced-label exemptions are unchanged.
- **Quantities.** `Ingredient` rows (`qty`, `qty_text`, `unit`, `group`) and their count are
  never touched. "Same ingredient" stays "same lowercase name", and group decides which portion.
  Quantities are never combined anywhere. They can't be combined safely: units differ (1/4 cup vs
  4 tbsp), amounts can be vague (`"to taste"`, `null`), and the portions serve different purposes.

### D3 display (frontend, display-only)

- New `apps/web/src/lib/displayNames.ts`: `uniqueDisplayNames(names)`.
  - Deduplicates on exact name after trim and case-fold only.
  - No plural or stem matching: "Green chilli" and "Green chillies" stay separate.
  - Keeps first-occurrence order.
- Used by `StageCard.ingredientNames`. `RenderStage.ingredients`, `stageIngredients`, the
  Ingredients tab, quantities and `consumes` are unchanged.

### D5 (`graph.py`, corpus grounding only)

- **Units:**
  - seconds: add `"सेकंड"`;
  - minutes: add `"मिनट"`;
  - hours: add `"घंटा"`, `"घंटे"`, `"ghanta"`, `"ghante"` (exactly the approved table).
- **Unit terminator:** `\b` → `(?!\w)` in `_DURATION_EXPR_RE`.
- **Range connector:** add `से` next to `-`, the dashes and `to`.
- **Devanagari digits:** already matched by `\d`, and `float("२") == 2.0`. Pinned by a test, with
  no code needed.
- **Offset guard (Hindi side):** a match whose unit is one of the Hindi units, and which is
  immediately followed (optional whitespace) by `बाद`/`baad` or `पहले`/`pehle` plus `(?!\w)`, is an
  offset and is not extracted.
  - Implement it in `_duration_expressions` with a lookahead or post-filter keyed on a
    `_HINDI_OFFSET_MARKERS` table.
  - It is generic: no fixture names, no English change.
  - Step text is English, so in practice the guard only acts on the corpus.
  - The English "after N" stays in the follow-up doc.
- **Not in PR-C:** Hindi number words. Write `docs/plans/followup-offset-not-duration.md`:
  - "after N" is a start offset, not a duration. This is latent for English "after one hour"
    today.
  - Flag it as potential wrong advice, to land before M5.
  - Hindi number words wait on that fix.
- Step text is English, so step-side parsing doesn't change. The dry run shows no English fixture
  changes.

### Warning text (`_verify_duration`, `graph.py:789-794`)

- If `_duration_expressions(text)` is non-empty but nothing grounded, the warning reads: '…claims
  a stated duration, but that duration was not found in the source text; treated as an estimate,
  not a stated fact.'
- Otherwise keep the existing text, which is accurate when the step has no phrase at all.

### POSTPROCESS_VERSION: yes, 5 → 6

- Every graph.py code change, including the warning f-string, moves the AST hash checked by
  `tests/test_postprocess_version.py`.
- One bump for the whole PR, computed after the last graph.py change. Append `"6": "<hash>"` to
  `tests/fixtures/postprocess_versions.json`.
- No schema change, so no `make types`.

## Synthetic tests (written first, seen failing, then implemented)

**API: `apps/api/tests/test_extract_graph.py`.** All recipes are hand-built with `_recipe`/`_step`;
no fixture names appear in logic.

1. Same name in the main list and group G. A step whose other ingredients are G-only gets the G
   id; a step with main-list ingredients gets the main id.
2. A step with no unambiguous ingredients gets the ungrouped id.
3. A tie between two groups resolves to the ungrouped id.
4. A name only in groups A and B, with home = ungrouped, resolves to both ids.
5. **Guard:** an id no step would pick keeps its original consumers in their original order;
   `validate()` has no `ingredients_consumed` violation. The existing
   `test_duplicate_ingredient_names_are_both_consumable` still passes unchanged.
6. **Explicit path:** two steps naming "Cumin seeds" from different groups with
   `depends_on_steps=[]` get no "shares an ingredient" edge. Positive control: the same group
   still gets the edge.
7. The same pair of cases on the legacy `depends_on_previous=False` path.
8. Unresolved component names still collide by name (behaviour kept).
9. The `Ingredient` list (`qty`, `qty_text`, `unit`, `group`, count) is identical with and
   without the resolver.

**API: D5.**

10. `_duration_expressions`:
    - grounds: `2 घंटे` → 120; `२ घंटे` → 120; `2 से 3 घंटे` → 120–180; `4 मिनट` → 4;
      `30 सेकंड` → 0.5; `1 घंटा` → 60; `2 ghante` → 120;
    - English parsing unchanged.
11. **Must not ground:**
    - `एक घंटे बाद` yields no expression; "After one hour, mix…" against the corpus
      `एक घंटे बाद मिलाएं` stays ungrounded (no stated 60).
    - **Digit offsets:** `1 घंटे बाद` and `5 मिनट पहले` yield no expression (also romanized
      `1 ghante baad`). "After 1 hour, mix…" against `1 घंटे बाद मिलाएं` stays ungrounded, and so
      does "Rest for 5 minutes." against `5 मिनट पहले`.
    - **Positive controls in the same test:** `2 घंटे के लिए भिगो दें` → 120 still grounds, and a
      later `बाद` that isn't adjacent (`2 घंटे के लिए … बाद`) doesn't suppress it.
12. **Grounding:**
    - "Soak for 2 hours." against `2 घंटे के लिए भिगो दें` is stated, 120.
    - "Cook 3 to 4 minutes." against `3 से 4 मिनट` is grounded 3–4.
13. **Warning:** a phrase in the step but not in the corpus gives the new text; no phrase keeps
    the old text. Update `test_extract_graph.py:453`, which is exactly the misworded case.

**Goldens on top:**

14. Against `render_source_text(captions-auto-hi.raw.json)`:
    - the soak step ("2 hours") grounds at 120;
    - "Cook … 3 to 4 minutes" stays ungrounded (the transcript says "तीन से 4", a number word),
      with the new "not found in the source text" warning;
    - "After one hour, mix…" stays ungrounded.
15. The `consumes` in `sabudana-khichdi.graph.json` equal the resolver's output over the pre-D3
    graph in `docs/investigations/sabudana-2026-10-13.library.json`. Temper and Make chutney share
    no resolved id.

**Web (Vitest):**

16. `uniqueDisplayNames` / `youllNeedText`:
    - the same name from two groups appears once;
    - trim and case variants appear once;
    - "Green chilli" and "Green chillies" both appear;
    - first-occurrence order is kept;
    - `stage.ingredients.length` is unchanged.
17. The sabudana Cook card's exact "You'll need" string.

## Predicted fixture/golden changes (after the HARD STOP only)

| File | Change |
|---|---|
| `apps/api/tests/fixtures/sabudana-khichdi.graph.json` | `consumes` and one edge change; see the breakdown below |
| `apps/api/tests/fixtures/sabudana-khichdi.plan.json` | **unchanged** (verified) |
| `apps/web/src/__fixtures__/sabudana-khichdi.plan-response.json` | graph section only, same edits. `plan`, `stages` and `summary` unchanged |
| The other 10 web fixtures, the other 7 API goldens, `quantityLine.golden.json` | unchanged. `export_web_fixtures.py` rewrites them all with CRLF, so restore them with `git checkout --` |
| dal-makhni / pizza replays (tests only) | unchanged |

`sabudana-khichdi.graph.json` changes:

| Node | Before → after |
|---|---|
| Grind | drops `ing_roasted_peanuts_2` |
| Make chutney | drops `ing_roasted_peanuts`, `ing_cumin_seeds`, `ing_sendha_namak` |
| Temper | drops `ing_cumin_seeds_2`; `depends_on` `[chutney]` → `[step_dry_roast_1_cup_raw_peanuts]` |
| Add sabudana | drops `ing_sendha_namak_2`, `ing_roasted_peanuts_2` |

**Why the plan doesn't move when Temper ← chutney goes:** `_pan_chain_gates`
(`schedule/scheduler.py:85`, PR-A).

- Temper is a hands-on burner step that feeds the burner step Cook potatoes, so it is flagged.
- Its gate is the other inputs of the chain Cook potatoes → Add sabudana: Coat sabudana and its
  ancestors.
- So Temper is held until about minute 131. The chutney edge (chutney ends at minute 18) was
  never the binding constraint.

Print Temper's gate at the HARD STOP to show this.

**How the golden is produced.** `consumes` come from running the resolver over the pre-D3 graph
(script, no LLM). Names are recovered from the consumed ids, which is lossless for id resolution.
The Temper edge is **hand-edited**, because no full `NormalizedRecipe` exists to rebuild edges
from. Test 15 checks the edit via the shared-id check, and the replay above produced the same
edge.

## Implementation steps

Setup (done):

```
git -C "C:\Users\ashya\Music\ABC cook" fetch
git worktree add ../abc-cook-pr-c -b fix/ingredients-pr-c origin/main
cd ../abc-cook-pr-c && cd apps/web && npm ci
```

The worktree path has no space on purpose, because a space in the path breaks `make types`.

For Python, use the main checkout's `apps/api/.venv` python with `PYTHONPATH=apps/api`. Run steps
by hand; no `make types` is needed.

Commits:

1. `docs: every fix is generic` — add one line to CLAUDE.md § Principles: "Every fix is generic: no
   recipe names, node ids or fixture names in logic, only in tests."
2. `fix(extract): resolve ingredient ids by home group, with a no-orphan guard (D3)` — tests 1–5
   and 9 first.
3. `fix(extract): independence compares resolved ingredient ids (D3)` — tests 6–8 first.
4. `fix(extract): ground Hindi duration units in the source (D5)` — tests 10–12 and 14 first.
5. `fix(extract): say when a stated duration is missing from the source, not the step` —
   test 13.
6. `chore(cache): POSTPROCESS_VERSION 6`.
7. `fix(web): show each ingredient name once in You'll need` — tests 16–17 (17 uses the
   current fixture; it holds before and after the golden update).
8. `docs(plans): offset is not a duration follow-up`.

Run the full checks after each commit (see Verification).

**HARD STOP.** Report:

- the actual vs predicted outcome for all 11 web fixtures and 8 API goldens (expected: none
  changed so far);
- the proposed sabudana golden diff;
- Temper's pan-chain gate;
- a **390 px-wide screenshot** of the sabudana Plan tab with the Cook card expanded, showing the
  deduplicated "You'll need" line.

Wait for approval.

9. `test(fixtures): sabudana golden with group-resolved consumes` — produce it by script,
   hand-edit the Temper edge, add test 15, and re-run `test_schedule.py`; `plan.json` must stay
   unchanged.
10. `test(web): regenerate sabudana fixture` — run `export_web_fixtures.py`, keep only the
    sabudana graph-section change, restore the other 10, and check LF endings.

Not in PR-C:

- the pan/vessel identity work (PR-D);
- stale saved recipes: the bump invalidates the server cache only, and localStorage saves keep
  the old graph. See `docs/plans/followup-saved-recipe-staleness.md`;
- the sabudana main list holds both "Green chilli" (1 tbsp) and "Green chillies" (2), a possible
  extraction duplicate, which is why the guard restores "Green chilli" to Make chutney →
  PR-D / prompt v8;
- Hindi number words (and so "तीन से 4 मिनट") and the English "after N" offset →
  `followup-offset-not-duration.md`.

## Verification

- **API** (in `apps/api`, `PYTHONPATH=.`):
  - `python -m pytest -q`, including `test_postprocess_version.py`, `test_schedule.py` and
    `test_extract_graph.py`;
  - `ruff check .`;
  - `mypy --strict abc_cook/schema abc_cook/schedule`.
- **Web** (in `apps/web`): `npm test` (Vitest), `npx tsc --noEmit`, `npm run lint` if present.
- **Fixtures:**
  - re-run the dry run against the branch;
  - `git diff --stat` shows only the expected files;
  - `git diff --ignore-cr-at-eol` for the regenerated fixture.
- **By hand:** run the app (`run` skill or the dev server) and open sabudana-khichdi. On the Plan
  tab, the Cook card's "You'll need" lists each name once, and the Ingredients tab still shows
  both portions with their own quantities.
