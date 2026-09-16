# Cooking-plan investigation and implementation plan

Written 2026-09-16 from the ReciMe comparison in `docs/comparision 2.pdf`. Screenshots in
that PDF are evidence of *observed* product behaviour; the repository code and one actual
re-run of the pizza-dough import are the source of truth for root causes.

**Status.** Phase A shipped (`bdecd5c`) and Phase A.1 shipped (`2231aa3`), both on
`feature/M2.13-cooking-plan-phase-a`, neither pushed/merged. Phase 0 ran on 2026-09-16
against the owner's `abc-cook:library:v1` export and is recorded in §3 below — it was a
read-only structural check (`validate()` on the stored graph via the Pydantic models);
nothing in production code, tests, derived files, or git changed as part of it. Phases B
and C are planned, not approved for implementation.

Every claim below carries one of five labels:

- **[verified]** — read directly from code, or observed in an artefact listed in §1.
- **[re-run]** — observed on the 2026-09-15 re-run of the pizza import (a fresh LLM sample,
  *not* the screenshot's run).
- **[screenshot-export]** — observed 2026-09-16 in the owner's `abc-cook:library:v1`
  export (§3) — the actual saved `RecipePlanResponse` behind the PDF screenshot's run.
- **[inference]** — reasoning from verified facts; not itself observed.
- **[hypothesis]** / **[proposal]** — untested idea / future product work.

---

## 1. Evidence and artefacts

| Artefact | What it is | Where | Cost |
|---|---|---|---|
| Acquisition legs for all three links (yt-dlp metadata + description-link blog fetch) | printed output | session scratchpad | network only |
| Caption-track inventory for links 1 and 2 | printed output | scratchpad | network only |
| **Re-run of the pizza import** through `run_import` + `build_default_adapter()` — the repository's own process, identical to `tests/test_import_llm_transcript.py` | `pizza.raw.json` (the `RawAcquisition`), `pizza.llm_calls.json` (the model's `NormalizedRecipe`, verbatim), `pizza.import_result.json` (`ImportResult`: graph, plan, stages, provenance, warnings), `pizza.telemetry.json` (`ImportTelemetry`) | scratchpad | **₹1.87**, one GPT-5-mini call, zero repair calls |
| Offline validation of the existing independence unit-test graph | inline python | — | 0 |
| Pizza blog JSON-LD (`natashaskitchen.com/pizza-dough-recipe/`) | printed | — | network only |
| Independent audit of this document's line references and of the fork/join proposal against existing tests | fork agent report | — | 0 |
| **Owner's `abc-cook:library:v1` export** — the actual saved state behind the PDF screenshot's run, structurally validated 2026-09-16 (§3) | pasted JSON, one `SavedRecipe` | session scratchpad | 0 (localStorage read, no network/LLM) |

### 1.1 Two artefacts that must stay conceptually separate

**A. Screenshot localStorage export — received from the owner, structurally validated
(§3).** The screenshot run was saved in the owner's browser under
`localStorage['abc-cook:library:v1']` (M2.12 `SavedLibrary`). Each entry's `payload` is a
**`RecipePlanResponse` = `{graph, plan, stages}`** — a *finished* graph plus its scheduled
plan. It is **not** a `NormalizedRecipe`, so it cannot be replayed through `build_graph()`
and was not. Its use is **structural validation only**: `validate()` on the stored graph
and inspection of its edges, attention, windows and footer condition, as a cross-check
against the re-run — done in §3. The screenshot run's `NormalizedRecipe` (the model's raw
output) was never persisted anywhere and **cannot be recovered** — `ImportJobResponse`
carries the `ImportResult`, not the normalized recipe, and `ImportScreen.tsx:67-73` keeps
only `{graph, plan, stages}`. This remains true after the export: tier, pre-repair
violations and the model's raw claims are still unrecoverable (§3, §11).

**B. Captured `NormalizedRecipe` from the re-run.** `pizza.llm_calls.json` holds the exact
`NormalizedRecipe` the model returned, which is the *input* to `build_graph()`. It is the
**deterministic replay gate for Phase B**: `build_graph(recipe) + validate()` runs offline,
costs nothing, and its outcome does not depend on LLM sampling. It is persisted as
`tests/fixtures/import/pizza-dough.normalized.json` (landed in Phase A).

