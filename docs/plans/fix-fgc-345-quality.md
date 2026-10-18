# FGC-3/4/5 quality fixes before R3 (plan)

Worktree `C:\Users\ashya\Music\abc-cook-fgc345`. PR 1 branch `fix/fgc-4-5-postprocess`; PR 2 branch
`feat/fgc-3-added-steps`. Owner decision for FGC-3: `docs/plans/decisions-2026-10-16-incomplete-method.md`.

## Owner amendments (2026-10-18)

Where this section conflicts with the plan body below, this section wins.

1. **FGC-5 = option (d).** The derived "Wait before serving" node is **source-stated, not added**:
   - its duration is `extracted` from the source's number;
   - it gets **no** "Added by ABC Cook" label;
   - its label and instruction copy are proposed at STOP A1, generic and built from the lead
     step's text.
2. **PR 1 has no user for `origin`, so it moves to PR 2.** That covers `NodeProvenance.origin`,
   the web label plumbing (`derive.ts`, `StageCard`, `WaitWindowBlock`, cooking mode, `copy.ts`)
   and their tests.
   - PR 1 = graph.py (FGC-4 P + FGC-5 d) + tests + fixtures + PPV 12.
   - The 390 px screenshots of the kadhi Plan and of cooking mode on the wait step stay at
     STOP A1.
3. **D3 rule 2 (cupcakes):** passes when, in ≥ 2/3 B runs, added hands-on step(s) precede Bake and
   consume the batter's raw ingredients: butter/sugar plus at least one of flour/egg/milk. The gap
   metric is reported per run but does not gate.
4. **D3 rule 3:** a stated duration in B outside A's spread passes if it is grounded in the source.
   List each one at STOP A2; only ungrounded ones fail.
5. **Q6 (map view):** before PR 2's code, check whether the map view (`apps/web/src/map/`) is
   reachable by users.
   - If reachable, label added steps there in PR 2.
   - If it is dead code, keep FGC-30 as a follow-up and say so in this plan.
6. **Chole n=1 (B) is mandatory**, not optional. The cap stays ₹20 hard.
7. **FGC-4 markers:** at STOP A1, scan every import fixture and investigation text for hits of the
   new markers, and list every step whose role changes, not only the goldens.
8. **Other answers:**
   - Q3 yes: Tier 0 is enforced in code;
   - Q4 yes: a croissant preheat is a pre-registered acceptable addition;
   - Q5: no cap, plus FGC-34;
   - Q7: label while streaming;
   - Q8: option (ii), a second fill call, is rejected.
9. **Before PR 2 starts in the same worktree:**
   - `gh pr view fix/fgc-4-5-postprocess --json state` must say `MERGED`;
   - then `git fetch` and branch from the new `origin/main`.

## PR 2 outcome (2026-10-18)

- **Q6 (map view):** `apps/web/src/map/` is not reachable (nothing imports it outside itself), so FGC-30
  stays a follow-up.
- **A/B (28 calls, INR 14.88):** v8 added 0 steps in 15 B runs, so D3 rule 2 failed (0/3 on cupcakes) and
  rule 5 failed (kadhi repair-would-fire 2/3 vs 0/3; edge agreement). Decision: ship the infrastructure
  with `ABC_COOK_ADDED_STEPS` default OFF; no cupcakes golden. See FGC-3, FGC-4, FGC-39, FGC-40, FGC-41
  in `followup-golden-corpus.md` and `notes/fgc-345/summary.md`.

---

