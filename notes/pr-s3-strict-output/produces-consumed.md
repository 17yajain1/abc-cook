# produces_consumed on croissant (₹0 investigation, no live call, no repair call)

Scripts and raw output: `pc_investigate.py` (`.out.txt`, `.part2.txt`), `pc_prototype.py` (`.out.txt`).

## 1. Every violation, croissant (fields exactly as emitted)

Every violation is the same step: the **final** step, "Bake at 190° (375°F) for 20-25 minutes.", with
`produces_component='baked croissants'`, `consumes_ingredients=['proofed croissants']`,
`depends_on_previous=True`, and `depends_on_steps=[previous step]`. Nothing comes after it, so nothing can consume the label.

| Call | Arm | Step | `depends_on_steps` |
|---|---|---|---|
| 1-0 | on, low | 15 of 16 | [14] |
| 2-0 | on, low | 13 of 14 | [12] |
| 2-1 | on, low | 15 of 16 | [14] |
| 3-0 | off, low | none (final step has `produces_component=null`) | |
| 3-1 | off, low | 12 of 13 | [11] |
| 3-2 | off, low | none (final step null) | |
| 7-0 | on, minimal | none | |
| 7-1 | on, minimal | 12 of 13 | [11] |
| 7-2 | on, minimal | 13 of 14 | [12] |

Violation text, always: `Node "step_bake_at_190_375_f_for" produces "comp_baked_croissants", which no node consumes.`

## 2. Strict vs off, field by field

- **No field was omitted or empty-in-off and then filled under strict.** In the strict-off calls every key was already present on every step (no "absent"). Strict only makes that guaranteed.
- **Fill rates** (40 off steps, 46 on steps, 40 minimal steps):
  - `produces_component` filled 22/40 off, 32/46 on, 28/40 minimal.
  - `consumes_ingredients` is `[]` on 7/40 off and 4/46 on.
  - `depends_on_steps` is filled 36/40 off and 43/46 on (null 2 vs 1).
  - `depends_on_previous=false` is 1/40 off, 1/46 on, 3/40 minimal.
  - `attach_to_step` and `role_cue` are null everywhere.
- **Same intermediate every time:** yes, "baked croissants" on the final bake step, in both arms. Before it, both arms label the same chain (dough → risen dough → … → proofed croissants).
- **The difference** is whether the model also labels the final step. Strict on: 3/3 low calls (plus 2/3 minimal). Strict off: 1/3. Across all strict-on low calls the final step carries the label in 4/9 (croissant 3/3, chole 1/2, kadhi 0/3, pumpkin 0/1), and in 1/4 for strict off.

## 3. The validator

`validate.py` `_check_produces_consumed` (invariant 6). For each node with `produces` set, it raises a violation if:
- no other node has that `produces` id in its `consumes`, or
- no consumer depends on the producer, directly or transitively.

`graph.py` (lines ~1702–1753) links a producer to a **strictly later** step whose `consumes_ingredients` names the label. If no later step names it, it keeps the label unless `later_nodes and all(later depends on producer)` (rule B3). For a final step `later_nodes` is empty, so the guard is false, the label stays, and invariant 6 fires. That is the cause for every croissant case and for chole 4-0.

Kadhi minimal 6-0/6-1 are a different case (step 1 of 9 labelled, never consumed); that is not explained by this.

## 4. Prompt and schema (A2 for these fields)

`v7.md:199–203` says `produces_component` is "a short label if this step's output is explicitly used again later, otherwise leave it null". The schema type is nullable, so strict allows `null`. Nothing conflicts with all-required. The model is not forced to fill the field. It labels a final step despite the instruction, in both arms.

## 5. What repair does

`REPAIRABLE_RULES` includes `produces_consumed`, so a Sonnet call is made. `StepRepair` can set `consumes_ingredients` (add), `produces_component` (replace) and `depends_on_previous` (add a dependency).
- A later consumer cannot exist for a final step. Adding `consumes_ingredients` to an earlier step is not allowed (consumers must be strictly later).
- Replacing the label with another string leaves the same problem. Omitting the field means "unchanged".
- Offline replay on call 1-0: a no-op or missing proposal gives `tier=degraded` (linear plan, 16 nodes and 15 edges instead of 19). Only a proposal setting `produces_component=""` on the last step gives `repaired`; the repair prompt never suggests that.
- So repair cannot resolve it without an unlikely empty-string answer. The Sonnet call is spent and the plan falls back to a linear chain.

## 6. Fairness: edge agreement

Same matcher, croissant, low.

| Set | Edge recall/precision range | Mean |
|---|---|---|
| strict-off pairs (3) | 0.64–1.0 | 0.86 |
| strict-on pairs (3) | 0.69–0.89 | 0.79 |
| on-vs-off, all 9 pairs | recall 0.5–0.9, precision 0.7–1.0 | |

Against the golden (recall / precision):
- off: .71/.62, .56/.45, .60/.43
- on: .36/.44, .29/.25, .50/.43
- minimal (strict on): .80/.67, .60/.38, .50/.38

The golden is far from every run (the runs agree with each other at 0.64–1.0, with the golden at 0.29–0.71), so it is itself an outlier. The on-vs-golden recall (0.29–0.50) sits just below off's own spread (0.56–0.71), but the strict-on runs agree with each other about as well as the off runs do. With n=3 per arm that is not distinguishable from noise.

## 7. produces_consumed per call

| Recipe, effort, strict | Calls with ≥1 / calls |
|---|---|
| croissant low on | 3/3 |
| croissant low off | 1/3 |
| croissant minimal on | 2/3 |
| chole low on | 1/2 (the other has `ingredients_consumed`) |
| kadhi low on | 0/3 |
| kadhi low off | 0/1 |
| kadhi minimal on | 2/3 |
| pumpkin low on | 0/1 |

Golden originals: the final step has `produces_component=null` in all three.

## Prototype (offline)

Dropping `produces` on the final step before `build_graph` (a generic rule: nothing can consume it, so nothing is lost):

| Recipe, effort, strict | Repair would fire, before → after |
|---|---|
| croissant low on | 3/3 → 0/3 |
| croissant low off | 1/3 → 0/3 |
| croissant minimal on | 2/3 → 0/3 |
| chole low on | 2/2 → 1/2 |
| kadhi, pumpkin | unchanged (kadhi minimal 2/3 stays: different cause) |

Edge recall vs golden does not change; precision falls because the real graph replaces the linear fallback.

## Conclusion: (c) unclear, with a strict-independent finding

- **Not a forced field.** Strict did not fill an omitted field. The final-step label also occurs with strict off (1/3), and the mechanism is deterministic and generic.
- **The tier difference** (3/3 vs 1/3) is that one label on the final step; n is too small to say whether strict makes the model label it more often.
- **The recall gap vs golden** (0.29–0.50 vs 0.56–0.71) is unresolved at n=3.
- **Generic fix candidate, independent of strict, no prompt change:** in `graph.py`, drop `produces` with a warning when the producer has no later node. This makes B3's guard true for an empty set, so a final-step label stops costing a degrade and a wasted Sonnet call. It changes post-processing only (already inside POSTPROCESS_VERSION 11) and touches no golden (their final steps are null).
- **Cheapest live check if you want it:** croissant strict on n=3 plus off n=2 at low, about ₹3.2, taking spend to about ₹15 of ₹20. It would show whether the recall gap and the final-step labelling replicate. I have not run it.
