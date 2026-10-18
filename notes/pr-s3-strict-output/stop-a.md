# HARD STOP A: PR-S3 (commits 1–4 done, live runs finished)

Commits 1–4 are done and nothing is pushed. The live runs finished with no auth, infra or 4xx failure.

Branch `feat/pr-s3-strict-output`:
```
4f2785a chore(notes): live bench outputs (rows 1-9), analysis scripts
0047f0f chore(notes): strict bench script and dry run
c44f813 feat(extract): refusal and request-error handling; ImportFailure refused; PPV 11
722137d feat(extract): strict structured output request, refusal capture, cache fingerprint
4c7b05e test(extract): request dump script, frozen before bodies, failing strict tests
```

## 1. Spend

| Item | Value |
|---|---|
| Total (from the `import cost:` lines) | **₹11.76** of the ₹20 cap |
| Remaining | ₹8.24 |
| Lower-bound flags | none; every call returned usage |

| Row | Calls | ₹ |
|---|---|---|
| 1 | 1 | 0.86 |
| 2 | 2 | 1.22 |
| 3 | 3 | 1.95 |
| 4 | 2 | 1.92 |
| 5 | 3 | 1.68 |
| 6 | 3 | 1.67 |
| 7 | 3 | 1.31 |
| 8 | 1 | 0.42 |
| 9 | 1 | 0.72 |

**Row 12 was skipped.** Rows 6 and 7 both fail the minimal floor (section 4), so per A1 it is not run. The dry run with reservations is in `notes/pr-s3-strict-output/dry-run.txt`.

## 2. Results

Times are in seconds from run start. The columns are first content, first ingredient, ingredients complete, first step, steps complete, and done. `*` marks row 1, the first strict-schema call, which is left out of the averages (A3).

| Call | Recipe, effort, strict | Content | Ingr 1 | Ingr done | Step 1 | Steps done | Done | Max gap | In / cached / out / reasoning | ₹ | Tier | Repair would fire | Floor viol. off/on | Non-default (dep-prev=false / role / servings) | FGC-21 | Edge recall / precision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1-0* | croissant low on | 13.8 | 14.6 | 17.1 | 17.4 | 40.0 | 40.7 | 0.1 | 10508/0/3768/1024 | 0.86 | degraded | Y | 0/0 | 1/0/0 of 16 | 0/4 | .36/.44 |
| 2-0 | croissant low on | 12.8 | 13.8 | 16.6 | 17.0 | 39.2 | 39.8 | 0.1 | 10508/10368/3269/832 | 0.58 | degraded | Y | 3/0 | 0/0/0 of 14 | 0/4 | .29/.25 |
| 2-1 | croissant low on | 9.4 | 10.1 | 11.8 | 12.3 | 36.0 | 37.3 | 0.1 | 10508/10368/3630/896 | 0.64 | degraded | Y | 3/0 | 0/0/0 of 16 | 0/4 | .50/.43 |
| 3-0 | croissant low off | 13.8 | 14.7 | 17.0 | 17.3 | 46.4 | 48.1 | 0.1 | 8061/0/3550/896 | 0.77 | clean | n | 0/0 | 1/0/0 of 14 | 0/4 | .71/.62 |
| 3-1 | croissant low off | 14.8 | 15.8 | 18.4 | 18.8 | 40.9 | 42.2 | 0.1 | 8061/7936/3291/960 | 0.58 | degraded | Y | 0/0 | 0/0/0 of 13 | 0/4 | .56/.45 |
| 3-2 | croissant low off | 15.6 | 16.5 | 19.0 | 19.4 | 44.3 | 45.4 | 0.2 | 8061/7936/3412/1024 | 0.60 | clean | n | 3/0 | 0/0/0 of 13 | 0/4 | .60/.43 |
| 4-0 | chole low on | 5.5 | 6.2 | 16.8 | 17.5 | 51.8 | 53.1 | 0.1 | 14381/8960/4757/384 | 0.94 | degraded | Y | 0/0 | 4/0/0 of 15 | 0/3 | no golden |
| 4-1 | chole low on | 6.8 | 7.7 | 17.2 | 17.6 | 57.4 | 59.0 | 0.2 | 14381/14208/5545/576 | 0.98 | degraded | Y | 1/0 | 4/1/0 of 19 | 0/2 | no golden |
| 5-0 | kadhi low on | 11.6 | 12.4 | 20.5 | 20.9 | 37.6 | 39.4 | 0.1 | 12448/8960/3496/1024 | 0.69 | clean | n | 0/0 | 2/0/1 of 8 | 0/0 | 1.0/.78 |
| 5-1 | kadhi low on | 7.0 | 7.9 | 16.5 | 17.0 | 29.5 | 30.4 | 0.1 | 12448/12288/2770/384 | 0.50 | clean | n | 0/0 | 3/0/1 of 8 | 0/0 | .83/1.0 |
| 5-2 | kadhi low on | 8.6 | 9.3 | 16.7 | 17.3 | 26.7 | 28.0 | 0.1 | 12448/12288/2714/832 | 0.49 | clean | n | 0/0 | 1/0/1 of 4 | 0/0 | n/a (4 steps only) |
| 6-0 | kadhi minimal on | 2.0 | 3.6 | 16.5 | 17.0 | 34.3 | 35.4 | 0.1 | 12448/0/2566/0 | 0.70 | degraded | Y | 1/0 | 2/0/1 of 9 | 0/1 | .54/.88 |
| 6-1 | kadhi minimal on | 1.2 | 2.3 | 13.3 | 14.2 | 40.4 | 41.8 | 0.3 | 12448/12288/2598/0 | 0.47 | degraded | Y | 0/0 | 2/0/0 of 9 | 0/0 | .43/.75 |
| 6-2 | kadhi minimal on | 1.8 | 2.7 | 10.5 | 10.8 | 29.9 | 31.3 | 0.2 | 12448/12288/2758/0 | 0.50 | clean | n | 0/0 | 2/0/1 of 10 | 0/0 | .58/.58 |
| 7-0 | croissant minimal on | 1.0 | 2.2 | 5.6 | 6.1 | 34.4 | 35.2 | 0.2 | 10508/8960/2365/0 | 0.45 | clean | n | 0/0 | 1/0/0 of 13 | 0/4 | .80/.67 |
| 7-1 | croissant minimal on | 1.3 | 2.1 | 4.1 | 4.4 | 22.2 | 23.1 | 0.1 | 10508/10368/2327/0 | 0.42 | degraded | Y | 0/0 | 1/0/0 of 13 | 0/4 | .60/.38 |
| 7-2 | croissant minimal on | 0.9 | 1.7 | 4.0 | 4.1 | 35.6 | 36.6 | 0.2 | 10508/10368/2435/0 | 0.44 | degraded | Y | 3/0 | 1/0/0 of 14 | 0/4 | .50/.38 |
| 8-0 | pumpkin low on | 6.4 | 7.1 | 9.5 | 9.7 | 20.4 | 21.3 | 0.1 | 10601/8960/2168/576 | 0.42 | clean | n | 0/0 | 1/2/0 of 7 | 0/0 | 1.0/.60 |
| 9-0 | kadhi low off | 13.8 | 15.3 | 28.9 | 29.3 | 49.1 | 50.7 | 0.1 | 10001/6912/3735/640 | 0.72 | clean | n | 0/0 | 3/0/0 of 10 | 0/0 | .71/.62 |