Read from `origin/main` @ ee5f63f (fetched 2026-10-18, PR #66 S3 merged; `POSTPROCESS_VERSION = 11`).
Diagnosis written in plan mode: no code, no LLM spend. The ₹0 in-memory probes ran `reprocess()`
on a `git archive` of origin/main in a scratch directory outside the repo.

## Context

The widened corpus found three P2 quality gaps (`docs/plans/followup-golden-corpus.md`):
- **FGC-3:** an incomplete method is shown as a complete plan. Cupcakes have Bake but no batter step.
- **FGC-4:** notes and alternatives become scheduled steps.
- **FGC-5:** "10 minutes before serving" is not honoured. Kadhi's pakoras sit for 3 minutes, not 10.

The owner decided FGC-3 = (b): fill the gaps, labelled. Quality is the floor, then speed, then cost.
Every fix is generic.

---

## Step A — Diagnosis

### A1. FGC-3 (vanilla cupcakes, `known-wrong/vanilla-cupcakes.original.json`)

**Raw model output** (4 steps; repair did not fire, `repair: null`, so post-repair = raw):

| # | text | model fields |
|---|---|---|
| 0 | "Powdering the sugar will make the creaming easy." | hands_on, 1/2/4, required, consumes Sugar |
| 1 | "Preheat the oven (preheat for 10 minutes) at 180 C." | unattended, 9/10/11 stated |
| 2 | "Bake it in a preheated oven at 180 C for about 20-25 minutes." | unattended, 20/22.5/25 stated, **consumes all 9 ingredients** |
| 3 | "Butter can be replaced with 1/2 cup vegetable oil." | role=alternative, cue = the whole sentence, `attach_to_step` null, 0/0/0 |

The model's own `notes` say it knew: *"Method in the source is minimal… I did not invent
mixing/creaming steps."* It obeyed `v7.md:10-13` ("never invent") and `:63-67` (no invented
method).

**After `reprocess()`** (probe):
- nodes: Powder sugar (active) → Preheat (10/10/11, extracted) → Bake (20/22/25, extracted; depends
  on Preheat and on Powder sugar through the shared sugar) → "Use oil instead" (finish, sink, after
  Bake);
- `review_recommended=True`;
- no invariant fails. Invariant 5 holds only because the model put every ingredient on Bake.

**Where a gap can be detected**
- **Model:** yes. It recognised the gap and wrote so in `notes`, which code never reads.
- **Postprocess, deterministic:** probe rule = "an unattended node consumes ≥ 2 non-staple raw
  ingredients that no hands-on ancestor touched".
  - Fires on cupcakes (Bake: flour, soda, powder, egg, milk, vanilla).
  - Silent on kadhi, croissant, pumpkin, and 7 of 8 static graphs.
  - One false positive: `synthetic-two-windows` "simmer stew" (lentils + stock into the pot). Real
    "add and simmer" recipes look like this.
  - So it can serve as a flag or a metric, not as a filler or a gate.
- **Graph invariants (`validate.py`):** none can see it.

**Existing provenance to reuse**
- `NodeProvenance.fields` (`schema/normalized.py:318-326`) is per field: attention / duration /
  depends_on_previous ∈ extracted | inferred | defaulted.
- It is computed by `provenance.py:30-40` from `NodeDecision`. It is a sibling record, not on
  `Node`, so goldens and `CookingGraph` stay byte-identical.
- It has no node-level "this step is not in the source" field.
- `duration = "inferred"` already renders as an estimate:
  - `StageCard.tsx` `taskDurationText`: hands-on `~N min`, otherwise `about N min`;
  - `derive.ts:213`.
- **Reuse:** `inferred` for added-step durations. **Add:** a node-level `origin` on
  `NodeProvenance`.

### A2. FGC-4 (notes and alternatives)

**The grounding today** (`graph.py`):
- `_OPTIONAL_MARKERS` (`:59-67`) = `if you, if desired, optional, alternatively, instead, or you
  can, method:`.
- `_role_honored` (`:462-465`) needs a marker in the cue **and** the cue grounded in the corpus.
- `_cue_is_own` (`:468-474`) needs the cue to be an **exact substring of the step's own text**.
  Otherwise the borrowed-cue rule (`:477-501`) needs `attach_to_step` → an already-honoured step.

**Why each case misses**
- **Cupcakes step 3:** the cue "Butter can be replaced with…" has no marker. It is kept required
  (warning `:552-557`).
- **Pumpkin step 5:** the cue "There is two different ways to eat these pancakes." has no marker.
  - Probe with the marker added: it then fails as **borrowed**, because the model's step text says
    "There **are** two…".
  - A light normalisation breaks the exact-substring own-cue check.
- **Pumpkin step 6:** the cue "But, then you have to try it my favorite way…" has no marker and low
  overlap with the step text.
  - The corpus *does* contain "Or you can use chocolate syrup" (a marker); the model quoted a
    different phrase.
  - A postprocess change can't fix this; it needs the prompt.

**Downstream when it fails**
- The step stays a required node. The last required step is forced to `kind="finish"` (`:1573`).
- Cupcakes: the note shares butter with Bake → a dependency is added → it becomes the sink after
  Bake.
