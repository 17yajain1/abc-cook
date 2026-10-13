# Sabudana Khichdi — schedule investigation (2026-10-13)

Investigation only. No code, prompt, fixture or schema was changed, no LLM was called, and no
network was used. Every number below comes from an offline replay of the owner's export.

Evidence labels follow `docs/cooking-plan-investigation.md`:

- **[verified]** read from code, or observed in the export or the replay.
- **[inference]** reasoned from verified facts, not observed directly.
- **[hypothesis]** untested.
- **[proposal]** future work, not approved.

## 1. Input and replay

**Input.** `docs/investigations/sabudana-2026-10-13.library.json` is an `abc-cook:library:v1`
export holding one `SavedRecipe`:

- Title: "Sabudana Khichdi"; `source_key` `youtube:oHHFafPET90`.
- `import_meta.sources = [description, transcript]`, where the transcript is in Hindi.
- `review_recommended = true`, `degraded = false`, 9 import warnings.

The payload is a `RecipePlanResponse`, i.e. `{graph, plan, stages, summary}`. The model's raw
`NormalizedRecipe` was never persisted, so `build_graph()` cannot be replayed. Only the stored
graph onward can be.

**Replay [verified].** Run inline in `apps/api`:
`CookingGraph.model_validate(payload.graph)` → `validate()` → `schedule()` → `summarize()`.

- `validate()` returns `[]`.
- `schedule()` gives total **160**, serial **183**, saved **23**, identical to the saved plan.
- One window, `w1`, is hosted by "Soak 2 hours" (5–125, capacity 108). It holds Cook potatoes
  (rank 0), Grind peanuts, Roast peanuts, Temper spices and Make chutney, with 23 min used.
- `summarize()`: one session (0–160), `long_waits = [(28, 125, 97 min, [Soak 2 hours])]`,
  active 60, elapsed_high 181.

Timeline as saved:

```
  0–5    Soak sabudana (rinse)         cook
  5–125  Soak 2 hours                  unattended  ← window w1
  5–10   Roast peanuts       w1
 10–15   Grind peanuts       w1
 15–18   Make chutney        w1
 18–23   Temper spices       w1        ← hot tempering, then…
 23–28   Cook potatoes       w1        ← …cooked potatoes sit ~103 min
125–128  Stir once                     (the recipe says "after one hour")
128–131  Coat sabudana
131–134  Add sabudana                  ← first use of the tempered pan
134–137  Cook briefly                  unattended (empty window, dropped)
137–145  Check doneness
145–150  Finish and mix
150–158  Serve
158–160  Serve with chutney
```

**Counterfactuals on Temper's `depends_on` [verified].**

| Temper `depends_on` | total | saved | Are Temper and Potatoes in the soak window? |
|---|---|---|---|
| as saved: `[Make chutney]` | 160 | 23 | yes (18–28) |
| `[]`, false edge removed | 160 | 23 | yes |
| `[Roast peanuts]`, what F2's fix produces because the heat-station guard re-adds it | 160 | 23 | yes |
| `[Coat sabudana]` or `[Roast peanuts, Coat sabudana]` | **170** | **13** | no; Temper runs 131–136 and Potatoes 136–141 |

**This corrects the review.** F2's false edge is not what puts Temper in the window. Removing
it, or replacing it with the honest heat-station edge, leaves the plan unchanged at 160/23. Even
without that edge, nothing ties Temper to the sabudana chain, so a ready hands-on node will be
pulled into any open window. F1 needs its own rule. F2 is still a real bug, but a separate one.

---

## 2. Findings

### F1 — Temper and Cook potatoes are scheduled inside the 2 hr soak

**Confirmed [verified].** In the stored graph:

- Temper: `depends_on = ["step_for_the_green_chutney_in_a"]` only.
- Cook potatoes: `depends_on = [Temper]`.
- Add sabudana: `depends_on = [Coat sabudana, Cook potatoes, Roast peanuts]`.
- `max_lead_min` is `null` on all 15 nodes, and provenance has `freshness: "none"` everywhere.
- Import warning #2 is "…shares an ingredient or component with earlier step 'For the green
  chutney…'; added that dependency."

Replay: 160 min, 23 saved as stored; 170 min, 13 saved when Temper waits for Coat sabudana. So
10 of the 23 "saved" minutes come from advice a cook shouldn't follow: heating a tadka and
cooking potatoes about 100 min before the sabudana goes in.

**Root cause.**

1. **The model claimed Temper was independent [inference].** In the explicit-dependency path,
   the only route that yields exactly `[chutney]` is a `depends_on_steps = []` claim (graph.py:
   1017-1044) followed by a guard edge (1078-1089). A claim of `[Coat]` would have kept Coat,
   and no "ignored index" warning was emitted. Provenance agrees: Temper's
   `depends_on_previous` is `inferred`, i.e. an extracted claim that a guard edge then modified.
2. **The guard edge is incidental [verified].** The cumin edge (F2) comes from
   `_verify_independence_explicit`, graph.py:932-948. With F2 fixed, the heat-station guard
   (graph.py:1090-1098) adds Temper ← Roast peanuts instead. That guard orders same-station
   steps but says nothing about *when*.
3. **The scheduler has no "keep the pan chain together" notion [verified].** While a window is
   open it starts any ready `hands_on` node (scheduler.py:172-179). Its only hold-back
   mechanism is freshness withholding (scheduler.py:123-140), which needs `max_lead_min` and a
   **single consumer** (COOKING_GRAPH.md §4.5, M1 scope). Temper has two consumers (Cook
   potatoes, Serve with chutney) and so does Cook potatoes (Add sabudana, Cook briefly). Setting
   `max_lead_min` on them would therefore not withhold them either.
4. **Side note [verified].** Temper and Cook potatoes are `kind = "prep"` only because
   `_infer_kind` substring-matches "chop" in "chopped" and "dice" in "diced" (graph.py:71-74,
   604-614). This does not affect scheduling, which reads `attention`, but it does affect how
   these nodes render.

**Q2 — a deterministic rule.** Two variants were simulated in memory. Each flagged node got
virtual dependencies so that it waits until the rest of its burner successor's dependencies are
done, recursively along the chain, excluding its own descendants so no cycle forms.

- **R1 (the literal candidate):** a `hands_on` burner node with ≥ 1 burner direct successor is
  withheld until that successor is otherwise ready.
- **R2:** R1, except a node that also has a non-burner successor other than the sink is exempt.
  Its output leaves the pan.

Results against every golden fixture, plus sabudana [verified]:

| fixture | flagged by R1 | flagged by R2 | effect on the plan |
|---|---|---|---|
| kadai-paneer | saute_onion, add_veggies, add_paneer | same | **Timeline changes**: chop_tomato moves 8→3, saute_onion 3→5. Total (34), windows and saved (9) unchanged. The golden `.plan.json` changes. |
| maggi-2min | add_noodles_masala | same | none |
| chicken-biryani (burner_capacity 2) | — | — | none |
| homemade-donuts | — | — | none |
| strawberry-shortcake | — | — | none |
| synthetic-two-windows | toast_whole_spices | — | No timeline change. Only `critical_path` changed, an artefact of simulating with edges; a scheduler predicate would not touch it. |
| synthetic-two-sittings | saute_and_add_beans | same | none |
| **sabudana** | Roast peanuts, Temper, Cook potatoes, Add sabudana | Temper, Cook potatoes, Add sabudana | 160 → **170**, saved 23 → **13**; w1 keeps Roast, Grind, Chutney |

The candidate rule's premise needed a check, and part of it doesn't hold. Roast peanuts **is**
caught by the literal rule, because Add sabudana (burner) depends on it directly through
`comp_roasted_peanuts`. It escapes R1 here only by accident: every candidate hold is one of its
own descendants. R2 exempts it by design, since its output also goes to Grind and Make chutney
(counter).