**Caveat on comparing A and B [verified from the PDF and the export, vs the re-run].** The
screenshot's graph has 19 nodes and ends on "Slide pizza onto preheated" (`attention =
periodic`, `kind = finish`) — confirmed structurally in §3, not just visually from the PDF.
The re-run has 14 nodes and ends on "Transfer the pizza to a cutting board and let it cool
slightly" (taken from the transcript, `attention=unattended`). Same video, different
samples. Conclusions that depend on the exact graph are labelled **[re-run]** or
**[screenshot-export]** and are not conflated with each other.

### 1.2 The three links as the pipeline sees them [verified, network]

| # | Video | Description | Recipe-blog link | Captions | Outcome |
|---|---|---|---|---|---|
| 1 | Gennaro Contaldo pizza (Jamie Oliver channel) | prose, no method | `goo.gl/fKbKPR` → jamieoliver.com **HTTP 404** (recipe page deleted) | **manual `en-GB`** (23 manual languages), auto `en` | our `select_track` skips the manual `en-GB` track and uses auto `en` |
| 2 | Vito Iacopelli poolish dough | ingredients only (poolish + dough, in three languages), no method | none (master-class, PayPal, Amazon, bensound) | **none** — `subtitles={'live_chat'}`, `automatic_captions={}` | no text anywhere describes the method → Tier 0 refusal is correct |
| 3 | Natasha's Kitchen pizza dough | full ingredient list | natashaskitchen.com, Recipe JSON-LD with `HowToSection`/`HowToStep` | manual `en`, 8 293 chars | all three legs fire → `done`; **tier = degraded [re-run]** |

The PDF pairs link 1 with a "Reddit" ReciMe screenshot and link 2 with a "Jamie Oliver"
one, but link 1 *is* the Jamie Oliver channel; the two screenshots are probably swapped
**[inference]**. ReciMe's internals are **[unverifiable]**; the observable fact is that it
followed *some* link and presented page navigation ("More replies", "Unleash your inner
chef") as ingredients, whereas ABC Cook refused and kept the shopping list.

---

## 2. Root causes

### 2.1 Mechanical issues (Phase A scope)

**M1 — Mixed fractions render as bare `cups` [verified].** The model emitted
`qty: "1 1/4"` and `"3 1/3"` exactly as `prompts/v2.md:50-52` instructs **[re-run]**.
`_parse_qty` (`apps/api/abc_cook/extract/graph.py:107-120`) accepts only `^\d+/\d+$` and
`^\d+(\.\d+)?$`, so a mixed fraction returns `None`; `graph.py:322` writes that into
`Ingredient.qty` (`schema/ingredient.py:15`, `float | None`), a model with **no field for
the original text**. The Ingredients tab renders `graph.ingredients`
(`apps/web/src/plan/derive.ts:220` → `IngredientsPanel.tsx:28-31`), so `null` + `"cups"`
renders as `cups`. `"1/2"` survived because a plain fraction parses. The same loss hits
every phrasing the prompt tells the model to preserve ("a little less than 2", "2-3",
"a pinch", `¼`). *Category: parser bug + schema gap.* The fix spans three layers (parser,
schema, UI), not the parser alone.

**M2 — Manual `en-GB` subtitles skipped [verified, network].** `select_track`
(`apps/api/abc_cook/extract/acquire/transcript.py:80-84`) tries manual keys
`[language, "en"]` only. Link 1 reports `language="en"`, and its manual keys include
`en-GB` but not `en`, so the creator's subtitles are skipped in favour of auto `en`.
*Category: acquisition.*

**M3 — "until until doubled in size" [verified].** `StageCard.tsx:121-124` renders
`until {task.donenessCue}`; `WaitWindowBlock` does the same for hosts. All six golden
fixtures store cues *without* a leading "until" (`"doubled in bulk, holds a dimple when
poked"`), so the UI convention is "cue = the condition". The prompt's examples
(`v2.md:102`, `"until golden"`) teach the model to emit cues *with* "until"; the re-run's
cues are `"until doubled in size"`, `"until the dough comes together"` **[re-run]**.
*Category: data-convention mismatch between extraction output and UI.*

**M4 — Broken labels ("Measure 3 1 3", "Form ball in your", "Place pizza stone or")
[verified].** `Node.instruction` is the full step text (`graph.py:409`) and reaches the
client as `RenderTask.instruction` (`derive.ts:104`) — nothing is lost. `Node.label` is
built by `_label` (`graph.py:99-104`): tokenises on `[A-Za-z0-9']+` (so `3 1/3` → `3 1 3`),
drops a small stopword set, keeps four tokens — hence dangling prepositions. The Plan tab
shows `label` only (`StageCard.tsx:120`), by design. *Category: graph construction
(cosmetic).*

**M5 — Generic Tier-0 copy [verified].** `ImportResult.sources` is set on Tier 0
(`import_pipeline.py:183-188`) and is in the generated TS (`packages/schema/index.ts:400`),
but `NotGroundedResult` (`ImportScreen.tsx:172-236`) ignores it. *Category: UI.*

**M6 — Degraded/estimated state never shown [verified].** `ImportScreen.tsx:67-73` hands
`PlanScreen` only `{graph, plan, stages}`; `warnings` (which contains the literal
`"degraded"`), `review_recommended`, `provenance` and `sources` are dropped. On the re-run
the plan was degraded and the screen would show it as a normal plan. `SavedRecipe.payload`
(`schema/library.py:37`) is a `RecipePlanResponse`, so a reopened recipe cannot show them
either. *Category: UI + client schema gap.*

**M7 — Misleading footer [verified].** `PlanScreen.tsx:122-127` fires on
`savedMin === 0` and says "Nothing in this recipe cooks unattended — there's no prep to
slot in while you wait." On the re-run four nodes are `unattended` (4 h 30 rise, 18 h
fridge, 1 h rest, 10 min preheat) **[re-run]**; the screenshot-export's stored graph has
4 `unattended` + 2 `periodic` nodes and `saved_min === 0`, so the footer condition
actually fires there and the first clause is false **[screenshot-export, confirmed in
§3.2 — previously only [verified from PDF]]**. Fixed by A7 (Phase A).
*Category: UI copy.*

### 2.2 The zero-windows question — what the actual graph says

Hypothesis tested: *independent work was incorrectly serialised.*

**What the model emitted [re-run].** `depends_on_previous = True` on **all 14 steps**,
including step 7 ("Place a pizza stone or inverted baking sheet … preheat to 550˚F";
`attention=unattended`, cue `"preheat to 550˚F"` grounded; duration `(10, 20, 30)`,
`duration_stated=False`) and step 8 ("Lightly flour a pizza peel and prep toppings";
`hands_on`). `produces_component` set on 8 steps; `consumes_ingredients` named a component
once (step 6, `"cold dough balls"`).

**What `build_graph` did [re-run].** Base chain — every node depends on its predecessor
(`graph.py:441-443`). Attention verified; window-host clamp set preheat typical → 10 with
the warning "clamped to its low end (10 min)". `validate()` returned seven violations: six
`produces_consumed`, one `unattended_kind`.

**What repair did [re-run].** `repair_or_degrade`'s triage (`repair.py:271-299`) saw
`unattended_kind ∉ REPAIRABLE_RULES`, skipped the Sonnet call, and returned
`build_linear_graph` (`force_linear=True`). Tier **degraded**, `review_recommended=True`,
warnings include `"degraded"`. **The final graph still fails `validate()`** on the same
`unattended_kind` violation (printed as `validate(final)` in the run). `run_import` does
not re-validate after repair, so the plan shipped. `repair.py`'s docstring ("guaranteed to
pass all ten invariants by construction") does not hold; the comment on
`test_failed_repair_degrades_to_tier1_linear` assumes it.