- Pumpkin: step 5 dangles and is joined into the sink, so "Serve with chips" depends on
  "Serve classic" (the chain).

**A place for the note already exists**
- An honoured optional/alternative step becomes `"Alternative: …"` / `"Optional: …"` in the attach
  target's `Node.tip` (`:1678-1687`). The Plan renders it as "Tip:" (`StageCard.tsx` TaskRow).
- An ingredient used only by such a note is marked `optional` (`:1850-1865`), so invariant 5 is
  safe.
- `NormalizedRecipe.notes` (`:312-315`) is reviewer-only and must not be used for this.

**Repair / FGC-29 interaction**
- Demoting a note removes a node; it adds no violation kind.
- Neither failing step carries `produces_component`, so FGC-29 is not involved.

**Probe of the postprocess-only fix:**

| Recipe | Change | Result |
|---|---|---|
| Cupcakes | markers + `can be replaced` | note → tip on Bake ("Alternative: Butter can be replaced with 1/2 cup vegetable oil."), vegetable oil optional, 3 nodes |
| Pumpkin | + `different ways` + own-cue by token coverage ≥ 0.8 | step 5 → tip on Cook pancakes, 6 nodes, total 24→23; step 6 still required |
| Kadhi, croissant | same | unchanged |

**Verdict:** cupcakes and pumpkin step 5 are fixable in postprocess. Pumpkin step 6 needs the prompt.

### A3. FGC-5 (kadhi), full trace

1. **Source:** "10 minutes before serving add pakora to piping hot kadi."
   (`kadhi-pakora.original.json` `source_text`).
2. **Extraction:** step 8 = "**Ten** minutes before serving, add the fried pakoras to the piping
   hot kadi."
   - hands_on, 0.5/1/3, `duration_stated=false`, burner. The model rewrote the digits as a word.
   - The model behaved correctly: 10 min is not this step's duration.
3. **Parse:** "Ten" *is* parsed (`_NUMBER_WORDS` one–twelve, `graph.py:621-624`).
   - Probe: `_duration_role` → `lead`, because of `before` (`_LEAD_TIME_MARKERS`, `:644`;
     `:736-737`). The same holds for the source's "10 minutes before".
4. **Where the 10 min is lost: `graph.py` `_verify_duration`.**
   - On a hands-on step, `_grounded_duration_expressions(allow_lead=False)` (`:838-840`) and the
     `usable` filter (`:874-878`) drop the lead. This is by design (fix-offset-not-duration §2 row 4).
   - The phrase is not recorded anywhere, and no warning is emitted because the model claimed
     unstated.
   - Nothing downstream could hold it anyway:
     - `NormalizedStep` and `Node` have no minimum-gap field;
     - `Node.max_lead_min` (`node.py:57-60`) is the opposite, a freshness **ceiling**
       (`scheduler.py:254-271`, `safety.py:59-81`).
5. **Schedule** (`kadhi-pakora.replay-expected.json`):
   - Add pakoras 50–51, Make tempering 51–53, Serve 53;
   - total 54, one window (Cook kadi hosts the batter).
