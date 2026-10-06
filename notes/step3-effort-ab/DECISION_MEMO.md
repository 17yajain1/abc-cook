# A4 decision memo: exact-fit gate triage, straddle triage, and redesigned effort experiment

Written 2026-10-06. Committed locally as 3d1c1f5 (not pushed); the n=5 experiment was then authorized by the owner on 2026-10-06 (new tranche up to ₹30). No production-code changes and no plan edits.
Spent so far: ₹23.89 of ₹40 (₹16.11 left). The owner chooses n and the budget; nothing here is an arm recommendation.
Supersedes the earlier chat drafts; where they differ, this file is the corrected version.

---

## 1. Exact-fit gate: verdict A (intentional)

- `docs/COOKING_GRAPH.md` §4.4 specifies two gates:
  - Typical packing: `used_typical + task.duration_typical <= capacity_min`.
  - Worst-case eligibility: `task.duration_max <= capacity_min`. It compares against the window's total capacity, not what remains.
- §4.3: "Never pack a window to 100%." §4.4: a task no window can safely hold "is simply a serial step; that is normal, not a warning."
- Code: `scheduler.py:206-240`; capacity factors 0.9 and 0.75 in `windows.py:8,11`.
- Tests pinning it: `test_duration_max_gate_rejects_then_a_roomier_window_claims` (`test_schedule.py:216`), `test_window_backfills_a_smaller_task_after_a_capacity_miss` (`:339`), `test_chicken_biryani_max_gate_and_two_burners` (`:354`, golden).
- The ±2-minute sensitivity is a documented consequence of a hard threshold applied to model estimates. It is not a bug.
- The ownership stage never moves a node in time (§4.4). A gate flip changes only whether a task is labelled a parallel task.

## 2. Straddling hosts: verdict C (owner product decision)

- §4.3 says a window exists "for every interval where at least one unattended/periodic node is running". §4.4 and `derive_windows` create one window per host and require the task to lie fully inside one host (`scheduler.py:223-224`). The code matches §4.4; the two sections disagree.
- No test and no golden fixture covers a task that straddles two adjacent hosts.
- Smallest example: host A (unattended, 0-10 min), host B (unattended, 10-24 min, depends on A), two independent 6-min hands-on tasks at 0-6 and 6-12. Only the first is claimed. The 6-12 task lies inside neither host and shows as a plain step, although the cook is free for the whole 0-24 span.
- Frequency in the 8 saved valid runs: **1 of 8** is a true straddle (burger medium r2, "Season crumbs" 35-39 across Cool filling 27-37 and Chill mixture 37-51). The other 4 partial overlaps found earlier are tasks that run past their only wait while the cook is still busy; that is correct behaviour.
  - burger medium r1 and r2: Prep vegetables (0-10, typ/max 10/15) against Soak poha.
  - burger low r2: Make batter (0-7, typ/max 7/10) against Soak poha.
  - tiramisu medium r1: Make filling base (11-16) against Chill espresso (3-13).
- Effect on A4's correctness comparison: none. The primary metrics are measured before the scheduler runs.
- Timing: decide **after** A4. Parallelism is a nice-to-have, and the current cost is one task shown as a plain step. Options for later: keep today's behaviour and reword §4.3 to "one window per host", or merge back-to-back waits (adds a cooking rule about the handoff).

## 3. Oracle ground truth (owner-confirmed, checked against the saved source)

- Burger: "Make batter" and "Season breadcrumbs" are independent. Source: separate bowls, no shared ingredients; they meet only at "dip & coat the shaped tikki in the batter & immediately coat it with the seasoned breadcrumbs".
- Tiramisu: the first ladyfinger layer does not depend on the filling. Source: the first layer uses ladyfingers, the espresso mix and the lined pan; the filling first appears in the next step.

### Pre-registered scoring rule

1. Score the graph built offline from the **first extraction** (`call0.normalized.json`) by the existing `build_graph`, before repair. This is the counted result. The final graph is scored and reported in a separate column.
2. Repair never upgrades a result. A first-extraction error stays an error even if repair removes the edge. A repair that introduces an error appears in the final column only.
3. Node mapping: each side of a pair is the node(s) doing that action (burger: whisking the batter, seasoning the breadcrumbs; tiramisu: first dip-and-layer, every filling-making step). A matcher proposes the mapping; every mapping is printed and checked by hand before counting.
4. Error: any node on one side is reachable from any node on the other, in either direction, through `depends_on`.
5. Ok: neither side reaches the other. Shared ancestors and descendants are ignored, and edges outside the pair are not scored.
6. Unscorable: one node performs both sides (merged), or a side has no node. Counted separately and excluded from the error denominator.
7. Attribution, reported and not counted: whether the offending path is a model-written dependency or a builder-added edge. Builder-added edges still count as errors.