- **Retries and stop reasons:** every call had 0 retries and `stop_reason=stop`. There were no truncations, no unparseable responses, no refusals and no escalations.
- **Tier "degraded":** these are the calls where repair would fire.
- **Edge recall/precision:** these are vs the golden, so chole has none.
- **Full per-call output:** `results.md` and `results.json` in this directory.

## 3. Target table (A5)

First ingredient from paste is 6 s of acquire plus the call's first-ingredient time. The target is ≤ 15 s typical and ≤ 20 s worst. The plan gave today's figure as 14.7–16.9 s.

| Arm | First ingredient from paste | Steps complete | Done |
|---|---|---|---|
| croissant low, strict on (n=2) | 16.1–19.8 | 36.0–39.2 | 37.3–39.8 |
| croissant low, strict off (n=3) | **20.7–22.5** | 40.9–46.4 | 42.2–48.1 |
| croissant minimal, strict on (n=3) | **7.7–8.2** | 22.2–35.6 | 23.1–36.6 |
| kadhi low, strict on (n=3) | 13.9–18.4 | 26.7–37.6 | 28.0–39.4 |
| kadhi low, strict off (n=1) | 21.3 | 49.1 | 50.7 |
| kadhi minimal, strict on (n=3) | **8.3–9.6** | 29.9–40.4 | 31.3–41.8 |
| chole low, strict on (n=2) | 12.2–13.7 | 51.8–57.4 | 53.1–59.0 |
| pumpkin low, strict on (n=1) | 13.1 | 20.4 | 21.3 |

- **Provider latency today:** the strict-off arm today is slower than S2a's 14.7–16.9 s (first content 13.8–15.6 s vs 7.9 s earlier). Provider latency drifts, so compare the strict-on and strict-off arms with each other, not with the old figures.
- **Row 1:** first content 13.8 s, the same as strict-off calls made today. No first-schema compile penalty is visible.