6. **Other lead phrases on hands-on steps** (scan of every import fixture's step texts):
   - only kadhi step 8;
   - `pizza-dough` step 6 "Remove the dough 1 hour before using" is a lead on a verified
     **unattended** step and stays stated 60;
   - the static `*.graph.json` fixtures have none.

---

## Step B — Options

### FGC-3

| | Quality | First ingredient (≤ 15 s typ / ≤ 20 s worst; today 12–20 s at low, strict on) | Cost | Risk |
|---|---|---|---|---|
| **(i) Prompt adds and marks steps in the same call** (v8 + `origin` field) | Best context: the model saw the whole source. Fills only when it judges a gap. | Ingredients stream before steps, so prefill is +~0.4K tokens (negligible). Unknown: low-effort reasoning may lengthen first-content silence; **measured**. Steps-complete +~0.5–1 s (one enum per step plus the added steps). | +~₹0.01–0.03/call | False positives on complete recipes; an added step stating a wrong time or temperature. Both are guarded deterministically (below) and measured. |
| (ii) Separate fill call only when a gap is detected | Depends on the detector's recall, which is narrow (A1). | First ingredient unchanged; plan-ready +10–25 s on gap recipes. | +₹0.3–0.5 on those imports | Breaks "one LLM call per import" (CLAUDE.md). Needs a second prompt and parser. |
| (iii) Deterministic flag, no fill | Honest but doesn't meet decision (b). False positive on "add and simmer" shapes. | 0 | 0 | Low |

**Recommend (i), with (iii) kept as a bench metric and backstop log line, not user copy.**

**Provenance shape, end to end (for (i))**

1. **Schema** `NormalizedStep.origin: Literal["source", "added"] = "source"`.
   - It is the **first** key, before `text`, so the streamed draft knows before the text closes.
   - Its description is model-facing; exact text in D1.
   - Old originals parse as `source`.
2. **Strict schema:** +1 required enum per step (`strict_json_schema` picks it up unchanged).
3. **Kill switch** `ABC_COOK_ADDED_STEPS` (unset = on; `0`/`false`/`off` = off), next to the strict
   switch in `base.py`. When off:
   - the prompt is v7;
   - the `origin` property is removed from both the pasted and the strict schema;
   - the request is byte-identical to today, tested against `tests/fixtures/request/before-*.json`.
4. **`normalize.py:435` Tier 0 gate** becomes `any(s.origin == "source" for s in steps)`. An
   all-added recipe is Tier 0 with the added steps discarded, so (b) can never write a whole
   method.
5. **`graph.py` added-step rules** (generic):
   - attention is forced to `hands_on`: an added step never hosts a wait window or creates
     parallelism;
   - `duration_stated` is forced false, so provenance is `inferred` (or `defaulted`);
   - a non-required added step is dropped;
   - an added step whose own text has a duration or **temperature** phrase not grounded in the
     source (same value, same unit system) is dropped, with a warning and review;
   - an added step's `produces_component` that no later step consumes is dropped (avoids an
     unwinnable FGC-29 repair);
   - this needs a new small `_TEMPERATURE_RE` (°C/°F/degrees/C/F, gas mark, Hindi "डिग्री").
6. **`NodeDecision.added` → `provenance.py` → `NodeProvenance.origin`.** `Node` is unchanged.
7. **Persistence:**
   - `ImportOriginal.recipe` stores `origin`, so `/reprocess` and staleness re-derive everything;
   - `SavedRecipe` carries it through `ImportMeta.provenance`. No migration is needed.
8. **Draft** (`draft.py`): the scanner reads `origin` when it precedes `text`, and `steps` become
   `{text, added}`.
   - If `origin` is missing or comes after `text`, the step is held until its object closes. It is
     never shown unlabelled.
   - The job-poll payload shape changes (`make types`).
9. **Web** (`make types` regenerates `packages/schema`):
   - `plan/derive.ts` (`RenderTask.added`), `plan/StageCard.tsx` TaskRow, `plan/WaitWindowBlock.tsx`;
   - `cooking/types.ts` and `cooking/model.ts`, plus provenance threaded through
     `cooking-mode/startCooking.ts`;
   - `cooking-mode/viewModel.ts`, `CookingShell.tsx`, `copy.ts`;
   - `import/draftView.ts`, `ImportDraft.tsx`.
10. **Copy:** "Added by ABC Cook, not in the video" for a YouTube/Instagram source, "…not in the
    recipe" for a blog or text.
    - Shown as a 13 px `home-ink-2` line under the instruction, above "Tip:", in the existing text
      style. It is not a new visual grammar, but it is still rendered at 390 px for the checkpoint.
    - Its time uses the existing estimate rendering (`~N min` hands-on). It never shows as plain
      `N min`.

### FGC-4

| Option | Fixes | Risk |
|---|---|---|
| P: postprocess markers + own-cue token coverage (≥ 0.8 of ≥ 3 `\w+` tokens, so Devanagari works) | cupcakes; pumpkin step 5 | A demotion still needs the **model** to mark the step non-required, so only a double error demotes a real step |
| M: v8 prompt rule (a substitution is `alternative`, attached to the step using the ingredient; several serving ways are `optional`, sharing the introducing cue, the later ones attached to the first) | pumpkin step 6; better attach targets | Model-facing; measured with FGC-3 |
| S: a new schema slot for notes | none beyond Node.tip | Unneeded: `Node.tip` already renders |