### Result on the 8 existing runs (first-extraction graph; final graph scored the same in all 8)

| Run | Burger: batter vs crumbs | Tiramisu: first layer vs filling |
|---|---|---|
| medium r1 | ok | error |
| medium r2 | ok | error |
| low r1 | error (crumbs depend on batter; model-written) | ok |
| low r2 | ok | ok |

| Arm | Burger errors | Tiramisu errors | Pooled |
|---|---|---|---|
| medium | 0/2 | 2/2 | 2/4 |
| low | 1/2 | 0/2 | 1/4 |

Burger low r1 counts as an error. It also places both steps under the patty-filling chain, but a shared ancestor does not make the two steps dependent on each other, and edges outside the pair are not scored.

## 4. Proposed A4 experiment: non-inferiority screen on correctness

Question: is low meaningfully worse than medium on correctness? Latency and token differences already point one way at n=2 (low faster in all 4 paired comparisons, 5-8x fewer reasoning tokens).

### Inputs
- Comparison inputs: burger `youtu.be/_q5GKCNZcHI` and tiramisu `freshbeanbakery.com/pumpkin-tiramisu/`. Replay from the saved `round2/*.raw.json` files (byte-identical to round 1).
- Tier 0 guards: cake reel `DQ6524MjmCs`, kibbeh reel `DWem1piDh86`. They check that low does not invent a method; they say nothing about quality.
- Excluded: gnocchi (Cloudflare 403 challenge, do not retry), tartiflette (single-burner serialisation happens regardless of effort), pizza dough (smoke test only). No new live inputs.

### Arms (identical except effort)
Model `gpt-5-mini`, prompt `v7.md`, `max_completion_tokens` 16,000 (32,000 on escalation). Repair is Sonnet (`claude-sonnet-5`, `repair_v2.md`, effort "low") in both arms.

| arm | `reasoning_effort` sent |
|---|---|
| low | `"low"` |
| medium | nothing (`effort=None`); provider default, which is today's production behaviour |

Record the model id from every response; a snapshot or default change mid-run invalidates pooling.

### Protocol
- Replicate-major order, alternating arms inside each replicate, so a cap trip leaves arms balanced.
- Cache off. Pool the 2 existing replicates per cell with the new ones (same inputs, prompt, model).
- Model-level metrics from the first extraction; pipeline metrics from the final result.
- Before computing any attention-cue metric, apply the `_verification_corpus` correction to the scratch scripts. The bug is only in `memo_facts.py` (lines ~118-123) and `trace_final.py` (line ~52); production passes the lowercased corpus correctly (`import_pipeline.py:325,335`, `graph.py:1231`).

## 5. Metrics

### Model-level (first extraction; little scheduler amplification)

| Metric | Counted per run | Deterministic given output | Scheduler-amplified | Use for effort comparison |
|---|---|---|---|---|
| First-pass violation (repair trigger) | 1 if first extraction fails validation; count by rule | yes | no | yes, primary |
| Tier 0 guard invention | 1 if a method is invented from a caption with none | yes | no | yes, hard fail |
| Oracle dependency errors | per section 3 | yes | no | yes, secondary |
| Duration-triple completeness | share of steps with min, typical and max all present | yes | indirectly (builder defaults) | mechanism metric |
| Explicit dependency presence | share of non-first steps with non-empty dependencies | yes | no | descriptive only (more is not better) |
| Step count / grouping | step count / input's pooled median | yes | no | yes, flags merging |
| Attention claims and cue grounding | unattended/periodic claims; share grounded in source | yes (after the fix) | feeds window creation | descriptive |

### Pipeline / scheduler-level (final result)

| Metric | Counted per run | Deterministic given output | Scheduler-amplified | Use for effort comparison |
|---|---|---|---|---|
| Final tier (clean / repaired / degraded) | one label | no (repair adds randomness) | no | yes, primary for user harm |
| Degraded (linear fallback) rate | 1 if fallback | no | no | yes, but rare |
| Windows / parallel tasks | counts of non-empty windows and claimed tasks | yes | strongly | no, descriptive only |
| Useful parallel tasks | claimed tasks consistent with the oracle | yes | strongly | backstop only |
| Gate rejections | worst-case rejections, typical overflows, straddles (offline replay) | yes | it is the amplifier | no, diagnostic only |
| Latency (extraction s, end-to-end s incl. repair) | seconds | no | no | tie-break; TTR is about TTP until A5 |
| Reasoning tokens / cost ₹ | per run, including repair | no | no | last tie-break |