The kadai change under both variants is arguably *better* cooking: chop the tomato before the
onions hit the pan instead of leaving them on the heat while you chop. It still contradicts the
worked example in COOKING_GRAPH.md §3, and that text would need updating.

**Options. This is a cooking rule; the owner chooses, not this doc.**

| | Rule | Fixes sabudana? | Golden fixtures | Notes |
|---|---|---|---|---|
| A | R2 as a scheduler withholding predicate, generalising §4.5 | yes (170) | kadai timeline changes | Doesn't touch the graph, `critical_path` or the schema |
| B | R1 as a predicate | yes (170) | kadai timeline changes | Over-flags steps whose output leaves the pan (Roast peanuts), which could withhold a real parallel task |
| C | Exclude pan-chain nodes from window *ownership* only | **no** | none | The timeline is unchanged; Temper still runs at min 18, just without the "parallel" label |
| D | Add virtual edges at graph build | yes | kadai changes | Puts a timing preference into edges that are meant to be real dependencies; doesn't apply to hand-authored graphs |
| E | Implicit `max_lead_min` on pan-chain nodes | **no** | — | Fails the M1 single-consumer scope (see root cause 3); needs the deferred multi-consumer spec |

A prompt-side nudge is also possible: v7.md:182-196 already mentions "pan/pot/bowl state". It is
not deterministic, so it doesn't replace any of the options.

| | |
|---|---|
| POSTPROCESS bump | yes for A, B, D (`schedule/` or `extract/graph.py`) |
| Prompt change | no |
| Golden fixture | New `sabudana-khichdi.graph.json` + `.plan.json` (§3); kadai `.plan.json` changes under A, B, D |

### F2 — ingredient matching ignores groups

**Confirmed [verified].**

- `name_to_ids` is keyed by lowercase name only (graph.py:1238-1282; the key is set at 1252).
  `group` is stored on the `Ingredient` (1261) but is never used for matching.
- Four names map to two ids each: `green chilli`, `cumin seeds`, `roasted peanuts`,
  `sendha namak`. As a result Make chutney consumes 12 ids, including both cumin seeds; Temper
  consumes both cumin seeds; Add sabudana consumes both roasted peanuts and both sendha namak.
- The duplicated "You'll need" lists come from `derive.ts:211-217`
  (`stageIngredients`, every consumed id) rendered by `StageCard.tsx:161-168`.

**Correction to the review [verified].** The false shared-ingredient **edge** is computed on the
steps' raw `consumes_ingredients` **names** (`_verify_independence_explicit`, graph.py:941-947),
not on `name_to_ids`. Fixing `name_to_ids` alone would de-duplicate the lists but keep the edge.

**Proposed fix [proposal]**, the smallest deterministic one:

1. Resolve ids per step using a *home group*: the most common group among the step's
   unambiguous ingredients, or ungrouped if there are none. An ambiguous name resolves to the id
   in the home group, else the ungrouped id, else all ids.
2. Add a **no-orphan guard**: an id that would end up consumed by no step keeps its current
   consumers. The simulation showed why this is needed. Without it, `ing_green_chilli`
   (ungrouped, "1 tbsp") is consumed by nobody, which breaks invariant 5 and fires a repair LLM
   call.
3. Have `_verify_independence_explicit` compare resolved **ids**, not names. Temper's
   `{ing_cumin_seeds}` and Make chutney's `{ing_cumin_seeds_2}` no longer intersect.

Simulated result: Make chutney → the chutney-group ids; Temper, Grind and Add sabudana → the
ungrouped ids.

An alternative is a prompt convention, `"cumin seeds (For green chuteny)"`. It needs a prompt
change and depends on the model following it.

