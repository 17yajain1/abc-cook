# FGC-42: cooking-mode chips render quantities the way the Ingredients tab does

## Owner amendments

Approved 2026-10-19 with these answers and amendments. They win over the body.

Answers
Q1: A. Name first iff the trailing text, trimmed and case-folded, equals "to taste".
Q2: Equals-only. Accept the "1 tsp to taste salt" edge case (not in the repo). Add one
    synthetic test pinning it, so the behaviour is deliberate, not accidental.
Q3: Yes. A render-only scratch copy of kadhi-pakora with one qty_text changed, SHA-pinned in
    the harness, never in the repo.
Q4: Yes. FGC-44 stays P3, carried as the explicit `formatNumber: legacyNumber` argument.

Amendments
A1. Consumers of the phrase string: before the fix, grep every consumer of quantityPhrases /
    quantityLine output (viewModel, CookingShell, chip keys, any matching of chip text
    against step text or ingredient names, React keys built from the phrase). Report
    file:line for each at HARD STOP A. If anything parses or matches the phrase (e.g.
    expects the amount first, or keys on the string), STOP and report before changing it.
A2. Browser: use your own headless browser (Playwright's own Chromium) for the renders.
    Only if that's impossible, use CDP 9222 with one new tab you open and close yourself;
    never touch, navigate or close my existing tabs. Stop only PIDs you started.
A3. Render harness: first check notes/render-harness-t1b/ exists in the main checkout. If it
    doesn't, rebuild the three files from the pattern in docs/plans/r3-quantities.md Step 0
    (vite render config + render html booting the component on a fixture at 390 px), as
    untracked files. Say which you did.
A4. Screenshots at HARD STOP A: chip row before/after on the scratch kadhi screen, after on the
    unmodified kadhi screen, and the Ingredients tab before/after with the byte/pixel compare
    result stated. Crop or annotate so the two changed chips are easy to find.
A5. New follow-up, record only: the Ingredients tab has no handful rule, so a name that starts
    with its amount ("A handful of fresh coriander leaves" + trailing "a handful") likely shows
    the amount twice on the tab. Check whether any fixture renders that way and log it as
    FGC-47 (P3, web) with the evidence; do not fix in this PR.
A6. Request dumps: keep the 12/12 proof as planned, even though no Python changes.

### How the amendments land in the steps below (implementer's notes, not owner text)
- Q2 → add a row to the §2 table: `qty null, unit "to taste", qty_text "1 tsp"` → chip
  `1 tsp to taste salt`, tab trailing `1 tsp to taste`.
- A1 → new step 0b in §7, before commit 1: grep `quantityPhrases|quantityLine|\.chips|view\.qty`
  across `apps/web/src`; table of file:line + what each does with the string; STOP if any parses/
  matches/keys on it. (Known so far: `viewModel.ts:423` assigns; `CookingShell.tsx:89-91` maps
  `view.chips`; check whether its React `key` is the phrase.)
- A2/A3 → §5: Playwright's bundled Chromium, headless, 390×844; the harness copy is reused if
  `notes/render-harness-t1b/` exists (it did at plan time and at setup), else rebuilt; HARD STOP A
  says which.
- A4 → §5 deliverables as listed, cropped/annotated around the besan and salt chips.
- A5 → step 5 in §7 (docs commit) also adds FGC-47 to `followup-golden-corpus.md`, with the
  evidence from a scan of every fixture ingredient whose lower-cased name starts with its trailing.

## Context

The F2 ingredient chips (`cooking-mode/quantity.ts`) build their amount text with their own code
instead of the Ingredients tab's. That gives two visible bugs: a `qty_text` that already ends with
its unit prints "1 cup cup chole", and a `qty_text` of "to taste" prints "to taste salt". R3 kept
factor-1 output byte-identical on purpose, so this fix is its own ₹0 PR. It has to land before R4:
at factor != 1 the first bug becomes "⅔ cup cup chole" (verified: `parse_amount("1 cup", "cup")`
returns `{low 1, rest " cup"}`, so the line *is* scalable, and the unit is appended again).
Generic fix only. No recipe or fixture names in logic. Factor stays 1 at every call site.

All facts below were read from `origin/main` at `4cf652c` (Merge PR #69, R3), after `git fetch --prune`.

---

## STEP 0: Inventory

### How the Ingredients tab builds a line
`apps/web/src/plan/ingredientGroups.ts:36-39`
```ts
trailing: item.qty_text != null || item.qty != null || item.unit
  ? joinQtyUnit(scaleQuantity(item, factor).text ?? formatQty(item.qty), item.unit)
  : null
```
The name is a separate column (`name: item.name`, `:34`), drawn by `IngredientList`. The order is
name on the left, `trailing` on the right. There is no to-taste special case: "to taste" is just
`trailing`. Only caller: `IngredientsPanel.tsx:13` (no factor).

### How the chips and quantityLine build one
`apps/web/src/cooking-mode/quantity.ts:51-61` (`quantityPhrase`), used by `quantityPhrases`
(`:18-35`, chips via `viewModel.ts:423`) and `quantityLine` (`:42-49`, the join).
```ts
const name = ingredient.name.toLowerCase()
if (ingredient.qty == null && ingredient.unit === 'to taste') return `${name} to taste`   // :53
let qty = scaleQuantity(ingredient, factor).text ?? (ingredient.qty != null ? String(ingredient.qty) : null)  // :55-56
if (qty != null && startsWithWords(name, qty.toLowerCase())) qty = null              // :59 handful rule
return [qty, ingredient.unit, name].filter(Boolean).join(' ')                       // :60  <- no joinQtyUnit
```
There are three differences from the tab:
1. **Amount + unit join** (`:60`): a plain space join. It does not use `joinQtyUnit`.
2. **To-taste** (`:53`): it only fires on `unit === 'to taste'`. A `qty_text` of "to taste" falls
   through to the generic order, amount first.
3. **Legacy number fallback** (`:56`): `String(qty)` where the tab uses `formatQty(qty)`. This is FGC-44.

### joinQtyUnit (`apps/web/src/lib/quantity.ts:54`): where it is and isn't used
| Site | Uses it? |
|---|---|
| `plan/ingredientGroups.ts:38` (Ingredients tab) | yes |
| `import/draftView.ts:32` (streamed reading screen, `NormalizedIngredient.qty` + `unit`) | yes. Out of scope: it renders before `graph.py` and is not routed through `scaleQuantity` (R3 decision) |
| `cooking-mode/quantity.ts:60` (chips + quantityLine) | **no**. This is the bug |
| `cooking-mode/CookingShell.tsx:120` `view.qty` | n/a: renders a precomputed string; `task`/`handsoff_pending` set `chips` instead |
| `lib/scaleQuantityIdentity.test.ts:22` (frozen `oldTabText`) | yes (frozen copy) |

No other `.ts`/`.tsx` file outside tests reads `.qty`/`.unit` for display.

### Exactly which inputs produce each bad output (factor 1)
| Output | Inputs | Why |
|---|---|---|
| "1 cup cup chole" | `qty_text` ends with the unit as a whole word (fold: case-insensitive, trailing "s" dropped, glued "250g" counts), `unit` non-empty, not the to-taste branch. E.g. `qty_text "1 cup"`, `unit "cup"`, `qty_amount {1, rest " cup"}` or null | `:60` appends `unit` again; the tab's `joinQtyUnit` drops it |
| "⅔ cup cup chole" (R4) | same, with `qty_amount` non-null and factor ⅔ | `scaleQuantity` → "⅔ cup", then `:60` appends "cup" |
| "to taste salt" | `qty == null`, `qty_text "to taste"`, `unit` null (or any unit other than the literal "to taste") | `:53` only checks `unit`, so the phrase is built amount-first |

**No web fixture has a duplicate-unit line.** Over all 14 `__fixtures__/*.plan-response.json` files,
no ingredient's `qty_text` ends with its non-empty `unit`. The 23 chole lines exist only as a stream
draft (`apps/api/tests/fixtures/stream/chole-bhature.low.normalized.json`, `qty "1 cup"`, `unit "cup"`).
Chole is Tier 0 in `known-wrong/`, so there is no built chole plan. (The sabudana *API* graph has
"1 cup"/"1 tbsp" `qty_text` with `unit: null`, which is not a duplicate.) So "1 cup cup" has **no golden entry**.

The to-taste shape occurs in 3 fixture ingredients: kadhi-pakora `ing_salt`, `ing_salt_2`, sabudana
`ing_sendha_namak`. All three are `qty null, qty_text "to taste", unit null, qty_amount null`. The
whole repo has exactly 4 `"qty_text": "to taste"` values and no "as needed"/"pinch"/"handful" qty_text.

### FGC-44 (String vs formatQty): same code path, but it churns goldens → stays P3
It is the same line (`:56`). Switching the chip fallback to `formatQty` would change **2 more golden
entries** (maggi `boil_water` "1.5 cup water" → "1 1/2 cup water"; donuts `heat_oil` "1.5 l neutral
oil, for frying" → "1 1/2 l …") and 1 more identity case (synthetic 7). That is extra golden churn, so
by the owner's rule **FGC-44 is excluded and stays P3**. The plan keeps a `String(qty)` fallback in the
chip path, passed explicitly to the shared formatter, so the FGC-44 PR later changes a single argument.

### FGC-25: out of scope
FGC-25 (the model's `qty`/`qty_text` already contains the unit at the source) is fixed in
`graph.py`/`_parse_qty`. That changes import post-processing, so it needs a `POSTPROCESS_VERSION` bump.
This PR only changes display (web) and leaves PPV at **14**. The chip fix hides the duplicate on
screen the same way the tab already does. The stored data keeps the duplicate until FGC-25.

---

## 1. The fix

### Shared formatter: `apps/web/src/lib/quantity.ts`
Add one exported function, the single place an ingredient's amount is turned into text and joined
with its unit. Both screens call it.
```ts
/**
 * An ingredient's quantity column: its amount (scaled by `factor`, else the source's text, else the
 * parsed number) joined with its unit by `joinQtyUnit`. `null` when the line states no amount and no
 * unit. `omitAmount` drops the amount but keeps the unit (the chips' "a handful of …" rule).
 */
export function quantityTrailing(
  item: Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'>,
  factor = 1,
  options: { formatNumber?: (qty: number | null | undefined) => string; omitAmount?: (amount: string) => boolean } = {},
): string | null
```
Body: the tab's existing condition (`qty_text != null || qty != null || unit`, else `null`). Then
`amount = scaleQuantity(item, factor).text ?? (options.formatNumber ?? formatQty)(item.qty)`. If
`omitAmount?.(amount)` is true, `amount = ''`. Return `joinQtyUnit(amount, item.unit)`. It keeps the
`scaleQuantity(…, factor)` call R3 added. (`lib/quantity.ts` importing `./scaleQuantity` is safe:
`scaleQuantity.ts` imports only types.)

### Ingredients tab: `plan/ingredientGroups.ts:36-39`
`trailing: quantityTrailing(item, factor)`. It is the same expression moved into the helper, so the
output is byte-identical (the frozen `oldTabText` assertion proves it). Drop the now-unused
`formatQty`/`joinQtyUnit`/`scaleQuantity` imports.

### Chips: `cooking-mode/quantity.ts:51-61` (`quantityPhrase`)
```ts
const name = ingredient.name.toLowerCase()
const trailing = quantityTrailing(ingredient, factor, {
  formatNumber: legacyNumber,                                // FGC-44: chips keep String(qty) for now
  omitAmount: (amount) => startsWithWords(name, amount.toLowerCase()),
})
if (!trailing) return name
return isToTaste(trailing) ? `${name} ${trailing}` : `${trailing} ${name}`
```
- `legacyNumber = (qty) => (qty != null ? String(qty) : '')`, with a comment pointing at FGC-44.
- `omitAmount` keeps today's handful rule: it tests the amount *before* the unit is joined, exactly
  as `:59` does. A guard skips an empty amount.
- **Name placement rule (Q1 = A):** the name goes *first* when the trailing text, trimmed and
  case-folded, is exactly `to taste`. Otherwise it goes last ("amount unit name"). The trailing text
  itself is the tab's, verbatim. This replaces the `:53` special case: `qty null + unit "to taste"`
  gives trailing "to taste" (from `joinQtyUnit('', 'to taste')`), so it still renders "salt to taste",
  and synthetics 3/4 plus the kadai/biryani goldens stay identical.
- The dedup `Set` in `quantityPhrases` and `quantityLine`'s join are untouched.

Behaviour change at factor 1, all of it intended:
- duplicate unit: "1 cup cup x" → "1 cup x"
- `qty_text` "to taste": "to taste x" → "x to taste"

A side effect outside the corpus (none in the repo): `qty null, unit "to taste", qty_text "1 tsp"`
used to render "salt to taste", which dropped the text. It now renders "1 tsp to taste salt",
the same trailing text as the tab. Accepted (Q2) and pinned by a synthetic test.

### Files touched
`apps/web/src/lib/quantity.ts`, `apps/web/src/plan/ingredientGroups.ts`,
`apps/web/src/cooking-mode/quantity.ts`, tests (below), `quantityLine.golden.json` (3 hand edits),
docs (`docs/plans/fgc-42-chip-quantity.md`, `followup-golden-corpus.md`). No API, schema,
fixture or PPV change.

---

## 2. Tests first (red before the fix)

Add these to `apps/web/src/cooking-mode/quantity.test.ts` in a new `describe('chips share the
Ingredients tab quantity text (FGC-42)')`. They use only synthetic `ing()` lines with neutral names
(`X`, `Flour`, `Salt`, `Eggs`), never fixture names. Each case asserts the chip phrase **and** that its
amount text equals `panelIngredientGroups([...])` `trailing` for the same item:
| Case | Input | Chip phrase | Tab trailing |
|---|---|---|---|
| duplicate unit | `qty_text "1 cup"`, `unit "cup"`, `qty_amount {1,null,'',' cup'}` | `1 cup flour` | `1 cup` |
| duplicate unit, plural/glued | `qty_text "2 cups"`/`unit "cup"`; `qty_text "250g"`/`unit "g"` | `2 cups flour`; `250g flour` | same |
| duplicate unit at ⅔ | as row 1, factor `2 / 3` | `⅔ cup flour` | `⅔ cup` |
| to-taste qty_text | `qty_text "to taste"`, `unit null` | `salt to taste` | `to taste` |
| to-taste unit (regression) | `qty null`, `unit "to taste"` | `salt to taste` | `to taste` |
| to-taste unit + other text (Q2) | `qty null`, `unit "to taste"`, `qty_text "1 tsp"` | `1 tsp to taste salt` | `1 tsp to taste` |
| range | `qty_text "2-3"`, `unit "medium"`, `qty_amount {2,3,'',''}` | `2-3 medium x` | `2-3 medium` |
| no-unit count | `qty_text "3"`, `unit null`, `qty_amount {3,null,'',''}` | `3 eggs` | `3` |
| qty_amount null | `qty_text "1 cup (240 ml)"`, `unit null`, `qty_amount null`, factor 1 **and** 2 | `1 cup (240 ml) x` both | verbatim both |

Also a `quantityTrailing` unit block in `apps/web/src/lib/quantity.test.ts` covering: null for an
empty line, the default `formatQty` fallback, a custom `formatNumber`, and `omitAmount` keeping the unit.

**Identity test (`lib/scaleQuantityIdentity.test.ts`).** The frozen `oldTabText` / `oldChipPhrase`
stay untouched. The tab assertion (`:79-84`) stays fully identical. The chip assertion (`:86-92`)
gains one explicit, named exception map, keyed by the existing test label:
```ts
// FGC-42: the chips now share the tab's quantity text. Every case not listed here is still
// byte-identical to the frozen pre-R3 phrase; each listed one pins both its old and new text.
const CHIP_CHANGES: Record<string, { old: string; new: string }> = {
  'kadhi-pakora.plan-response.json ing_salt':        { old: 'to taste salt',         new: 'salt to taste' },
  'kadhi-pakora.plan-response.json ing_salt_2':      { old: 'to taste salt',         new: 'salt to taste' },
  'sabudana-khichdi.plan-response.json ing_sendha_namak': { old: 'to taste sendha namak', new: 'sendha namak to taste' },
  'synthetic 2':                                     { old: '1 cup cup x',           new: '1 cup x' },
}
```
For a listed label it asserts `oldChipPhrase(item) === old` (the exception is about what it claims
to be) and that the phrase, at factor default and 1, equals `new`. Every other label stays
`toEqual([oldChipPhrase(item)])`. Plus one test asserting every key in `CHIP_CHANGES` is a real
label, so nothing goes stale. (Fixture ids appear only in this test-side list, never in logic.)

---

## 3. Golden impact, predicted before running

### `apps/web/src/cooking-mode/quantityLine.golden.json`: exactly 3 entries change
| Fixture · node | Old | New |
|---|---|---|
| `kadhi-pakora` · `step_whisk_together_curd_besan_sliced_onions` | `1 ½ cups curd · 4 tbsp besan (gram flour) · ½ cup onion · ½ tbsp garlic · ½ tbsp ginger · 3/4 tsp turmeric · 1 tsp red chilly powder · 1 tbsp coriander powder · 1 tsp roasted cumin powder · to taste salt · 10 cups water` | same with `· to taste salt ·` → `· salt to taste ·` |
| `kadhi-pakora` · `step_mix_together_besan_salt_chopped_green` | `1 cup besan (gram flour) · to taste salt · 1 no green chilly · ½ tsp turmeric · 1 tsp red chilly powder · 1 tbsp coriander seeds · 1 tsp cumin · 3/4 tsp baking powder · 1 cup spinach · 3/4 cup water` | same with `· to taste salt ·` → `· salt to taste ·` |
| `sabudana-khichdi` · `step_add_the_coated_sabudana_and_sendha` | `to taste sendha namak · 1/4 cup roasted peanuts` | `sendha namak to taste · 1/4 cup roasted peanuts` |

Unchanged on purpose: biryani `mix_marinade`/`parboil_rice` and kadai `cook_tomato_base`
("salt to taste" already, via `unit "to taste"`), maggi `boil_water` and donuts `heat_oil`
(FGC-44 excluded). There is no "cup cup" entry (see STEP 0). No dedup collapse changes: no node
consumes two ingredients whose new phrases coincide.

Edit by hand, these three string substitutions only, never regenerated from the new code. The file
is LF (`eol=lf`) and stays LF. Then extend the comment block above the golden test
(`quantity.test.ts:85-100`) with a **third documented exception**: "FGC-42
(docs/plans/fgc-42-chip-quantity.md): three entries edited by hand, 'to taste salt' →
'salt to taste' (kadhi ×2) and 'to taste sendha namak' → 'sendha namak to taste' (sabudana). The
chips now use the Ingredients tab's quantity text. Every other entry is unchanged."

### Other goldens: predicted no change
API replay snapshots (`tests/fixtures/import/*.replay-expected.json`), schedule goldens
(`tests/test_schedule.py` fixtures), web `__fixtures__/*`, `postprocess-version.json`. No other test
pins "to taste salt" (grepped). **Any diff outside the 3 golden lines, the 4 identity exceptions and
the new tests = STOP.**

---

## 4. Proofs (HARD STOP A evidence)

- **Request dumps, 12/12 (A6).** At commit 0 (code = `origin/main`) into
  `notes/fgc-42/request-dumps/base/`: `--label after-off` and `--label after-on` (4 stream × strict
  each), plus an untracked wrapper calling `capture(stream, strict, added=None)` for the unset case
  (4). Repeat at HEAD into `head/`. `cmp` every pair: 12/12 identical (expected: the PR touches no Python).
- **Replay + schedule:** `pytest tests/test_corpus_replay.py tests/test_extract_replay.py
  tests/test_schedule.py` green; `git diff --stat origin/main -- apps/api` empty.
- **PPV:** `POSTPROCESS_VERSION = 14` unchanged; `tests/test_postprocess_version.py` green.
- **Counts before/after:** full `pytest -m "not llm and not network"` and `npx vitest run` counts at
  base and at HEAD. Python: same count. Vitest: base + N new (N listed). Plus `npx tsc --noEmit`,
  `ruff check`, `mypy --strict abc_cook/schema abc_cook/schedule`.
- `git diff origin/main -- apps/web/src/cooking-mode/quantityLine.golden.json`, shown in full (3 lines).
- Identity test output listing the 4 exceptions.
- A1: the phrase-consumer table (file:line, what each does with the string).

## 5. Render-first (CLAUDE.md), part of HARD STOP A

Copy the t1b harness from `notes/render-harness-t1b/` in the main checkout (`vite.render.config.ts`,
`render-t1b.html`, `src/__render_t1b__/main.tsx`; present at setup) into the worktree as
**untracked** files, renamed `*-fgc42*`. Never staged. `cacheDir` and fixtures live in the scratchpad.
If the folder is missing, rebuild from the pattern (A3) and say so.
- **Fixture:** kadhi-pakora, screen "Make pakora batter" (`step_mix_together_besan_salt_chopped_green`).
  It already has the to-taste line (`ing_salt_2`). No built fixture has a duplicate-unit line, so the
  harness serves a **render-only scratch copy** where `ing_besan_gram_flour_2.qty_text` is `"1 cup"`
  instead of `"1"` (unit stays `"cup"`, `qty_amount.rest` `" cup"`). That reproduces the chole shape
  on the same screen as the to-taste line. The copy is SHA-pinned in the harness, never in the repo (Q3).
- **Before** (base code) and **after** (HEAD): 390×844 PNG of the chip row. Expected before:
  "1 cup cup besan (gram flour)", "to taste salt". Expected after: "1 cup besan (gram flour)",
  "salt to taste". Also the unmodified kadhi fixture after (only the salt chip changes).
  Crop or annotate around the two changed chips (A4).
- **Ingredients tab before/after:** a second harness entry booting `IngredientsPanel` with
  `derivePlan(payload).ingredientGroups` on the same two fixtures. Before vs after should match;
  confirm with a pixel/byte compare of the PNGs, not by eye, and state the result.
- Use `<meta name="darkreader-lock">` and check the body background before trusting a shot.
- Use Playwright's own headless Chromium (A2); CDP 9222 only as a fallback, one new tab you open and
  close yourself. Stop only PIDs you started.

---

## 6. Setup (after plan approval, outside plan mode, then STOP)

1. `git fetch --prune`; `git worktree add -b fix/fgc-42-chip-quantity C:\Users\ashya\Music\abc-cook-fgc42 origin/main`.
2. Write this plan to `docs/plans/fgc-42-chip-quantity.md` with Write (Owner amendments at top).
3. In `docs/plans/followup-golden-corpus.md` under `### FGC-42`, add
   `**Status (2026-10-19): in progress.** Plan: docs/plans/fgc-42-chip-quantity.md` (Edit tool).
4. `git diff --check`; grep both files for mojibake `Ã|â€|Â|\xEF\xBF\xBD` (via `rg -n`). Must be clean.
5. One commit: `docs: plan FGC-42 chip quantity text` (+ Co-Authored-By trailer).
6. Report `git worktree list`, `git log -1 --stat`, first 10 lines of the plan, the Owner amendments
   section. **STOP.**

## 7. Implementation (fresh session in the worktree, auto mode; the plan doc is the source of truth)

0. Base captures at `origin/main` code: request dumps → `base/`, pytest + vitest counts, before renders.
0b. A1 consumer grep (`quantityPhrases|quantityLine|\.chips|view\.qty` across `apps/web/src`):
   file:line table. STOP if anything parses, matches or keys on the phrase.
1. `test:` new unit tests + identity exception map + the 3 golden hand edits + the comment (red: the
   new chip tests and 3 golden lines fail; the tab tests pass).
2. `fix(web):` `quantityTrailing` in `lib/quantity.ts`; tab and chips route through it (green).
3. Head captures: dumps → `head/` + `cmp`, counts, after renders, tab compare.
4. **HARD STOP A:** report §4 proofs + §5 screenshots. Wait.
5. After approval, `docs:` mark FGC-42 done in `followup-golden-corpus.md`. Note in the FGC-44 entry
   that it is now one argument (`formatNumber: legacyNumber` in `quantityPhrase`). Note in FGC-25
   that chips now mask it too. Add FGC-47 (P3, web) per A5 with the fixture-scan evidence.
6. **HARD STOP B:** record `git rev-parse HEAD^{tree}`; `git reset --soft origin/main`; one commit
   `fix(web): chips use the Ingredients tab's quantity text (FGC-42)`; `HEAD^{tree}` equal
   before/after; show `git log -1 --stat` + test output. Wait.
7. Push; `gh pr create --body-file <scratch>/pr-body.md` (ends with the Claude Code line). Owner squash-merges.
8. Cleanup (worktree remove, branch delete) only after `gh pr view fix/fgc-42-chip-quantity --json
   state` says `MERGED`.

### Carried rules
`OPENAI_API_KEY=invalid LLM_API_KEY=invalid` in-process (₹0). Frozen transcripts only: no YouTube,
no deploy, no phone runs. `PYTHONPATH=C:/Users/ashya/Music/abc-cook-fgc42/apps/api` on **every** Bash
call. No heredocs or `\u` escapes for non-ASCII (Write/Edit or `chr(0x…)`); the golden edits contain
`·`/`½`, so they are made with Edit. Restore CRLF if any fixture is touched (none planned). Never
`ruff format .`. Stop only my own PIDs; port 9222 is the owner's.

---

## Questions (answered: see Owner amendments)

1. To-taste name placement: A `salt to taste` (name first iff trailing equals "to taste") vs B
   `to taste salt` (generic order). **Answered: A.**
2. Odd to-taste combos: equals-only vs ends-with. **Answered: equals-only, edge case pinned by a test.**
3. Render-only scratch copy of kadhi-pakora for the duplicate-unit shot. **Answered: yes.**
4. FGC-44 stays P3 via `formatNumber: legacyNumber`. **Answered: yes.**