## 6. Sample size: owner decides (n=5 vs n=6 per cell not chosen here)

This is a directional screen, not a powered study. Pooled over both inputs, "flag" = low has at least 3 more non-clean events than medium; assumed medium rate about 25%.

| n per cell (pooled per arm) | Upper 95% bound on low's rate if 0 / 1 events | Chance of flag if low = 60% | if low = 45% | False alarm (arms equal) |
|---|---|---|---|---|
| 3 (6) | 46% / 64% (0 / 1 events; at n=6 pooled) | ~0.42 | ~0.21 | ~0.04 |
| 4 (8) | 37% / 53% | 0.58 | 0.32 | 0.07 |
| 5 (10) | 31% / 45% | 0.69 | 0.41 | 0.10 |
| 6 (12) | 26% / 38% | 0.78 | 0.49 | 0.12 |

(Bounds are two-sided 95% Clopper-Pearson intervals recomputed offline; they are more conservative than the one-sided figures quoted in the chat draft.)

- n=3 per cell: roughly a coin flip even for gross harm; not useful.
- n=4 to 6: catches gross harm (60% vs 25%) about 58% to 78% of the time; cannot detect a moderate (+20pp) difference.
- Detecting +20pp would need about 30 per arm, which is out of reach at this budget.
- No n here can establish equivalence.

## 7. Cost

Observed mean per run (₹): burger medium 3.18 (2.04 clean, 4.33 repaired), burger low 1.40, tiramisu medium 1.38, tiramisu low 1.34 (0.65 clean, 2.03 repaired). One replicate of all four cells: mean ₹7.30 (range 5.10-9.51). One guard set (cake and kibbeh, both arms): ₹1.09.

| Design | New replicates | Expected | Worst observed |
|---|---|---|---|
| n=4 per cell, no guards | 2 | ₹14.6 | ₹19.0 |
| n=5 per cell + guards | 3 | ₹23.0 | ₹29.6 |
| n=6 per cell + guards | 4 | ₹30.3 | ₹39.1 |

- Pooling the 2 existing replicates saves about ₹14.6. Replaying saved acquisitions saves no LLM spend (fetching has no model cost) but removes input variance and 403 risk. All scheduler and builder metrics are recomputed offline for ₹0.
- Only the n=4 option fits inside the ₹16.11 headroom on expected cost; its worst case would trip the cap. Anything larger needs a new tranche, which has not been requested.
- The runner's in-flight reservation (₹3.5 per run) stops it before a cap.

## 8. Decision rules (pre-registered)

Correctness and degradation outrank latency and cost. "Non-clean" = repaired or degraded. Evaluate on pooled results; a rule must hold in the same direction on both inputs.

1. **Keep medium** if any: low has at least 3 more non-clean events than medium; low has at least 2 more degraded runs; any guard run invents a method; low has more oracle errors than medium on both inputs; low merges steps in at least half of one input's runs.
2. **Change default to low** only if all: low's non-clean count is at most medium's + 1; low's degraded count is at most medium's; zero guard inventions; oracle errors no worse; latency advantage holds on both inputs. The owner still picks.
3. **Keep effort, address the pipeline** if both arms show about 25% or more first-pass violations dominated by the same rule (`produces_consumed` in all 4 non-clean events so far), or gate diagnostics change parallel-task outcomes in both arms at similar rates. Can be decided together with 1 or 2.
4. **Evidence insufficient** if any: the non-clean difference is exactly 2; one input drives all of the difference; more than 2 runs fail or come back unpriced; the provider's model id changes mid-run.

## 8a. Pre-run clarifications (owner decisions, 2026-10-06, frozen before any n=5 run)

These are owner decisions recorded before any new replicate was run. They clarify §8 and §5; they do not change any threshold, metric, input or the design, and they must not be revised after results are seen.

Design in force: n=5 per cell = 5 total runs per cell including the 2 existing replicates, so 3 new comparison replicates per cell and 10 pooled runs per arm across burger and tiramisu.