- **Recommend P (PR 1) + M (PR 2).**
- P's markers:
  - `can be replaced`, `replaced with`, `replace with`, `substitute`, `in place of`;
  - `different ways`, `another way`, `ways to eat`, `ways to serve`;
  - Hindi/Hinglish `की जगह`, `ki jagah`, `चाहें तो`, `chahe to`.
- Excluded on purpose: `note:` / `tip:`. A "Note: soak overnight" demoted to a tip would drop a
  required wait.
- Where notes appear: as the existing "Tip:" line on the attached step (Plan today; cooking mode
  already carries `tip`). No new UI.

### FGC-5 (product decision F1; options, not assumed)

| | What the cook sees | Scheduler / schema | Wrong-advice risk | Goldens |
|---|---|---|---|---|
| **(d) graph.py inserts a stated wait node** when a **hands-on** step's lead phrase is anchored to serving (closed list: `before serving / you serve / eating`; Hindi `परोसने से N पहले`, `serve karne se N pehle`) | An existing grammar: "Wait before serving · 10 min" (unattended, timer). Its window hosts what can happen meanwhile (kadhi: the tempering). Labelled with the origin line. | None (graph.py only). Duration `extracted` (the source's number); node origin = added. | Low. The anchor is a closed list; "2 min before the end" stays dropped. Worst case: a wait the source asked for. | kadhi: +1 node, Serve ~53→~61, total 54→~62, new window. Others: none. |
| (a) new `Node.min_lead_min` (a minimum gap to the sink) + scheduler gap events | An idle gap with no node. Cooking mode has nothing to time and needs new UI (new grammar → render checkpoint). | Schema + scheduler (`ready()` gated on `end+gap`; gap expiry as an event) + `make types` + web | Low on the schedule; medium in the UI (an unexplained idle gap) | kadhi same total; static fixtures unchanged |
| (b) keep the schedule, show the lead as text | The instruction already says "Ten minutes before serving" while the timeline serves 3 min later. That contradiction is today's bug. | None | **Remains** (the plan contradicts the text) | none |
| (c) a + b | as (a) | as (a) | as (a) | as (a) |

**Recommend (d).** It honours the source's number, needs no schema or scheduler change, and reuses
the timed wait and "meanwhile" grammar the product is built on. It is still the owner's call (Q1).

---

## Step C — Recommendation and PR split

**Two PRs.**

**PR 1, `fix/fgc-4-5-postprocess` (₹0, deterministic):**
- FGC-4 P;
- FGC-5 (as decided);
- `NodeProvenance.origin` + web label plumbing (`derive.ts`, `StageCard`, `WaitWindowBlock`,
  cooking mode, `copy.ts`), first used by FGC-5(d)'s derived wait node;
- `POSTPROCESS_VERSION` 11 → 12.

Why first: its golden diffs are reviewable without model noise, and both arms of PR 2's A/B then
run on the same postprocess, so the measured difference is the prompt and schema alone.

**PR 2, `feat/fgc-3-added-steps` (model-facing, ₹):**
- FGC-3 (i): v8 prompt, the `origin` field, the kill switch;
- the graph.py added-step rules and the Tier 0 rule;
- the draft scanner and draft and cooking labels;
- FGC-4 M;
- `POSTPROCESS_VERSION` 12 → 13; `PipelineFingerprint` gets `extraction_added_steps: bool`;
- the cupcakes golden.

**FGC-27: not bundled.**
- Separating it would need a third arm (+~₹7).
- Removing the 3K-token pasted schema could shift every behaviour, including the added-step false
  positives this PR must measure.
- v8 = FGC-3/4 deltas only; FGC-27 becomes v9.

**Vanilla-cupcakes becomes a golden after PR 2:**
- one owner-chosen v8 capture is frozen as `vanilla-cupcakes.{raw,original,replay-expected}.json`;
- named assertions: an added step that uses the butter/sugar precedes Bake; Bake stays 20–25,
  `extracted`; no added step states an ungrounded time or temperature; the oil substitution is a
  tip, not a node;
- the v7 capture stays in `known-wrong/` as evidence (README updated).

---

## Step D — Measurement plan (PR 2; same rules as S3)