## 4. Verdicts

**Strict on vs off at low**
- **Speed:** strict on is about 3–6 s faster to the first ingredient (croissant 10.1–13.8 vs 14.7–16.5 s; kadhi 7.9–12.4 vs 15.3 s) and faster to steps-complete. The samples are small (kadhi off is n=1) and the noise is large.
- **Quality floor:** strict on does not clearly meet it.
  - **Repair would fire:** 5/9 low strict-on calls vs 1/4 strict-off (croissant 3/3 vs 1/3; chole 2/2 with no off arm).
  - **Croissant tier:** degraded 3/3 on vs 1/3 off.
  - **Croissant edge recall/precision:** 0.38/0.37 mean on vs 0.62/0.50 off.
  - **Kadhi:** clean 3/3 in both arms, with edge agreement comparable.
- **Stated-floor violations (F11-a off):** 3/9 calls on vs 1/4 off. They vanish with F11-a on.
- **Unparseable responses:** zero in all 19 calls, so FGC-13's 13% can't be confirmed or refuted at this n.
- **Cost:** total input tokens are 2,447 higher per call (about ₹0.05 uncached); output tokens do not rise (croissant 3269–3768 on vs 3291–3550 off).

**Minimal vs low: minimal fails the floor.**
- **Kadhi:** minimal is degraded 2/3 vs clean 3/3 at low, and repair would fire 2/3 vs 0/3. Edge recall is 0.43–0.58 vs 0.83–1.0 at low, outside low's spread.
- **Croissant:** tier and repair are no worse than low, and edge scores are higher. But it hits the stated-floor violation in 1 of 3 calls, and the sample is small.
- **Row 12:** skipped under A1, so minimal can't ship.
- **Speed upside:** first ingredient from paste is 7.7–9.6 s, well inside target.

**Recommendations**
- **Effort constant:** keep `low`. Don't touch `EXTRACTION_EFFORT`. The remaining first-ingredient gap goes to FGC-20.
- **Strict:** ship the code, with the `ABC_COOK_STRICT_EXTRACTION` kill switch. I recommended **default off** until a larger-n run shows repair-would-fire and croissant edge agreement are not worse. The decision is the owner's. (Superseded by the produces_consumed investigation, `produces-consumed.md`.)

## 5. FGC-11

**₹0 stage-by-stage trace** (croissant, the three one-hour rests):

| Stage | Result |
|---|---|
| Model output | 55/60/65 |
| `_verify_duration` out | 55/60/65 |
| Node | 55/60/65, provenance `extracted` |
| Plan timeline | 60 min |
| On screen | no visible number |

- **Why nothing shows:** the scheduler never reads `duration_min`. Web code reads it only for the `~Nm` countdown when max − min > 15, and 65 − 55 = 10.
- **Hands-on steps:** the 6-minute step arrives as 5.5/6/6.5 but the node resolves to 6/6/6. Only wait-window hosts keep the spread.

**P2 regrade:** the trace confirms no on-screen number changes, and with F11-a no node's spread crosses 15 either (False → False everywhere). So FGC-11 can be regraded to P2 and F11-a shipped, per Q1.

**Hedged wording (Q1):** 0 of the 14 violating steps in the live calls, and 0 of the 7 fixture node changes, use "about / approx / ~ / लगभग". The floor would still apply to them.

**Recurrence at low:** 3/9 calls with strict on vs 1/4 with strict off. With F11-a on it is 0.

## 6. FGC-15, FGC-22, FGC-23

**FGC-15: output-token spread**

| Recipe, effort, strict | Output tokens |
|---|---|
| croissant low on | 3269–3768 |
| croissant low off | 3291–3550 |
| croissant minimal on | 2327–2435 |
| kadhi low on | 2714–3496 |
| kadhi low off | 3735 (n=1) |
| kadhi minimal on | 2566–2758 |
| chole low on | 4757–5545 |
| pumpkin low on | 2168 (n=1) |

Chole at low strict on gave reasoning of 384–576 tokens. The earlier chole low runs had `total_min` 473 vs 909.

**FGC-22**
- **Key order:** in all 19 raw texts the top-level keys, ingredient keys and step keys match schema order, with ingredients before steps and `text` first in every step.
- **DraftScanner:** char-by-char and real-chunking feeds both equal the final parse, and neither was ever `broken`.
- **Replay fixtures:** they do not need regenerating.
- **New fixtures:** two captured strict raw texts will still be committed as scanner fixtures in commit 6.