1. **Rule 3, "about 25% or more first-pass violations"** means **at least 3 of 10 pooled first-pass violations per arm**. This is the owner's adoption of the stricter round-up interpretation recommended in the pre-registration review (3/10 = 30%, not 2/10 = 20%). It makes the pipeline-fix rule harder to trigger, not easier. The rest of Rule 3 is unchanged.
2. **A ≥3 non-clean difference that does not hold on both inputs.** If low has at least 3 more pooled non-clean events than medium but the difference does not run in the same direction (low worse) on both burger and tiramisu, the result is **evidence insufficient** (Rule 4). It is not a win for either arm, no new decision rule is introduced for this case, and this reading must not change after results are seen. The experiment stays asymmetric: it tests only whether low is meaningfully worse than medium. There is no "medium is worse" rule.
3. **Product principle (owner level).** The goal is a simple, trustworthy cooking experience, not maximum graph complexity. This principle governs only the descriptive metrics in Section 5 (window counts, parallel-task counts, and small duration variation such as the 8/12-vs-5/8 Line-pan estimates). More parallel tasks or minor duration differences are not by themselves evidence that one arm is better or worse. It does not apply to the primary correctness metrics already defined in Sections 3 and 8: oracle dependency errors, first-pass violations, and Tier-0 guard inventions remain the deciding evidence regardless of parallelism count. In practice:
   - A small duration difference, such as the 8/12-vs-5/8 Line-pan estimates, is not a quality failure by itself.
   - A higher parallel-task count is not automatically better.
   - A false dependency that violates the §3 oracle rule is a correctness error, never "just a parallelism difference".
   - First-pass violations and Tier-0 guard inventions are not dismissed because they produce a simpler or more linear plan.
   - A simpler plan is preferable to unnecessary graph complexity, but simplicity does not override the frozen correctness metrics.

   This principle is for interpretation only. It adds no quantitative threshold or scoring rule.

## 9. Interpretation guardrails

- A structure repeating 2/2 is not established stability.
- A structure flipping between runs is not automatically a product bug (model sampling plus deterministic amplification).
- Model-level and pipeline-level metrics are reported separately, never merged into one score.
- Parallel-task or window counts are never the quality metric on their own.
- No budget is spent collecting more exact graph flips.
- The experiment cannot establish equivalence, rates for other recipe types, or anything outside burger and tiramisu.

## 10. Unchanged in the original plan

Arms are low and medium only (no `minimal`). Ranking order: correctness and degrade rate, then TTP/TTR, then cost. "n=2 is a screen; confirm before changing production." The owner picks the arm. Cache stays off. C1 folds into the A4 runs. A5 stays gated on the A4 outcome. Step order 3 then 4 (A3 cache) is unchanged.

## 11. Eventual plan amendments (not made)

1. Replace "graph diff" and edge similarity with the split metrics above; drop exact repeatability as a success criterion.
2. Replace "n about 5 per recipe" with the pooled n and the pre-registered rules.
3. Record the actual input set: valid inputs, guards, gnocchi unavailable, tartiflette excluded and why, and that the "3 known-degrading videos" were not used.
4. Record any A4 budget beyond ₹40 if approved.
5. Add a separate owner-decision item on back-to-back hosts (reconcile §4.3 "interval" with §4.4 "one host").
6. Consider a pipeline item for the `produces_consumed` failure pattern.
7. Note that TTR is about TTP until A5 adds streaming.
8. Decide whether `graph_compare.py` lands in the repo.

## 12. Decisions needed from the owner

1. **Decided 2026-10-06 (owner): n=5 total runs per cell, including the 2 existing replicates; 3 new comparison replicates per cell.** n=5 is explicitly chosen and authorized, with a new budget tranche of up to ₹30 (previous spend ₹23.89; possible cumulative ₹53.89).
2. Acceptance of the oracle scoring rule in section 3.
3. After A4: the straddle rule (section 2).

## 13. Final n=5 results and decision readout (recorded 2026-10-06, documentation only)

This section records completed results. It changes no rule, threshold, oracle definition, metric or design above. Sections 1 to 12 and §8a stand as frozen.

### 13.1 Experiment completion

- n=5 total runs per cell (2 existing replicates + 3 new): burger LOW 5, burger MEDIUM 5, tiramisu LOW 5, tiramisu MEDIUM 5. 20 comparison runs in total. All 20 were priced and none failed.
- 4 guard runs (cake and kibbeh, 1 run per arm). All 4 ended Tier 0 and no run invented a method.
- Arms as designed: `gpt-5-mini`; LOW sends `reasoning_effort=low`; MEDIUM sends no override; no cache; saved raw inputs replayed.

### 13.2 Spend

| | ₹ |
|---|---:|
| Previous | 23.89 |
| New tranche spent (comparison 16.49 + guards 1.09) | 17.58 |
| New tranche unused (of the ₹30 cap) | 12.42 |
| Cumulative | approx. 41.47 |