**D1. Byte changes**
1. **`prompts/v8.md`** = `v7.md` plus:
   - the header "(v7)" → "(v8)";
   - one sentence after `:13` naming `origin="added"` as the sole, always-labelled exception to
     "never invent";
   - a new section after `:73`, "Steps the source skips — `origin`" (~180 words):
     - only with `method_grounded=true` and ≥ 1 source step; the Tier 0 rule `:63-67` wins;
     - only a step the dish cannot be made without (a stated step uses something no earlier step
       makes);
     - never change, replace or reorder a source step;
     - no time or temperature unless it repeats the source's own value and units;
     - `duration_stated=false`, `hands_on`, `required`;
     - no garnish or serving extras; if unsure, don't add;
   - two bullets after `:110` (FGC-4 M).
2. **`NormalizedStep.origin`** (first key) with a description in the same wording.
3. **`_PROMPT_PATH`** becomes switch-aware.
4. **Request:** only `messages[0].content` and `response_format.json_schema.schema` change.

**Dumps** (`scripts/dump_extraction_request.py`, `notes/fgc-345/request-dumps/`):
- `before-*` (origin/main) vs `after-off-*` for stream × strict, 4 combos: **empty diff**;
- `after-off` vs `after-on`: the prompt diff (v7→v8 + the schema field) and the strict-schema diff
  (the `origin` property + `required`). Nothing else.

**D2. Arms**
- A = switch off (v7, production today); B = on.
- Effort `low`, strict on, frozen raws only (no YouTube), repair key invalid (repair-would-fire
  recorded), via `scripts/strict_bench.py`.

**D3. Decision rule (written now, before any run).** B ships default **on** only if ALL hold:
1. **False positives:** 0 added steps on kadhi and pumpkin across B's n=3.
   - Croissant: only an added *preheat* is acceptable (the FGC-7 gap, pre-registered; Q4); any
     other added step is a false positive.
   - Each added step on a golden is listed verbatim at STOP A.
2. **Cupcakes:** in ≥ 2/3 B runs, an added hands-on step consuming butter or sugar precedes Bake
   and the gap metric no longer fires; and it fires in A (the baseline).
3. **No contradiction:**
   - 0 added steps with an ungrounded time or temperature **reach the plan** in any run (guard drops
     counted separately);
   - 0 stated-floor violations;
   - the stated-duration multiset per golden in B lies within A's own spread.
4. **Ingredients-only safety:** `partial-ingredients-only` (veg biryani, Hindi) stays Tier 0 in all
   runs, with the model's added steps (if any) counted.
5. **No regression:**
   - no tier regression;
   - repair-would-fire B ≤ A per recipe;
   - edge agreement cross A×B mean ≥ within-A mean − 0.05 (S3 matcher).
6. **Speed:** first-ingredient median B − A ≤ 2 s per recipe. Steps-complete and done are reported
   side by side.

Otherwise default **off** (keep the code and the switch); log FGC-30 with the evidence.

**D4. Recorded per call** (S3 set): the milestones, max silence and max inter-delta gap, the tokens,
₹, tier, repair-would-fire, and the edge recall/precision vs golden.

Strict "must choose" counts per arm:
- `origin="added"`;
- `role ≠ required`;
- `depends_on_previous=false`;
- `servings_source="stated"`.

Every comparison number names its call id and file (`notes/fgc-345/calls/<id>.json`, the ledger).

**D5. Goldens: expected changes listed in advance.** Each needs owner approval with a per-field
diff; regenerate only via `regen_corpus_expected.py`.
- **PR 1:**
  - kadhi: per FGC-5's choice; under (d), +wait node, Serve start, totals, window; FGC-5 leaves
    `known_issues`;
  - pumpkin: "Serve classic" → tip, total 24→23, FGC-4 stays (step 6);
  - croissant, pizza, dal, the static graphs, the 11 web fixtures: none, except
    `apps/web/src/__fixtures__/{kadhi-pakora,pumpkin-pancakes}.plan-response.json`.
- **PR 2:**
  - the goldens replay frozen originals, so **no change** (no `origin` key → `source`);
  - the new cupcakes golden.
- **Versions:**
  - PPV 12 (PR 1) and 13 (PR 2), each appended to `postprocess_versions.json`; old entries are
    never edited;
  - `PipelineFingerprint` field in PR 2.

**D6. Watchdog:** report the largest silence. If > 20 s, revisit `STREAM_IDLE_TIMEOUT_S` (guard is
3 × 19.3 s).