| | |
|---|---|
| POSTPROCESS bump | **yes** (graph.py) |
| Prompt change | no (yes for the alternative) |
| Golden fixture | Hand-written `NormalizedRecipe` unit fixture with a duplicated name across two groups, plus one ungrouped duplicate to exercise the guard |

### F3 — one session; the 97-minute gap is only a `long_wait`

**Confirmed [verified].**

- `SESSION_BREAK_MIN = 120` (summary.py:24) and `LONG_WAIT_MIN = 45` (summary.py:29).
- The occupied intervals cluster at summary.py:128-133. The 28→125 gap is 97 min, below 120, so
  there is one session.
- 45 ≤ 97 < 120, so it becomes a `long_wait` (summary.py:217-226).

**New fact [verified].** `long_waits` has **no production consumer** in `apps/web`; only
`cooking/constants.test.ts:32` reads it. The between-stage wait row needs ≥ 2 sessions
(`derive.ts:449`). As a result, the app shows the 97-minute soak as a wait **nowhere**.

Q5 is answered in §2.Q5. POSTPROCESS bump: yes if `summary.py` changes. Prompt: no.

### F4 — verbatim Hindi doneness cues

**Confirmed [verified].**

- Cook potatoes: `"जब आपको लगे कि आलू अच्छे से कुक हो गया है"`.
- Check doneness: `"ट्रांसलूसेंट हो गया है"`.