The ₹30 new-spend cap was not exceeded.

### 13.3 Oracle results (§3 rule, first-extraction graph)

| Arm | Burger | Tiramisu | Pooled |
|---|---|---|---|
| LOW | 1/5 | 0/5 | 1/10 |
| MEDIUM | 1/5 | 2/5 | 3/10 |

- Zero unscorable cases. Repair changed no oracle result (final graphs scored the same as first-extraction graphs in all 20 runs).
- Attribution (diagnostic only, not counted): all four oracle violations were model-written in the first extraction, not builder-added. In each, the offending edge is in the step's own `depends_on_steps` claim (burger LOW r1; burger MEDIUM n2; tiramisu MEDIUM r1 and r2).

### 13.4 Decision rules (§8) evaluated

Pooled counts: non-clean LOW 2/10 vs MEDIUM 2/10; degraded 0/10 vs 0/10; first-pass violations 2/10 vs 2/10.

- **Rule 1 (keep medium): does not fire.**
  - Non-clean difference is 0 (needs at least 3). Degraded difference is 0 (needs at least 2). Guard inventions are 0. LOW does not have more oracle errors than MEDIUM on both inputs (burger equal, tiramisu fewer).
  - Merge condition: under the only explicit pre-registered merge definition (§3 rule 6, one node performs both sides of an oracle pair), the result is 0/20, so Rule 1 does not trigger on merge. The §5 pooled-median step-count proxy and an actual step-level merge count were not used to trigger Rule 1.
- **Rule 2 (change default to low): conditions satisfied.**
  - Non-clean: LOW 2/10 vs MEDIUM 2/10 (LOW is at most MEDIUM + 1).
  - Degraded: LOW 0/10 vs MEDIUM 0/10 (LOW is at most MEDIUM).
  - Guard inventions: LOW 0 vs MEDIUM 0.
  - Oracle errors: LOW 1/10 vs MEDIUM 3/10 (no worse).
  - Latency (mean extraction seconds) lower on both inputs: burger LOW 46.0 s vs MEDIUM 89.5 s; tiramisu LOW 27.4 s vs MEDIUM 57.9 s.
  - Rule 2 conditions are satisfied; LOW is supported by the explicitly pre-registered rules. "The owner still picks" (§8 rule 2) applies.
- **Rule 3 (keep effort, address the pipeline): does not fire.** First-pass violations are LOW 2/10 vs MEDIUM 2/10. Neither reaches the frozen threshold of at least 3 of 10 pooled per arm (§8a item 1). The alternative clause of Rule 3 (gate diagnostics changing parallel-task outcomes in both arms at similar rates) was not evaluated.
- **Rule 4 (evidence insufficient): does not fire on the verified conditions; one sub-check is unverified.**
  - Non-clean difference is 0, not exactly 2. No input drives any difference. No run failed or came back unpriced (0 of 20).
  - The "provider's model id changes mid-run" sub-check is **unverified**. The saved result files, run logs and normalized extractions contain no provider response model id. The OpenAI adapter records the requested model id in its usage record, not a response-reported one, so the fact that all 20 runs were priced shows only that the requested id was a known pricing key. Nothing in the saved evidence shows a mid-run change, and nothing rules one out.
- The ambiguous at-least-3 non-clean difference that does not hold on both inputs (§8a item 2) did not arise, since the difference was 0.

### 13.5 Methodological limitation: the merge diagnostic

The §5 metric "Step count / grouping: step count / input's pooled median, flags merging" was not sufficiently operationalized before the experiment: it names no cutoff and no way to tell a merged step from an omitted optional step. Its possible post-hoc readings point in different directions. A below-pooled-median step count flags burger LOW 3/5 and burger MEDIUM 2/5 (the burger median of 16.5 is an even-count artifact; by graph-node count nothing is flagged). An actual step-level merge count gives burger LOW 2/5 and burger MEDIUM 3/5. Tiramisu is 0/5 in both arms under both readings. Neither reading was used for the decision. This is a gap in the frozen methodology and is not resolved in favour of either arm.

### 13.6 Conclusion and production decision

> **LOW is supported by the explicitly pre-registered rules**, subject to the methodological limitation in §13.5 and the unverified model-id sub-check in §13.4 Rule 4.

This does **not** mean LOW is now the production default. The production-default decision belongs to the owner and is still pending. Nothing in this section changes production code or configuration.

Offline scoring scripts (oracle mapping, scoring, attribution) were not committed; they remain in the session scratchpad.