**D7. Repair check:**
- No new `validate` rule; the added-step guards drop in graph.py and never reach repair.
- The bench counts repair-would-fire whose violated rule involves an added node. Any > 0 is shown at
  STOP A with the rule; `produces_consumed` is pre-empted by the label drop.

**D8. Budget.** ₹/call from S3:
- croissant 0.70, kadhi 0.80, pumpkin 0.50;
- cupcakes ~0.45 and partial ~0.35 (estimated).

| recipe | A n | B n | ₹ |
|---|---|---|---|
| cupcakes | 3 | 3 | 2.7 |
| kadhi | 3 | 3 | 4.8 |
| croissant | 3 | 3 | 4.2 |
| pumpkin | 3 | 3 | 3.0 |
| partial-ingredients-only | 1 | 2 | 1.05 |
| **mandatory** | | | **≈ 15.8 (27 calls)** |
| chole (Hindi FP, silence; A ref = S3 row 4) | – | 1 | 1.7 optional |

**Hard cap ₹20** (Budget reserve ₹2.8/call). Stop at the first auth, infra or 4xx failure and report
spend. A ₹0 dry run with both keys invalid prints the run list first.

---

## Step E — Plan doc and execution

### Setup (one session, then STOP)

1. `git fetch origin`, then
   `git worktree add -b fix/fgc-4-5-postprocess C:\Users\ashya\Music\abc-cook-fgc345 origin/main`.
2. Write this plan to `docs/plans/fix-fgc-345-quality.md` (Write tool), with an empty "Owner
   amendments" section at the top that wins over the body.
3. Write the owner decision verbatim to `docs/plans/decisions-2026-10-16-incomplete-method.md`.
4. Edit `followup-golden-corpus.md`:
   - FGC-3: decision (b), owned by this plan;
   - FGC-4 and FGC-5: owned (PR 1 / PR 2);
   - FGC-27: "not bundled, becomes v9";
   - add FGC-30+.
5. Mojibake grep (`Ã|â€|Â`, U+FFFD).
6. One commit, `docs(plans): FGC-3/4/5 plan; owner decision on incomplete methods`. **STOP** (no
   code, no push, no spend).

### PR 1 (test-first, ₹0)

1. `test:` failing synthetic tests in `test_extract_graph.py`, no recipe names.
   - FGC-4:
     - substitution cue honoured → tip on target, ingredient optional;
     - "different ways to serve" honoured;
     - token-coverage own-cue ("There is" vs "There are");
     - Hindi substitution markers;
     - existing borrowed-cue tests unchanged.
   - FGC-5(d):
     - English and Hindi anchored leads → stated wait node before the sink;
     - unanchored "2 min before the end" → unchanged;
     - an unattended lead (pizza shape) → unchanged;
     - a lead on the sink itself → nothing.
   - Provenance:
     - `origin` on the derived node;
     - old provenance without `origin` → `source`.
   - Web Vitest:
     - `derive` (`added`);
     - the copy helper (video vs recipe).
2. `fix(extract):` graph.py, provenance.py, schema (`NodeProvenance.origin`), `make types`
   (absolute PYTHONPATH; restore CRLF-only rewrites with `git checkout`).
3. `feat(web):` the labels (StageCard, WaitWindowBlock, cooking mode).
4. `chore(cache):` PPV 12 + history entry.

Then:
- the ₹0 suite `-m "not llm and not network"`;
- ruff on changed files; `mypy --strict` on schema/schedule;
- `tsc`, Vitest.

**HARD STOP A1:**
- the full before → after diff of every golden and web fixture vs D5;
- the kadhi plan as the cook sees it;
- a **390 px screenshot** of the kadhi Plan (wait node, label, window) and of cooking mode on the
  wait step, from a local dev server (not port 9222; check for Dark Reader inversion);
- the warnings diff.

No expected file is touched before approval.

**HARD STOP B1 (before push):**
- `git reset --soft origin/main` → one commit; `HEAD^{tree}` unchanged;
- no untracked bench files in it;
- show `git log`, the diff stat and the test output.

Then branch → push → PR → owner merges.

### PR 2 (after PR 1 merges; fresh branch in the same worktree from the new origin/main)