**FGC-23**
- **Silence:** max first-content silence was 15.6 s (a strict-off call), and the strict-on max was 13.8 s. The max inter-delta gap was 0.27 s.
- **Watchdog guard:** 3 × 15.6 = 46.8 s, which is under 60 s, so nothing is flagged.
- **Existing guard:** `STREAM_IDLE_TIMEOUT_S >= 3 * 16.4` still holds. Proposal: keep the 16.4 figure and cite 15.6 as the observed max. `STREAM_IDLE_TIMEOUT_S` and the replay-harness test stay as they are.

## 7. A2: prompt vs all-required

- **No omit instructions:** `OUTPUT_FORMAT_INSTRUCTIONS` and `v7.md` contain none. The "leave it null" lines (97, 115, 151, 200, 214, 232, 242) are compatible with explicit nulls.
- **One conflict:** `v7.md:197`, "Leave `depends_on_previous` at its default; it is a legacy field". Under all-required the model has to emit a value.
- **Output tokens:** explicit nulls do not raise output tokens, so this does not explain any extra output.
- **No prompt change**, per FGC-27. This goes to FGC-27.

## 8. A4: non-default fields

| Field | Strict on | Strict off |
|---|---|---|
| `depends_on_previous=false` | 25/175 steps (14%) | 4/50 (8%) |
| `role` non-required | 3 steps | 0 |
| `servings_source` non-default | 5 | 0 |

- **How graph.py handled the false cases:** strict on has 11 steps with no explicit `depends_on_steps`: 3 stayed independent and 8 were forced sequential. For the 4 strict-off cases, graph.py's two-condition independence check was not run.
- **Acceptance:** every call built a graph and a plan with no errors.
- **Possible cause:** the `v7.md:197` conflict. The off sample is small (50 steps).

## 9. Request dump diffs and input-token delta

All four combinations, in `request-dumps/`:

| Comparison | Result |
|---|---|
| before vs after, strict off, stream | 0 changed lines, same key set |
| before vs after, strict off, blocking | 0 changed lines, same key set |
| strict off → on, stream | exactly one added key, `response_format` |
| strict off → on, blocking | exactly one added key, `response_format` |

- **Message bytes:** the system prompt and the user message are identical in every combination.
- **Strict schema diff:** it shows only `additionalProperties:false`, `required` and the dropped null defaults.
- **Measured delta (strict on − off):** **+2,447 input tokens** on both croissant and kadhi.

## 10. F11-a: predicted vs actual (reprocess, per node)

**Goldens: nothing changes.** The replay-expected snapshots need no regeneration.
- kadhi: predicted `duration_min` 28→30; actual **no change**. The node resolves the min to the typical value for hands-on steps, so the 28→30 correction exists only inside `_verify_duration`.
- croissant and pumpkin: no change, as predicted.

**Non-golden fixtures (actual node changes):**

| Fixture | Node | `duration_min` |
|---|---|---|
| vanilla-cupcakes | preheat oven | 9 → 10 |
| pizza-dough | small bowl stir together | 4 → 5 |
| pizza-dough | remove the dough | 55 → 60 |
| dal-makhni | pan melt butter | 1 → 2 |
| dal-makhni | cook the dal | 28 → 30 |

In every fixture all other plan values (typical, max, starts, ends, windows, totals) are identical. Needs owner approval.

## 11. Versions and request errors (Q6)

- **openai SDK:** 3.16.2 installed. The parity test says an SDK upgrade that breaks it means updating the test, not production code (A6).
- **429 and 5xx:** stay infra, ending as `unavailable`.
- **Other 4xx:** classified as `request`, no retry, ending as `unavailable` with a WARNING. Before this PR it ended as `method_not_grounded`.
- **400 `context_length_exceeded`:** also `request`, tested. It shows the user the "unavailable" copy, which is not strictly true for a recipe that is too long. Flagged in case a separate message is wanted.
- **Refusal copy:** "We couldn't read this recipe." sits in `FAILURE_COPY`, and the body "Paste the recipe text, or try another link." is a new `FAILURE_HINT`. The buttons are the same as `incomplete`.

## 12. Tests

| Check | Result |
|---|---|
| Python, `-m "not llm and not network"` | 1533 passed, 14 deselected (baseline 1489, so +44) |
| Vitest | 1072 passed |
| `tsc -b` | clean |
| mypy --strict on schema/ and schedule/ | clean |
| ruff (changed files) | clean |

**Surprises**
1. The golden-level predictions of F11-a mostly don't materialise (section 10).
2. Strict looks worse on croissant quality (section 4).
3. Provider latency today is about 6 s slower than in S2a.
4. Commit 2 was first made without the code because of a bad `git add` path. It was caught from the stat and redone before anything else depended on it.