**Root cause [verified].** `doneness_cue` goes through `_clean_cue` only (graph.py:199-210, used
at 1420). That function strips a leading "until"; there is **no grounding and no language
check**. The prompt groups doneness cues with the verbatim-quoted cues (v7.md:33-39: "quote it
exactly as it appears in the transcript") and asks for "the sensory signal from the text"
(v7.md:160-163). The model therefore quoted the Hindi as written.

Fix: see Q4. POSTPROCESS bump: yes. Prompt change: yes (v8).

### F5 — 13 of 15 durations defaulted; the soak's "2 hours" is not grounded

**Confirmed [verified].**

- Provenance shows 13 `defaulted` and 2 `inferred` (Soak 2 hours, Cook briefly).
- `defaulted` means the model returned no numbers, so `_DEFAULT_DURATION_MIN[kind]` applies
  (graph.py:81-87, 851-853). For example, Serve = 8 min is just the `active` default, and
  Check doneness = 8 is the same.

**Root cause of the "no duration phrase" warning [verified].**

- The step text parses fine: `_duration_expressions("…soak for 2 hours.")` gives 120, and
  "3 to 4 minutes" gives 3–4.
- Grounding then parses the **source corpus** with the same English-only grammar: units
  `min/minute/hr/hour/sec…` and English number words (graph.py:617-655, 706-731).
- Tested: `"2 घंटे के लिए भिगो दें"`, `"do ghante ke liye"` and `"3 से 4 मिनट"` each parse to
  nothing, so they never ground.
- The warning text at graph.py:789-793 ("no duration phrase was found in **its own text**") is
  **factually wrong**. The phrase is in its own text; it was the corpus match that failed.

[hypothesis] The transcript states the soak as "2 घंटे" or "दो घंटे". The raw transcript isn't
in the export; re-acquiring it (network only, no LLM) would confirm this.

Fix: see Q4. Separately, reword the warning as "…but that duration was not found in the source
text". POSTPROCESS bump: yes. Prompt change: no.

### F6 — "Stir once" scheduled after the soak

**Confirmed [verified].** "After one hour, mix the soaked sabudana once…" has
`depends_on = [Soak 2 hours]`, so it runs 125–128, after the soak ends. The schema has no way to
express "partway through a wait".

**Proposal (one line):** a prompt rule that a check-in partway through a wait splits the wait
into two unattended nodes (Soak 60 → Stir → Soak 60). Prompt: yes. POSTPROCESS bump: no, unless
graph.py helps.

### F7 — the soak sits in stage "cook"; there are two serve steps

**Confirmed [verified].**

- **Stage.** The soak is the first cook anchor (`kind = passive`), so `_stages_for` puts it and
  everything after it in Cook. This is the documented tradeoff in COOKING_GRAPH.md:101-110.
  **Proposal (one line):** an unattended node with station `none` (soak, marinate) does not
  anchor the Cook stage.
- **Two serve steps.** The model marked "Serve with chutney" optional with the Hindi `role_cue`
  `"नहीं तो आप … सर्व कर सकते हैं"`. `_OPTIONAL_MARKERS` is English-only (graph.py:55-63,
  checked at 458-461), so the step was kept as required and became the sink (warning #1).
  **Proposal (one line):** a narrow Hindi optional-marker table, in the same pattern as
  `_HINDI_NUMBER_WORDS` (graph.py:351-364).

POSTPROCESS bump: yes for either. Prompt: no.

### Q4 — is grounding done against the source-language text?

**Yes [verified].** The corpus is `raw_source_text.lower()`: description plus transcript, in
whatever language they are (graph.py:269-276, 1231).

| Field | How it is grounded | Effect on Hindi sources |
|---|---|---|
| `attention_cue` | substring of the corpus (graph.py:287) | The prompt makes the model quote Hindi, and this works |
| `freshness_cue` | substring plus an English marker (304) | Grounding works; the markers are English-only |
| `role_cue` | substring plus an English marker (461) | Same; this is F7 |
| durations | parsed by value, with English-only units | Never grounds in Devanagari or romanized Hindi (F5) |
| `doneness_cue` | **not grounded at all** | Displayed verbatim (F4) |

**Keeping a verbatim cue for grounding but showing an English one [proposal]:**

1. **Prompt v8.** `NormalizedStep` gains `doneness_cue_quote`, the verbatim source phrase.
   `doneness_cue` becomes an English display string.
2. **graph.py.** Substring-ground the quote, as for `attention_cue`. Record the quote and its
   grounded flag in provenance (`NodeDecision`), so no `Node` schema change or TS regeneration
   is needed. `Node.doneness_cue` stays English.
3. **Deterministic stopgap.** A display cue containing non-Latin script is dropped from display
   now. This also protects older saved recipes once they are re-imported.
4. **Durations.** Add corpus-side Hindi units (`मिनट`, `घंटा/घंटे`, `सेकंड`, plus romanized
   `ghanta/ghante`) and reuse `_HINDI_NUMBER_WORDS` and Devanagari digits. This is a narrow
   table, as before. No prompt change is needed, because the step text is already English.

### Q5 — what drives "Now / hands-free wait / Then"?

| Field | Problem |
|---|---|
| `sessions` | Only splits at ≥ 120 min, so sabudana is one session. Changing its meaning would break the header range and cooking mode, both of which consume it. |
| `long_waits` | Has the wait (start, end, idle, hosts) but **no node partition**. The frontend would have to compare each `start_min` against the boundary, which is derivation the frontend must not do. |
| **new `PlanSummary.phases`** [proposal] | Session-shaped segments split at every gap ≥ `LONG_WAIT_MIN`. Each segment carries `node_ids`, `preceded_by_wait_min`, `preceded_by_host_node_ids`, and `new_sitting: bool` (gap ≥ `SESSION_BREAK_MIN`). |

With `phases`, the frontend renders "Now" = `phases[0].node_ids`, "hands-free wait" =
`phases[1].preceded_by_wait_min` plus its hosts, and "Then" = `phases[1].node_ids`, with **no
arithmetic**.

For sabudana, Now = rinse, start the soak, roast, grind and chutney; then a 97 min wait (107
under option A); then the rest. POSTPROCESS bump: yes (summary.py). Prompt: no. Requires
`make types`.

---

## 3. Proposed golden fixture

**`tests/fixtures/sabudana-khichdi.graph.json`** [proposal] is the stored graph with these
corrections:

- Temper: `depends_on = [Roast peanuts]`. This is the honest heat-station edge; the cumin edge is
  gone, and there is **no** Coat edge, because the rule should produce the timing, not the graph.
- `consumes` resolved by group, as in F2.
- English doneness cues ("potatoes cooked through", "translucent, pearl-like").
- Only if F6 and F7 are adopted: soak split around Stir once, and the soak staged as Prep.

**`sabudana-khichdi.plan.json` under option A**, verified numerically: total **170**, serial
**183**, saved **13**. w1 (soak) holds Grind peanuts, Roast peanuts and Make chutney (13 used).
Temper runs 131–136 and Cook potatoes 136–141. `long_waits = [(18, 125, 107)]`, one session.

**Plus** a hand-written `NormalizedRecipe` unit fixture for graph.py covering a group
collision, a Hindi duration in the corpus, a Hindi doneness cue and a Hindi optional cue. The
real one cannot be recovered.

---

## 4. Ranked fix list

| # | Fix | Why this rank | Bump | Prompt |
|---|---|---|---|---|
| 1 | F1 pan-chain rule | Wrong advice at a hot stove, plus an inflated "saved" figure | yes | no |
| 2 | F2 group-aware ids + id-based independence + no-orphan guard | False edges, duplicated lists | yes | no |
| 3 | F5 Hindi duration grounding + warning text | Every Hindi import loses its stated durations | yes | no |
| 4 | F4 English display cue / verbatim quote | Untranslated copy on screen | yes | yes (v8) |
| 5 | F3 `PlanSummary.phases` + wait UI | The 97-min wait is invisible | yes | no |
| 6 | F7 soak stage / Hindi optional markers | Cosmetic, and a spurious sink step | yes | no |
| 7 | F6 split a wait around a mid-wait check | Small timing error | no | yes |

Items 2 and 3 (and the code part of 6) can share one POSTPROCESS bump (1 → 2).

## 5. Decisions needed

- **D1.** F1: option A, B, C, D or E.
- **D2.** Accept the kadai-paneer golden timeline change (chop_tomato before saute_onion) if A,
  B or D is chosen.
- **D3.** F2: deterministic home-group fix, or a prompt convention.
- **D4.** F4: where the verbatim quote lives, and whether to hide non-Latin display cues now.
- **D5.** Approve the narrow Hindi duration-unit table. Is re-acquiring the transcript (network,
  no LLM) OK to confirm the F5 hypothesis?
- **D6.** Q5: a new `phases` field or an extended `LongWait`, and is 45 min the right
  "hands-free wait" boundary?
- **D7.** Schedule F6 and F7 now, or defer them.

## Owner decisions (2026-10-13)

D1 Pan-chain rule: Option A (R2, scheduler withholding predicate).
   Condition: PR-A must test it on a dal-tadka-style recipe (tadka cooked on
   the burner, then poured onto a dish off the burner). If R2 lets that tadka
   float into a wait, propose options (e.g. "hot"/"immediately" cue, or
   treating "pour over" as staying in the pan) and ask me before choosing.
D2 Kadai golden change: accept, after I review the new plan in the PR.
D3 Ingredient groups: deterministic code fix (home group + no-orphan guard,
   id-based independence). No prompt convention.
D4 Hindi doneness cues: hide non-Latin display cues now (stopgap);
   verbatim-quote + English-display pair in prompt v8.
D5 Hindi durations: accept the Hindi unit table; OK to re-acquire the
   transcript (network only, no LLM) to confirm the hypothesis.
D6 New PlanSummary.phases field; 45-min boundary is provisional, to be
   checked against real recipes in that PR.
D7 F6 and F7: deferred.

Fix order: PR-A (D1 + kadai golden + sabudana fixture) -> PR-B (D6 phases)
-> PR-C (D3 + D5 + warning text, one POSTPROCESS bump) -> PR-D (D4).
Each PR is a separate session and needs my approval before implementation.