1. `test:`
   - strict-schema `origin` first in the step;
   - the off-path bytes == `before-*` (prompt, pasted schema, request body, 4 combos);
   - the Tier 0 all-added rule;
   - each graph.py added-step guard;
   - the scanner (`origin` before / after / missing);
   - the draft payload;
   - web draft and cooking labels.
2. `feat(extract):` v8 + schema + switch + guards + scanner + fingerprint + `.env.example`.
3. `feat(web):` draft label, `make types`.
4. PPV 13.
5. Dumps.
6. `chore(notes):` dry run (₹0), then the live runs per D8.

**HARD STOP A2:** the results vs the D3 rule, row by row:
- every added step verbatim;
- the A/B table, spend and max silence;
- the proposed cupcakes golden capture.

**HARD STOP B2:** as B1.

### Follow-ups to log

| id | follow-up |
|---|---|
| FGC-30 | Map view: an added-step marker (needs a render checkpoint), unless Q6 pulls it in |
| FGC-31 | "N before baking / cooking" leads on hands-on steps (non-serving anchors); generalises F1 |
| FGC-32 | Tips that aren't steps ("Powdering the sugar makes creaming easy") stay required: they have no marker |
| FGC-33 | The gap metric's false positive on add-and-simmer shapes, if (iii) is ever surfaced to users |
| FGC-34 | A recipe-level line when added steps ≥ source steps (Q5) |

### Carried rules

- Keys:
  - OPENAI for extraction, LLM_API_KEY for repair, loaded with `python-dotenv` from the main
    checkout's `apps/api/.env` and never printed;
  - ₹0 runs set both invalid in-process.
- `PYTHONPATH=apps/api` (absolute for `make types`).
- Non-ASCII via Write/Edit only, then the mojibake grep. Never `ruff format .`.
- Stop only my own PIDs; port 9222 is the owner's.
- Restore CRLF fixtures with `git checkout`.
- No deploy, no phone runs.

---

## Open questions for the owner

1. **FGC-5 (product):**
   - (d) a derived "Wait before serving · N min" node [recommended];
   - (a) a scheduler minimum gap (`min_lead_min`) with new UI;
   - (b) the lead as text only (leaves the contradiction);
   - (c) a + b.
2. If (d): the label on the derived wait node.
   - The standard "Added by ABC Cook, not in the video"?
   - Or "Timed from the recipe: 10 min before serving", since the 10 min *is* in the source?
3. Does decision (b) cover ingredients-only sources (Tier 0)? Recommendation: **no**. Tier 0 stays,
   enforced in code (≥ 1 source step required).
4. Croissant: count an added "preheat" as acceptable (FGC-7) in the false-positive rule, and every
   other added step on a golden as a false positive? Recommendation: yes.
5. Cap on added steps? Cupcakes may get 4–5 added steps vs 2–3 source steps. Recommendation: no
   cap; per-step labels; log the count (FGC-34).
6. Map view: label added steps in PR 2, or follow-up FGC-30? Recommendation: follow-up.
7. Draft: label added steps while streaming (`origin` becomes the first step key) [recommended],
   or hide them until the plan?
8. Rejecting option (ii) (a second fill call) — confirm. It breaks one call per import.
9. Budget: hard cap ₹20, mandatory ≈ ₹15.8, chole n=1 optional — approve?

## Recommendation in 5 lines

1. PR 1 (₹0): FGC-4 markers + token-coverage cue ownership; FGC-5 via a derived stated wait node
   (pending Q1); provenance `origin` + web label plumbing; PPV 12.
2. PR 2 (₹): FGC-3 (i), v8 prompt + `origin` field (first key) + `ABC_COOK_ADDED_STEPS`; graph.py
   guards (hands-on only, estimate only, no ungrounded time/temp, ≥ 1 source step or Tier 0); PPV 13.
3. FGC-4's prompt rule rides in v8; FGC-27 is not bundled (v9).
4. Cupcakes becomes a golden from an approved v8 capture; the v7 capture stays as known-wrong
   evidence.
5. Ship B default-on only if the D3 rule holds (0 false positives on goldens, cupcakes filled ≥ 2/3,
   no contradiction, Tier 0 intact, ≤ 2 s first-ingredient cost).

**Budget cap: ₹20 hard (mandatory ≈ ₹15.8, 27 calls); PR 1 is ₹0.**