**Why `unattended_kind` fired [verified].** The last step ("let it cool slightly before
serving") has a grounded unattended cue. `graph.py:369` forces `kind="finish"` on the last
step unconditionally; invariant 9 (`validate.py:294-306`) requires `unattended ⇒ kind ∈
{passive, prep}`; invariant 3 requires the sink to be `finish`. **The three rules are
jointly unsatisfiable whenever a source's last step carries an unattended cue** ("let
cool", "rest before slicing"). Deterministic construction conflict, not a model error;
`force_linear` runs through the same line, so degrade cannot escape it. *The screenshot
run's last node is `periodic` (confirmed, §3.2), and its stored graph passes `validate()`
with zero violations, so this specific conflict did not fire there — that run's tier
itself remains **[unverified]** (§11).*

**Why six `produces_consumed` fired [verified].** `graph.py:451-469` wires a producer to
a consumer only when a *later* step's `consumes_ingredients` contains the component name.
The schema description (`schema/normalized.py:126-129`) and the prompt (`v2.md:114`) both
tell the model `consumes_ingredients` are *ingredient names*. So components are named
there only rarely, and each `produces_component` without a later substring match violates
invariant 6 — six of eight here. On an import with no blocking violation this triggers a
paid Sonnet repair (₹2–8) **[inference from `repair.py` control flow]**. This is a
prompt/schema ↔ graph vocabulary mismatch, independent of the pizza recipe.

**Scheduler and rollup [re-run].** With a strictly linear chain the scheduler placed every
node back to back, derived a window for each unattended host, found no hands-on task
running inside any host interval (there is none — every node depends on the host), dropped
the empty windows per `COOKING_GRAPH.md` §4.3, and reported `saved_min = 0`.
`stage_spans` grouped nodes by `Node.stage` in `graph.stages` order. Both behaved exactly
as specified.

**Verdict.**

- **D — the hypothesis "graph.py serialised an independence claim" is not supported
  [re-run].** There was no independence claim to serialise. For the screenshot run the
  *structural* half of this is now **[screenshot-export, confirmed]** (§3.2: a single
  strict chain, no fork/join edges present in the stored graph) — whether the
  screenshot run's model ever *claimed* independence and had it dropped remains
  **[inference]**, since its `NormalizedRecipe` is unrecoverable (§3.3).
- **A — extraction is the proximate cause.** The model asserted sequential order for every
  step although `v2.md:111-113` already carries the exact example ("meanwhile, preheat the
  oven while dough rests") and the blog step reads "Before forming the pizza crust, fully
  preheat your oven … Also, lightly flour a pizza peel and prep toppings". Why the model
  chose `True` is **[unverifiable]**.
- **B — a latent, deterministic construction bug would have blocked a correct answer
  [verified offline].** On the existing unit test's own fixture
  (`tests/test_extract_graph.py:255-271`: chop → *meanwhile preheat*, `depends_on=[]` →
  bake), the built graph has **two sinks** (`chop`, `bake`) and fails `single_finish_sink`.
  Every honoured `depends_on_previous=False` orphans the previous step, because the next
  sequential step depends only on the independent node (`graph.py:441-443`), unless a
  produces/consumes match happens to re-attach it. That violation *is* repairable, so it
  costs a Sonnet call; the likeliest repair is to set the flag back to `True`, given the
  message "expected one sink, found 2" **[inference]**. Corroboration from repository
  data: the real M2.9 s15 failure fixture `tests/fixtures/import/dal-makhni-multibranch.
  normalized.json` produces three sinks today; under the fork/join rule (§6, B1) it
  produces one sink and only `produces_consumed` remains (audit simulation, offline). That
  "real multi-branch failure" was largely the chain-break plus the vocabulary mismatch.
- **C — two UI gaps** (M6, M7 above).

**One upstream issue or several?**

| Observation | Cause | Relationship |
|---|---|---|
| zero wait windows | linear graph from extraction; empty windows dropped by design | root |
| no parallel tasks | same | symptom of root |
| "nothing cooks unattended" footer | keyed on `savedMin === 0`; wording false | symptom of root **plus** its own copy bug (M7) |
| stage presentation (Prep/Cook interleaved on the Plan tab) | `_stage_for` (`graph.py:244-249`) assigns stage by node *kind*; imported stages are non-contiguous, goldens' narrative stages are contiguous | **independent**; not changed (owner instruction). Recorded in §8 |
| stage duration display ("Cook ~304 min") | UI shows unattended minutes as undifferentiated work; no attended split in `StageSpan` | **independent** (Phase C) |
| tier = degraded; final graph invalid **[re-run only]** — the screenshot-export's stored graph passes `validate()` with zero violations (§3.2), because its sink is `periodic` not `unattended`, so this specific conflict did not fire there | `graph.py:369` + invariant 9 | **independent** of the root; would matter the moment the model claims independence (Phase B2) |
| routine invariant-6 violations | vocabulary mismatch | **independent** (Phase B3) |

### 2.3 Preheat "~10 min" [verified]

`M2.9-youtube-import-design.md` §5: a plausible typical is allowed "only when the text
itself is vague-but-present"; §4.7: a window host with a non-stated duration gets
`duration_typical = duration_min` (low end), honest `duration_max`, `review_recommended`,
and "the displayed number is explicitly typical; the `doneness_cue` governs the actual
finish". `prompts/v2.md:99-102` says the same. Model: `(10, 20, 30)`,
`duration_stated=False`, cue `"fully preheat your oven"` **[re-run]**; `graph.py:
_resolve_duration` clamped typical to 10, provenance `duration: inferred`,
`review_recommended=True`. **10 min complies with the contract.** The source gives a
consistent signal — the transcript says "a few minutes before you start making your pizza,
you want to preheat your oven with the pizza stone … to 550" — and no number. A stone
"realistically needing 30–45 min" is cooking knowledge, which the contract forbids
substituting for the source; withdrawn. **The problem is provenance/presentation** (Phase
C): the Plan tab shows `10 min` with the same weight as a stated `2 min`, the cue line
reads "until fully preheat your oven", and provenance never reaches the client (M6). Not a
duration, extraction, validation or normalisation problem; no blanket ban on inferred
durations is proposed.

### 2.4 `HowToSection` names [verified]

The blog JSON-LD carries `HowToSection` names "How to Make Pizza Dough:" and "How to Form
a Pizza Crust:"; `render_source_text` (`normalize.py:134-139`) dumps the whole Recipe node,
so the model sees them. `NormalizedStep` (`schema/normalized.py:78-159`) has no section or
stage field, so the model has nowhere to put them; `graph.py:_stage_for` assigns
`prep|cook|finish` by kind. `v2.md:74-76` already says "use section names to keep related
steps together in order" and `M2.9 §4.4` says they "map almost directly onto `Stage`
labels" — the intent exists; the data path is missing. Reliability when present is high
(author-written headings in a closed structure); absent for flat `recipeInstructions` and
for description/transcript-only imports.

### 2.5 Source limitations

- **Link 2 [verified]:** no captions of any kind, ingredients-only description, no recipe
  page. ASR is the only way to obtain method text; see §7 (ASR decision).
- **Link 1 [verified 2026-09-15]:** the "Recipe here" `goo.gl` link redirects to a
  jamieoliver.com page that returns 404. Pages change; re-check before relying on it.

---

## 3. Phase 0 — Screenshot-graph structural cross-check (done, 2026-09-16)

Ran read-only against the owner's `abc-cook:library:v1` export: loaded `payload.graph`
and `payload.plan` into the `CookingGraph`/`CookingPlan` Pydantic models and called
`validate()` directly. **The finished graph was not replayed through `build_graph()`.**
Nothing in production code, tests, derived files, or git changed. No file was added to
the repo — the export lives only in the session scratchpad.

### 3.1 What the artefact contains [screenshot-export]

`SavedLibrary` → one `SavedRecipe`:
`id=3b37c83c-cb2b-419d-8950-07d5ae7d9307`, `source_key=youtube:WM1XcYXix0Y` (the same
video as the re-run), `saved_at=updated_at=2026-09-15T14:00:34Z`. `payload` is exactly
`{graph, plan, stages}` — no `import_meta` (this save predates A6, which shipped after
this screenshot run). `graph.title` = "Best Homemade Pizza Dough Recipe | How To Make
Pizza Crust", `graph.source` = the same YouTube URL as link 3.

### 3.2 Structural findings [screenshot-export]

- **Node count: 19** (vs. 14 in the re-run — different LLM sample of the same video,
  per the §1.1 caveat).
- **`depends_on` shape: a single strict chain.** One source
  (`step_in_a_small_bowl_stir_together`, `depends_on=[]`), one sink
  (`step_slide_pizza_onto_the_preheated_pizza`), every other node depends on exactly the
  node before it. No fork, no join, no independence claim survived into this graph —
  same conclusion as the re-run, by a different route (the re-run's model claimed
  `depends_on_previous=True` throughout; this graph's raw `NormalizedRecipe` is
  unrecoverable, so whether its model did the same is unknown, but the *result* is
  identical).
- **Unattended/periodic nodes (6 of 19):**
  - periodic (2): `step_in_a_small_bowl_stir_together` (combine, source),
    `step_slide_pizza_onto_the_preheated_pizza` (finish, **sink**, cue "until crust is
    golden brown…")
  - unattended (4): `step_cover_the_bowl_with_plastic_wrap` (passive, cue "until doubled
    in size"), `step_form_a_ball_in_your_hands` (prep), `step_remove_the_dough_1_hour_before`
    (prep), `step_place_a_pizza_stone_or_inverted` (passive)
  - This is the artefact behind the PDF's "four (hands-off) nodes" claim in M7 — now
    **[screenshot-export]**, not just **[verified from PDF]**.
- **Produces/consumes: none.** `produces` is `null` on all 19 nodes — no
  component-producer edges exist at all. `consumes` is non-empty only on the first two
  nodes and references **ingredient ids** only (`ing_warm_water`, `ing_honey`,
  `ing_fine_sea_salt`, `ing_active_dry_yeast` on node 0; `ing_all_purpose_flour` on node
  1) — all 5 ingredients accounted for. There is nothing here for invariant 6
  (`produces_consumed`) to check, since nothing produces a component.
- **`plan.windows == []`, `plan.saved_min == 0`**, `plan.total_min == plan.serial_min ==
  1466`. No parallel work was ever placed.
- **Tier: still unrecoverable** — `RecipePlanResponse` carries no tier field, and
  `plan.warnings == []` carries no `"degraded"` marker either, so there is no indirect
  signal. `import_meta` (A6) doesn't exist for this save either. Confirmed unavailable,
  exactly as §1.1/§3 anticipated.
- **`validate()` on the stored graph: zero violations.** All ten invariants pass,
  including `_check_unattended_kind` — which passes here specifically *because* the
  sink's attention is `periodic`, not `unattended`. This graph never reaches the
  invariant-9-vs-invariant-3 conflict described in §2.2.
- **Footer condition fires.** `saved_min === 0` is true and the graph has 6
  unattended/periodic nodes, so `hasUnattendedWork` (A7) is true — the pre-A7 footer
  ("Nothing in this recipe cooks unattended…") would have fired here and been false.
  This is a real, structurally confirmed instance of M7, not only a PDF observation.

### 3.3 Comparison with the re-run [screenshot-export vs re-run]

**Confirmed by both.** Strictly linear chain, one source, no independence claim survives
into the built graph, zero windows, `saved_min = 0`. No component produces/consumes edge
does real work in either run (screenshot: none exist; re-run: 6 of 8 asserted
`produces_component`s are unconsumed and drop or violate — different mechanism, same
end state of no real parallelism signal). M7's footer bug reproduces in both.

**Screenshot-export only.**
- 19 nodes vs. the re-run's 14.
- Exactly 4 unattended + 2 periodic nodes, matching the PDF's "four (hands-off)" count.
- The stored final graph is **fully valid** — 0/10 invariant violations. Structurally
  this is a "clean"-shaped graph, unlike the re-run's still-invalid degraded output.
  (Tier itself remains unrecoverable, so this is a structural observation, not a tier
  confirmation — a repaired-but-still-invalid graph could in principle have shipped
  unnoticed here too, per the `run_import` gap in §2.2; there is no artefact to rule
  that out.)
- The §2.2 verdict D inference — *"For the screenshot run this is [inference]... its
  `NormalizedRecipe` is unrecoverable"* — is now **confirmed** for the structural
  question ("did an independence claim get serialised into the graph?" — no) while
  remaining unrecoverable for the underlying model-behaviour question ("did the model
  claim independence at all, and the pipeline dropped it, or did it never claim
  independence?" — still unknown, see §11).
- The doc's earlier hedge *"the screenshot run's last node was `periodic`, so this
  conflict probably did not fire there; that run's tier is **[unverified]**"* (§2.2) is
  now confirmed on the structural half (`validate()` returns zero violations, including
  `unattended_kind`) — the tier half stays unverified.

**Re-run only.**
- 14 nodes; sink is `unattended`+`finish`, which *does* violate invariant 9 and forced
  `build_linear_graph`/degraded tier.
- The model's raw `depends_on_previous=True` claims and 8 `produces_component`
  assertions are only visible in the captured `NormalizedRecipe` — the screenshot run's
  equivalent raw output was never persisted and can't be recovered, so it's unknown
  whether this screenshot run's model made similar claims that the pipeline dropped, or
  made none at all.
- The six `produces_consumed` violations and the repair/degrade trace
  (`repair_or_degrade`, `force_linear=True`, `validate(final)` still failing) are
  re-run-only artefacts; nothing in the screenshot tells us whether that same
  pre-repair state ever existed for this graph.

**Still unknown.**
- The screenshot run's tier.
- Whether this screenshot run's model ever produced violations pre-repair (any
  invariant) that a repair/degrade pass then resolved — the export only has the final
  graph, not a pre-repair snapshot.
- Whether the two PDF screenshots for links 1 and 3 are swapped (§1.2) — unrelated to
  this export, which corresponds unambiguously to link 3 (Natasha's Kitchen,
  `source_key=youtube:WM1XcYXix0Y`).

---

## 4. Phase A — Mechanical, zero-LLM (approved)

### 4.1 Changes

**A1. `en-*` subtitle variants** — `apps/api/abc_cook/extract/acquire/transcript.py`
`select_track`: in the *manual* pass, after exact `lang` and exact `en`, try manual keys
whose base language matches (`lang-*`, then `en-*`), each group sorted for determinism.
Auto pass unchanged (its `-orig` logic guards against machine translation and must not be
loosened). Return the actual key (`en-GB`) so `_transcript_label` tells the model the
truth. Update the docstring's stated order.

**A2. Mixed fractions + `qty_text` fallback** —
- `graph.py:_parse_qty`: accept mixed fractions (`1 1/4`, `1-1/4`), unicode vulgar
  fractions (`¼ ½ ¾ ⅓ ⅔ ⅛ …`, incl. `1½`), ranges (`2-3`, `2 to 3`, `2–3`) → **low end**
  (conservative; the range text survives via `qty_text`). Vague phrases → `None`.
- `schema/ingredient.py`: `qty_text: str | None = None` — "quantity as the source stated
  it; display fallback when `qty` cannot be parsed, and the honest form of ranges and
  vague amounts". `graph.py:318-328` populates it from `NormalizedIngredient.qty`
  (whose docstring already reserves it for exactly this).
- Web: `IngredientsPanel.tsx` and `ImportScreen.tsx:NotGroundedResult` render
  `qty_text ?? formatQty(qty)`, where `formatQty` renders `1.25 → "1 1/4"`,
  `0.5 → "1/2"`, `2 → "2"` (a display formatter over one number, not scheduler
  arithmetic). New `apps/web/src/lib/quantity.ts`.

**A3. "until until"** — `graph.py`, at `Node` construction: strip a leading `until ` /
`till ` (case-insensitive) from `doneness_cue`. One place; golden data and UI unchanged.
Not a UI guard — the data convention is the contract.

**A4. Deterministic label cleanup** — `graph.py:_label`: keep number/fraction tokens
whole (`\d+(?:/\d+)?`, unicode fractions), drop a leading `PREP:`-style prefix, never end
on a function word (`in on or and with to your the a of for until then`) — trim back to
the last content word, still ≤ 4 words (`COOKING_GRAPH.md` §2). This removes broken
labels; it does not make them good. The robust option (a model-written `label`, ~5 output
tokens/step) is a Phase-B/C-adjacent proposal, not part of Phase A.

**A5. Tier-0 source-aware explanation** — `ImportScreen.tsx:NotGroundedResult`: choose
copy deterministically from `result.sources` (no LLM):

| `sources` | Copy |
|---|---|
| no `transcript`, no `blog` | "This video has no captions, and its description lists ingredients without saying how the dish is made." |
| `transcript` present | "We read this video's captions but couldn't find the method in them." |
| `blog` present (no usable instructions) | "The linked recipe page had no instructions we could use." |

Keep the "— but here's the shopping list" tail and buttons; show a
`"Transcript truncated…"` warning as a quiet second line if present. Never generate a
method. Paste/URL recovery is **not** built (§8.A).

**A6. Import-status observability** — carry `warnings`, `review_recommended`,
`provenance`, `sources` and the degraded state from `ImportResult` to the Plan screen and
into the saved recipe:
- `schema/library.py`: `SavedRecipe.import_meta: ImportMeta | None = None` where
  `ImportMeta` = `{warnings: list[str], review_recommended: bool, sources: list[…],
  provenance: GraphProvenance | None, degraded: bool}` (`degraded = "degraded" in
  warnings`, computed once in the client at save time — not a new server field). The
  frozen `RecipePlanResponse` is untouched (M2.9 decision 3). Fixture-path recipes have
  `import_meta = null`.
- Web: `ImportScreen.onImported` passes the meta alongside the payload; `App.tsx` threads
  it to `PlanScreen`; `library/store.ts` `save()` persists it; `PlanScreen` shows at most
  one calm line under the header: degraded → "Plan simplified — steps run one after
  another."; otherwise `review_recommended` → "Some timings are estimates." No banners, no
  warning dumps.

**A7. Footer fix** — `PlanScreen.tsx:122-127`: when `savedMin === 0` **and** the graph has
any `unattended`/`periodic` node → "This recipe has long, hands-off waits — but nothing
else in the plan can be done during them." When `savedMin === 0` and no such node exists
→ keep the current sentence. `derive.ts` exposes `hasUnattendedWork: boolean` (a
categorical lookup over `Node.attention`, not arithmetic) on `RenderPlan`.

### 4.2 Files likely to change

`apps/api/abc_cook/extract/acquire/transcript.py`; `apps/api/abc_cook/extract/graph.py`;
`apps/api/abc_cook/schema/ingredient.py`; `apps/api/abc_cook/schema/library.py`;
`apps/web/src/plan/IngredientsPanel.tsx`; `apps/web/src/import/ImportScreen.tsx`;
`apps/web/src/plan/PlanScreen.tsx`; `apps/web/src/plan/derive.ts`; `apps/web/src/App.tsx`;
`apps/web/src/library/store.ts`; new `apps/web/src/lib/quantity.ts`.

### 4.3 Tests to add/update

- `tests/test_acquire_transcript.py`: manual `en-GB` + auto `en` → manual `en-GB`;
  `language="hi"` with manual `hi-IN` → `hi-IN`; no manual → auto path unchanged.
- `tests/test_extract_graph.py`: `_parse_qty` parametrised (`"1 1/4"→1.25`,
  `"3 1/3"→3.333…`, `"½"→0.5`, `"1½"→1.5`, `"2-3"→2`, `"a pinch"→None`); `qty_text`
  populated; cue `"until golden"` → `"golden"`; label cases (`"Measure 3 1/3 cups
  flour…"` → `"Measure 3 1/3 cups"`; no trailing `or`/`in your`).
- `tests/test_schema.py`: `SavedRecipe` round-trips with and without `import_meta`.
- Web (Vitest): `formatQty`; Tier-0 copy selection for the three `sources` shapes;
  `hasUnattendedWork` derivation; `store.save` persists `import_meta`.

### 4.4 Investigation artefacts to persist (no new import)

| File | Content | Why |
|---|---|---|
| `tests/fixtures/import/pizza-dough.normalized.json` | the captured `NormalizedRecipe` (from `pizza.llm_calls.json`) | **Phase B deterministic replay gate** — real `build_graph()` input |
| `tests/fixtures/import/pizza-dough.raw.json` | the `RawAcquisition` (description, blog JSON-LD, manual transcript) | the `raw_source_text` that cue-grounding needs when replaying; also a future `@pytest.mark.llm` input like the other `*.raw.json` |
| `docs/investigations/pizza-dough-2026-09-15.telemetry.json` | `ImportTelemetry` + `violations_pre_repair` + cost | evidence for §2.2; not a test input |
| `docs/investigations/pizza-dough-2026-09-15.import_result.json` | the `ImportResult` (graph/plan/stages/provenance/warnings) of the re-run | baseline to diff Phase B output against |

No further paid import is needed to create these. `.env` values are never copied.

### 4.5 Derived files that regenerate (expected, not golden changes)

`packages/schema/*` via `make types` (`qty_text`, `ImportMeta`, `SavedRecipe`);
`apps/web/src/__fixtures__/*.plan-response.json` via
`apps/api/scripts/export_web_fixtures.py` (`qty_text: null` appears on every ingredient).

### 4.6 Golden fixtures — untouched

`tests/fixtures/*.graph.json` and `tests/fixtures/*.plan.json` are not modified. Adding an
optional field with a default keeps them loading unchanged; `test_schedule.py` compares
plans, which A does not touch.

### 4.7 Semantic graph behaviour changed: **no**

Dependencies, attention, durations, windows, stage assignment and `StageSpan` are
untouched. `doneness_cue` text is normalised (leading "until" removed) and `label` text
changes — both presentational fields.

### 4.8 Expected LLM/network cost: **zero.** All tests offline.

### 4.9 User-visible behaviour

Ingredients show `1 1/4 cups`, `3 1/3 cups`; cues read "until doubled in size"; labels no
longer end mid-phrase; Tier-0 says why; a degraded or estimated plan says so in one line;
the footer no longer denies unattended work; link-1-style videos import from creator
subtitles.

### 4.10 Report template (to be filled after implementation)

exact files changed · tests added/updated · derived files regenerated · golden fixtures
changed: yes/no · semantic graph behaviour changed: yes/no · expected LLM cost ·
user-visible behaviour · investigation artefacts retained.

---

## 5. Phase B — Graph correctness (planned, not approved for implementation)

### B1 — Fork/join edges (`graph.py:440-443`)

Replace the base chain with a join set. Keep `open: list[str]`, initially empty.

- Sequential step *k* (`depends_on_previous` honoured as `True`, or first step):
  `depends_on = list(open)`; `open = [k]`.
- Honoured-independent step *k*: `depends_on = list(nodes[k-1].depends_on)` — a *sibling*
  of the previous step: it may start when the previous step could start, never earlier;
  `open.append(k)`.
- Produces→consumer and freshness passes append as today.

Properties: strictly more constrained than today's `[]` (no parallelism is invented); a
chain of only sequential steps is byte-identical to today; the goldens' fork/join shape
(`homemade-donuts`: `heat_oil ← shape_and_cut`, `fry_donuts ← {proof, heat_oil}`) is
reproduced; edges only point backward, so no cycle can be introduced; the existing
independence test still asserts `preheat.depends_on == []` (because `chop.depends_on ==
[]`) and now also validates.

Known test impact (audit, simulated offline): `tests/test_extract_repair.py`
`_broken_two_branch_recipe` (chop / independent melt-butter / serve) relies on the
chain-break to be "broken" — under B1 it validates cleanly and ~9 tests feeding its
violations to `repair_or_degrade` would hit the `ValueError("no violations")` guard. The
fixture must be re-broken by a genuine violation (e.g. an unconsumed ingredient). Test
edit, not a golden. The `dal-makhni-multibranch` `@pytest.mark.llm` test's
`assert violations` still holds until B3; update its docstring premise. Freshness
interaction: the consumer's deps are now the open set, so a fresh sibling gains its
co-siblings as deps — more constrained, harmless.

Preserves `StageSpan` interleaving; stage assignment and order are not touched.

### B2 — Unattended final node (decision taken on existing evidence)

Relax invariant 9 to `attention == "unattended" ⇒ kind ∈ {passive, prep, finish}`:
`validate.py:_check_unattended_kind`; `COOKING_GRAPH.md` §5.9 text (with the rationale:
rules 3 + 9 + "last step is finish" are jointly unsatisfiable when the grounded final
instruction is unattended, e.g. "let cool slightly before serving"). Do **not** convert the
final node to `hands_on`. Regression coverage: a valid graph whose sink is
`kind=finish, attention=unattended` passes `validate()`; `build_linear_graph` output
always validates (new assertion), and `run_import` logs if a "guaranteed" graph does not.
Fix the `repair.py` docstring and the `test_failed_repair_degrades_to_tier1_linear`
comment. Scheduler: an unattended sink creates a window that is dropped empty (§4.3) — no
change. Goldens all have hands-on sinks — unaffected.

### B3 — Produces/consumes (re-evaluated after B1)

The earlier argument "the graph is linear so the edge is redundant" is retired. Post-B1 a
produces edge **can** be the only connector: siblings *k* (produces X) and *k+2*
(consumes X) with an unrelated sibling *k+1* between them — the two-condition test only
compares adjacent steps (`_verify_independence(previous, current)`), so *k+2* is honoured
as independent with `depends_on = [fork parent]`, and only the produces edge `k → k+2`
orders them. Therefore:

- **Rule (conditional relaxation):** an unconsumed `produces` may be dropped (with a
  warning, mirroring `force_linear`'s existing "drop, never invent") **only if every later
  node already depends transitively on the producer** — i.e. any produces edge that a
  repair could add would be redundant. Otherwise keep it, let invariant 6 fire, and let the
  repair pass earn its cost. Reachability is a cheap DFS over `depends_on`.
- **Schema-description fixes (zero-cost, ride in the JSON schema):**
  `NormalizedStep.consumes_ingredients` — "ingredient names, or a `produces_component`
  label from an earlier step when this step uses that component"; `produces_component` —
  "only when a later step names it in `consumes_ingredients`". Model compliance is
  **[unverifiable until re-run]**; the rule above is the deterministic backstop.
- **Regression tests:** (i) fork case above: producer/consumer siblings separated by an
  unrelated sibling → produces edge retained, consumer depends on producer, validates;
  (ii) same shape but the consumer never names X → produces retained (not dropped, since
  *k+2* does not depend on *k*) → invariant 6 fires; (iii) chain case: unconsumed produces
  dropped with warning, no violation.

### Phase B validation / replay gate

Replay `tests/fixtures/import/pizza-dough.normalized.json` (with
`pizza-dough.raw.json` as `raw_source_text`) through `build_graph()` + `validate()` +
`schedule()` + `stage_spans()` offline, and report: node count (expect 14); dependency
structure (expect a single chain — the captured recipe claims no independence, so B1 adds
no fork here; that is the honest expected result); validation (expect **zero** violations
after B2 + B3); tier (expect `clean`, since `run_import` would no longer call repair);
wait windows (expect 0 — no independent hands-on work exists in this capture); unattended
work (4 nodes); sink correctness (one sink, `finish`, unattended); produces/consumes
(six unconsumed produces dropped under the chain rule, one kept: `cold dough balls`).
A single paid live re-import being clean is **not** proof of correctness; the replay is.
Also run the full `make test` (golden scheduler fixtures, validate fixtures, repair tests).
The screenshot export (Phase 0) is a structural cross-check only.

**Files:** `graph.py`, `validate.py`, `repair.py` (docstring), `schema/normalized.py`
(descriptions only), `docs/COOKING_GRAPH.md` §5, `tests/test_extract_graph.py`,
`tests/test_extract_validate.py`, `tests/test_extract_repair.py` (fixture re-broken),
`tests/test_import_llm_transcript.py` (docstring), new `tests/test_extract_replay.py`.
**Derived files:** `packages/schema` regenerates (description strings). **Goldens:**
untouched. **Semantic changes:** yes — edge construction for honoured-independent steps,
invariant 9, produces handling. **Cost:** zero for implementation and gate; an optional
single re-import (~₹2) only as a sanity check, never as the acceptance criterion.

---

## 6. Phase C — Presentation (planned; separate from graph semantics)

1. **Hands-on vs unattended duration display.** `StageCard.tsx:TaskRow` shows the
   attention caption the Map already uses (`map/layout.ts:103-105`): "hands off" / "check
   now and then", and formats long waits (`4 hr 30 min`) via a shared
   `lib/duration.ts:formatMinutes` (moved from `map/layout.ts`). Additive rollup fields
   `StageSpan.hands_on_min` / `unattended_min` (`schedule/rollup.py`, pure, from
   `Node.attention`) so the header can read `~34 min hands-on · 4 hr 30 waiting` without
   frontend arithmetic. `DESIGN_SYSTEM.md:741` updated. `tests/test_rollup.py` gains
   assertions. `StageSpan` is not in `CookingPlan`, so `*.plan.json` goldens are untouched;
   web `__fixtures__` regenerate.
2. **Inferred/typical duration provenance.** With A6's `provenance` on the client: for a
   window host whose `duration` provenance is `inferred`, render the cue as the primary
   line and the minutes as `~10 min`; Cooking Mode will read "Preheat oven to 550°F — until
   fully preheated (~10 min)". No change to durations, the low-end clamp, or the prompt —
   the contract's allowance for plausible typicals on vague-but-present text stands.
3. **`HowToSection`-derived stage names.** `NormalizedStep.section: str | None = None`
   ("the source's own section heading for this step when the source has sections; null
   otherwise; never invent one"); one prompt sentence; `graph.py`: when all (or all but a
   leading/trailing few) steps carry a `section`, stage id = slug, label = heading with
   trailing colon stripped and a leading "How to " removed ("Make Pizza Dough", "Form a
   Pizza Crust"), ordered by first appearance; otherwise the current kind-based assignment
   unchanged. **Stage order and `StageSpan` overlap semantics are not changed.** Sections
   happen to make blog-backed imports contiguous, which addresses the interleave
   observation without touching `rollup.py`. Verification needs 1–2 live imports (~₹2–4)
   to confirm the model fills the field.
4. **Stage pill wording/rollup.** Copy review of the collapsed `N free` / `~N min` pair
   against the new fields; no semantic change.

**Files:** `StageCard.tsx`, `derive.ts`, `lib/duration.ts`, `map/layout.ts`,
`schedule/rollup.py`, `schema/plan.py`, `schema/normalized.py`, `graph.py`,
`prompts/v2.md` (or a `v3.md`), `DESIGN_SYSTEM.md`, `tests/test_rollup.py`,
`tests/test_extract_graph.py`. **Goldens:** untouched. **Cost:** zero except item 3's
verification.

---

## 7. ASR decision (not implemented)

**The M4 evaluation harness does not exist in the repository [verified].**
`apps/api/scripts/` holds only `export_schema.py` and `export_web_fixtures.py`;
`ROADMAP.md:142` and `M2.9 §8.3` describe it as future work. The only real-pipeline tests
are `@pytest.mark.llm` over four frozen `RawAcquisition` fixtures.

**Proposal:** `apps/api/scripts/eval_acquisition.py` — for a list of URLs run `acquire()`
only and tabulate: caption kind/lang or none; recipe-blog JSON-LD with instructions or
not; a description-method heuristic (≥ 3 imperative or numbered lines); chapters. Report
"% with any method text", "% captions-only", "% nothing anywhere". Network only, no LLM.
Sample 30–50 videos across Indian and Western channels, professional and home creators,
with and without linked blogs. Also log `ImportResult.sources` from production imports.
Only if "nothing anywhere" is material (≥ ~15%) does paid ASR earn its per-audio-minute
cost (verify current rates) and its operational risk: `M2.9 §4.4` recorded
`youtube-transcript-api` being blocked from cloud IP ranges; whether yt-dlp *audio*
downloads from Cloud Run hit the same wall is **[unverified]**. Link 2 is one data point,
not a rate.

---

## 8. Future proposals (assessed only; not implemented)

**A. Tier-0 recovery — paste recipe / add recipe URL [proposal].** High value: turns an
honest refusal into a plan when the user has the recipe elsewhere, user-driven rather than
ReciMe-style scraping. Reuses the pipeline: `run_import(url, adapter, acquire_fn=…)`
already injects acquisition; pasted text → `RawAcquisition(source_url="pasted",
description=<text>)`; a pasted URL → `blog.fetch_recipe` directly. `SourceRef.kind`
already models pasted text. One request field on `POST /import`, one route branch, a text
area on `NotGroundedResult`. One normal import call.

**B. Start-time calculation [proposal].** Deterministic: start = target −
`plan.total_min`, plus *attendance blocks* (contiguous `occupies_cook` runs in
`plan.scheduled`) as wall-clock times — "Fri 7:34 PM mix · Sat 12:10 AM shape and
refrigerate · Sat 6:10 PM take dough out · Sat 7:10 PM preheat". Pure function beside the
scheduler (`schedule/wallclock.py`, takes the plan and a target datetime, no clock reads)
so every number still originates server-side.

**C. Model-written labels [proposal].** `NormalizedStep.label` (≤ 4 words) with
`_label` as fallback; ~5 output tokens per step.

**G4. Deterministic preheat independence [owner decision / future experiment].**
`COOKING_GRAPH.md` §6 already states "preheating the oven is an unattended node with no
dependencies". A construction rule (verified `unattended`, grounded cue containing
"preheat", no consumes/produces → sibling of the previous step under B1) would enforce it
without trusting the model, but it asserts a parallelism the source did not literally
state. Not implemented; requires B1 first; to be trialled on the eval sample.

**Stage interleave for imports [recorded, no change].** `_stage_for` assigns stage by
kind, so imported Prep/Cook stages interleave on the Plan tab (screenshot: "Cover bowl
with plastic · 270 min" listed before "Measure flour"). `StageSpan` intentionally supports
overlap; the chronology is correct on the Map and will be correct in Cooking Mode
(driven by `plan.scheduled`). Phase C item 3 makes blog-backed imports contiguous as a
side effect. Any further change is a product decision.

---

## 9. Start Cooking — architectural implications (product direction only)

1. Drive Cooking Mode from `plan.scheduled` in start order — never from stages or
   `plan.windows`. Dropped empty windows (§4.3) are exactly the "REST FOR 1 HOUR [timer]"
   cards: a hands-off `ScheduledNode` (`occupies_cook=false`) must yield a timer card even
   when no window survived.
2. "While you wait" has two sources: `WaitWindow.assigned` (hands-on tasks the scheduler
   placed inside the host) and *concurrent unattended siblings* whose interval overlaps
   the host (e.g. preheat alongside the rest). Only the first exists as data; the second is
   an interval overlap over `scheduled` — computed in `derive.ts` (comparisons, not sums)
   or emitted by `rollup.py` as a sidecar, never added to `CookingPlan` (would rewrite
   goldens).
3. Render `Node.instruction`, never `label`. Labels stay on the Plan tab.
4. Timers store the absolute wall-clock end (CLAUDE.md). `duration_typical` seeds them;
   for inferred-duration hosts the doneness cue is the completion condition and the timer
   is advisory — so provenance must reach the client (A6).
5. Session state (current node, done set, timer ends) → Zustand `persist` keyed by
   `SavedRecipe.id` (`library/store.ts` was built to become that storage).
6. Node granularity is the model's (14 vs 19 nodes across two runs). One card per node,
   with a "next up" peek; tolerate both.
7. Stage interleaving is irrelevant to Cooking Mode.

---

## 10. Do-not-implement list (this plan)

Start Cooking · ASR · paste-recipe / URL recovery · start-time calculation · automatic
deterministic preheat independence (G4) · any golden-fixture edit · any prompt instruction
that restates what `v2.md` already says.

## 11. What cannot be verified from the repository or the re-run

- The screenshot run's **tier**, and whether it ever hit pre-repair violations that a
  repair/degrade pass resolved — the graph itself and its (zero) `validate()` violations
  are now known (§3), but tier is not stored in `RecipePlanResponse` and there is no
  pre-repair snapshot. Its `NormalizedRecipe` remains unrecoverable, so it's also unknown
  whether that run's model ever claimed independence and had it dropped, or never claimed
  it at all (§3.3).
- Why the model returned `depends_on_previous=True` for the preheat and peel steps.
- Whether schema-description changes (B3) or a `section` field (C3) change model
  behaviour — requires live re-runs.
- ReciMe's internals.
- The true preheat time for a 550°F stone (not in the source; the source says "a few
  minutes").
- Whether yt-dlp audio downloads from Cloud Run are bot-walled.
- goo.gl → jamieoliver.com 404 was true on 2026-09-15.
