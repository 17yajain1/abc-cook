# Cooking App Evaluation — ABC Cook vs ReciMe (2026-09-24)

> This is an evaluation only. I changed no files and made no commits. The only thing I wrote was frame stills in my scratch folder.
> "Next steps" (§11) is a proposed order of work. Nothing starts until you say so.

**How I watched the videos.** I can't play video, so I pulled 4–5 frames per second from all five clips, plus an extra frame at every screen change (about 460 frames in total), and read every one.
Labels used below: **[Obs]** = seen in the video · **[Code]** = confirmed in the code · **[Rec]** = my recommendation.

**Gaps in the evidence. These limit what I can conclude.**
- **Our app:** recorded in a desktop browser at phone width, not on a phone. The import flow is not in the videos; each clip starts on the Plan screen.
- **ReciMe:** **neither ReciMe video shows its cooking mode.** In the burger clip, "Cook step-by-step" shows a padlock, which suggests it is a paid (Plus) feature. The ReciMe footage covers import, the recipe page and saving only. So the cooking-mode comparison is **our cooking mode vs ReciMe's plain recipe page**, not cooking mode vs cooking mode.

**Added 2026-09-25: third recipe (buttermilk pancakes).** Our `pancake cook.mp4` (61 s, desktop) shows extraction, the Plan (collapsed and expanded), the Map and Ingredients. **Despite the file name, it shows no cooking mode.** The ReciMe `pancake recime.MP4` (33 s) shows import and the recipe page. `pancake recime sc.png` turned out to be *our* app's Ingredients tab, not ReciMe's. The pancake findings are in §2b. They make the extraction and parallelism findings below stronger.

**Added 2026-09-26: CP2-B validation checkpoint closed.** The extraction/graph work
built in response to this evaluation's F3/F5/P0 #2 findings (explicit
`depends_on_steps`, staple-aware independence, optional/alternative steps kept as
notes) has been validated safe across 6 live runs on 2 structurally different
recipes. **This closes CP2-B's own validation checkpoint. It does not resolve P0 #3**
(missing parallelism) — see the closeout note at the end of this file for why those
are different questions, and the priorities table below is unchanged.

**Added 2026-09-27: P0 #1 (§2c, "the dead end") resolved and merged as PR #21**
(commit `37d30f3`, building on PR #19's earlier fix). The conflicting recipe is
named, "Go to it" and "End it and start this" both work, and the replacement is
atomic at the persistence layer — no `A → null → B` window, and the existing
session survives a failed write. See the priorities table (row 1, marked done)
and the PR #21 closeout note at the end of this file for full detail, including
the one documented, in-scope limitation (cross-tab `conflict_changed`
detection).

**Added 2026-09-27: P0 #0 ("stop extraction turning optional, conditional or
alternative instructions into required steps," row 2 of "If we can only do 6
things next") resolved and merged as PR #22** (commit `d7e304d`, branch tip
`8f1b680`). Optional/conditional/alternative instructions no longer become
mandatory scheduled steps; duration is now verified against the recipe's own
text, including a per-side/batch/piece estimate treated as a whole-step total
rather than one unit. Validated offline (the pizza and dal-makhni replays'
full graph output byte-identical to `main`) and with one live Pancakes
re-import through the real pipeline. See the priorities table (row 2, marked
done) and the PR #22 closeout note at the end of this file for full detail,
including the non-blocking observations from the live run.

**Added 2026-09-27: P0 #4 ("cooking-mode reliability: wait screens + wake
lock," row 4 of "If we can only do 6 things next") implemented, opened as
PR #23** (branch `feat/p0-4-wait-screens-wake-lock`, commits `82fb297`/
`0d00d57`, **not yet merged**). Every wait screen now shows a rounded
time-left line and a wall-clock end time computed from the engine's existing
`endsAt`; "It's done" no longer requires a doneness cue; "Started" reads
"I've started it"; the phone's screen now stays on through
`task`/`handsoff_pending`/`wait`/`handover` (M3.4 CP2 Item 1) and sleeps
normally elsewhere. Done ahead of #3 by explicit owner choice. See the
priorities table (row 4, marked PR open) and the PR #23 closeout note at the
end of this file for full detail, including live device verification of all
three wait-screen shapes (with cue, without cue, multi-pan) and the
wake-lock allow-list.

---

## Executive Summary

- **The cooking mode works end to end and is the strongest thing we have.** It shows one task per screen with a big title and one full-width button. Timers use absolute time and survive leaving the app. The "Leaving" screen says what is still running and when it finishes ("around 8:53 pm").
- **The core USP (parallel cooking) did not appear once in either recipe.** Both Plan views end with *"This recipe has long, hands-off waits — but nothing else in the plan can be done during them."* The burger has **26 minutes of waiting** (12 cooling + 14 chilling). Making the batter and seasoning the breadcrumbs are obvious candidates to fill it. The Map for both recipes is a single vertical column. **On this evidence, the cooking-graph concept is not validated. It is not yet visible to a user at all.**
- **The wait screens are the weakest part of cooking mode.** A wait shows no countdown, no time remaining and no end time. A wait with no doneness cue (the 14-minute fridge chill) has **no way to say it's done early**, only "Give it longer".
- **One extraction error would break trust on the first cook.** Oatmeal's alternative microwave method became **step 4, after the stovetop method**, so the app has the user make the oats twice. ReciMe got this right (3 steps).
- **ReciMe is not strong in the areas that matter to us.** Its burger import **lost the whole patty**: it kept 3 ingredients (buns, mayonnaise, lettuce) and stopped at "keep it in the refrigerator", with no shaping, coating, frying or assembly. Its cooking mode needs a subscription. Its real strengths are fast import (5–8 s vs our ~2 min), clean visuals and low noise.
- **Pancakes turn both problems from anecdote into a pattern.**
  - Pancakes are the textbook parallel case: *heat the skillet while you mix the batter*. The app ran it in a straight line. The skillet is heated **after** the batter is mixed, as an 8-minute *hands-on* step.
  - Two optional steps ("If you plan to keep pancakes warm, preheat the oven", and "keep them warm in the oven for up to 45 min") became **mandatory hands-off waits of 10 + 15 min**. That inflated a ~25-minute recipe to "55–70 min".
  - That's the third recipe out of three ending with "nothing else in the plan can be done during them".
  - Two of three recipes had an optional or alternative step turned into a required one.
- **Honest bottom line:** today we are a *calmer, more complete step-by-step reader with robust timers*. We are not yet a *cooking planner*. Fix the wait screens, the screen sleeping, and extraction correctness, then prove parallelism on a recipe that has it, before building anything new.

---

## 1. Current App — What Works

| # | What | Evidence |
|---|---|---|
| W1 | **One task per screen in cooking mode.** Large bold title, body text below, quantities inline, one full-width black "Done" at the bottom. Readable in about 2 seconds. | [Obs] burger_cook 14–30 s, oatmeal 26–51 s |
| W2 | **Leaving mid-cook is handled well.** "Leave cooking" opens a screen saying *"One thing is still on. Timers keep their own time whether the app is open or not. Cover the cooled mixture, around 8:53 pm."* with "Back to cooking" and "End the cook and clear the timers". Timers are stored as an absolute end time; there is no countdown held in memory. | [Obs] burger_cook 58.3 s; [Code] `CookingModeScreen.tsx:45-55`, `viewModel.ts:340-351` |
| W3 | **Doneness cues are extracted and shown** ("until the onions turn translucent", "Comes together nicely"). This is real cooking knowledge a plain recipe page buries in text. | [Obs] Plan expanded rows, task screens |
| W4 | **Hands-on vs waiting split** in each stage header ("Cook ~31 min hands-on · 26 min waiting"), plus a top-level "75–100 min · ~45 min hands-on". Useful before starting. | [Obs] burger 11–13 s |
| W5 | **Collapsed stages summarise the flow** ("Set a pan → Add French beans → Add the soaked mashed → …"). Three cards give an overview of a 14-step recipe. | [Obs] burger 0.3 s |
| W6 | **Complete burger extraction.** All ingredient groups (patty mixture, powdered spices, coating) and 14 steps through "Place the top bun". ReciMe lost most of this recipe. | [Obs] burger 44–51 s vs recime_burger 27–39 s |
| W7 | **Calm visual register.** No ads, upsell banners, ratings prompts or quota counters. In a kitchen that restraint is worth something. | [Obs] |
| W8 | **Wait steps get a different screen from active tasks.** "Started" (outlined) for hands-off steps and "It's done / Give it longer" for waits, vs solid "Done" for hands-on work. The *idea* is right; the execution is covered in §2. | [Obs] |

## 2. Current App — What Doesn't Work

| # | Problem | Evidence |
|---|---|---|
| F1 | **Wait screens show no time.** No countdown, no "about 4 minutes left", no end clock. The user is looking at a pan with nothing to go on. The end time only appears on the *Leaving* screen, and on waits long enough to count as `long_wait`. | [Obs] oatmeal 34.0 s, burger_cook 34–56 s; [Code] `viewModel.ts:271-301`: `note` is set only for `long_wait` |
| F2 | **A wait with no doneness cue can't be finished early.** "Cover the cooled mixture… refrigerate 12–15 min" shows only "Give it longer". The user sat on this screen for about 20 s in the video, then left. | [Obs] burger_cook 37.8–56 s; [Code] `viewModel.ts:287-296`: primary button only when `donenessCue` exists |
| F3 | **Microwave alternative treated as a sequential step** (oatmeal). Plan, Map and cooking mode all run stovetop → rest → *"Microwave method: combine the water or milk, oats…"* → top. | [Obs] oatmeal 5–14 s, 17.9 s Map, 45.4 s cooking mode |
| F4 | **Parallelism never appears** (see §7). | [Obs] both Plan footers; [Code] `PlanScreen.tsx:203-206` (`savedMin === 0`) |
| F5 | **The Plan view reorders the cook.** Steps are grouped by their LLM-assigned stage. "Turn the heat down, add the powdered spices…" sits in **Prep**, above "Set a pan" in Cook. "Make the batter" is in Prep in the Plan but comes *after* "Cover the cooled mixture" in the Map. The two views disagree. | [Obs] burger 2.7 s, 11–13 s vs 56 s Map; [Code] `plan/derive.ts:77` (grouped by `Node.stage`, scheduled order within a stage only) |
| F6 | **Cut-off step labels.** "Remove the pan from", "Take the chilled Veggie", "Add the soaked mashed", "Small saucepan bring", "Put Bread crumbs". "Set a pan" appears twice with different meanings. These labels are the Map nodes and the collapsed-stage summaries. | [Obs] Map, Plan |
| F7 | **Wait-screen titles are sentence fragments that read like facts.** "It completely comes down to room temperature", "It reaches your desired consistency", "Give the oats time to absorb the liquid." A tired cook could read "It completely comes down to room temperature" as *it has cooled*. | [Obs] burger_cook 34.3 s, oatmeal 34.0 s, 41.5 s; [Code] `viewModel.ts:287-291` (the cue becomes the title) |
| F8 | **Text repeated on task screens.** Small label "Turn the heat down", big title "Turn the heat down", then the body starts "Turn the heat down, add…". Same for "Microwave method". A long step (spice/potato) needs scrolling inside the step while "Done" stays pinned. | [Obs] burger_cook 28–29 s, oatmeal 45.4 s; [Code] `copy.ts:79-85` (the long-first-sentence fallback puts the *whole* instruction in the body) |
| F9 | **"Started" is past tense on an action button.** It reads as a status ("it has started"), not "tap when you've started it". | [Obs] burger_cook 32.3 s, oatmeal 31.7–37.4 s |
| F10 | **No sense of where you are in cooking mode.** No "step 3 of 14", no preview of what's next, no way back, no undo after tapping "Done" by mistake. The "5 things to do" count appears only on the entry screen. | [Obs] throughout; [Code] `ActionDescriptor` has no back/undo |
| F11 | **Finishing loops back to the start.** "Finished cooking" returns to the entry screen with "Start cooking / See the plan". | [Obs] oatmeal 52.8 → 54.6 s |
| F12 | **Two start screens.** The red "Start Cooking" on the Plan leads to a second entry screen with a black "Start cooking". That's one extra tap and a colour change for the same action. | [Obs] oatmeal 22.8 s |
| F13 | **The header takes about a third of the screen.** The raw YouTube title ("Crispy Veggie Burger Recipe \| Home Made Veg Burger Patty \| बाज़ार जैसा वेज बर्गर \| Chef Sanjyot Keer") wraps to 5 lines at display size and stays pinned while the list scrolls. ReciMe shortened the same recipe to "Crispy veggie burger". | [Obs] burger all frames |
| F14 | **Ingredients list problems.** An intermediate product ("Veggie patty mixture") is listed as an ingredient. "Salt" appears 3+ times. "Black pepper" has no quantity. There are no checkboxes for gathering ingredients. | [Obs] burger 44–51 s |
| F15 | **Duration disagrees with the recipe text.** "Let the oatmeal simmer · 4 min", but the text says 5 minutes. The header says 20–25 min while the stages sum to about 18. | [Obs] oatmeal 4–5 s |
| F16 | **No wake lock.** The phone screen will sleep mid-cook. (Planned as M3.4 CP2, not built.) | [Code] no `wakeLock` anywhere in `apps/web/src` |

## 2b. Third recipe: Buttermilk Pancakes (ours vs ReciMe)

**What our app did** [Obs, `pancake cook.mp4`]
| # | Finding | Evidence |
|---|---|---|
| PC1 | **The one obvious parallel task wasn't taken.** The Map is a straight line: Dry → Wet → Add melted butter → **Preheat a large skillet (~8 min, not marked hands off)** → If you plan → Sautee → As you finish cooking → Serve. Heating a pan needs no attention and has no inputs, so it should run while the batter is mixed. The Plan footer again says *"nothing else in the plan can be done during them."* | Map 57.5–59.5 s; Plan 33.7 s |
| PC2 | **Optional steps became mandatory waits.** "If you plan · 10 min (hands off)" (preheat the oven *only if* you want to keep pancakes warm) and "As you finish cooking · 15 min (hands off)" (keep them warm for *up to* 45 min) are chained before serving. Result: "Cook ~11 min hands-on · 25 min waiting" and a header of **55–70 min** for a recipe that realistically takes ~25–30 min. **The wrong time is on the first screen.** | Plan 43–47 s |
| PC3 | **Frying, the real hands-on work, is under-counted.** "Sautee For 4 inch · ~3 min". The text says about 3 min *per side*, repeated in batches for the whole batch of batter. That is the longest stretch at the stove, and it's shown as the shortest step. Meanwhile "Add melted butter while whisking" is ~5 min. | Plan 45–46 s |
| PC4 | **Worst label truncation so far.** "If you plan", "As you finish cooking", "Add melted butter while", "Serve a little pat", "Sautee For 4 inch". Several are meaningless out of context, and they're what the Map and the collapsed stages show. | Plan collapsed 30 s, Map |
| PC5 | **"15 servings"** is probably the pancake *count* read as servings. Scaling would be wrong. *(Not verified against the source.)* | Header |
| PC6 | Good: "Some timings are estimates." is honest. Ingredients has quantities and all toppings. The collapsed Prep/Cook/Finish summary fits one screen. **Import took about 25 s** ("Extracting…" 1.1 → 26.7 s), much faster than the ~2 min in the burger era. That's worth confirming as a trend, not a one-off. | 1–27 s; screenshot |
| PC7 | Visual: in the screenshot, the Ingredients tab has a hard black box around it, which looks like a focus outline showing on a normal click or tap. Minor, but it looks broken. *(From one still frame.)* | `pancake recime sc.png` |

**What ReciMe did** [Obs, `pancake recime.MP4`]
- **Import:** clipboard paste → in-app browser → Import → **~8.5 s** "Importing…".
- **Clean title:** "Buttermilk Pancakes Recipe".
- **Ingredients:** grouped as **DRY INGREDIENTS / WET INGREDIENTS**, with bold quantities and small ingredient icons.
- **Steps:** 5, verbatim. The oven note stays a clause inside step 4 ("If you plan to keep cooked pancakes warm, preheat the oven…"). That's the right outcome, because nothing is forced.
- **Highlighting:** ingredient names and temperatures ("350°F", "200°F") are highlighted in blue.
- **No timing model at all.** Same noise as before: "4/5 smart imports", blurred nutrition, a paste-permission prompt.

**What the pancakes change in the evaluation**
1. **Extraction treating optional steps as required is a pattern (2/3 recipes)**, not a one-off. It also *drives* our headline numbers (55–70 min), and every screen trusts those numbers. ReciMe avoids the problem by not modelling at all, so it can't get the timing wrong.
2. **The parallelism miss now has a clean test case.** Pancakes have exactly one obvious concurrent task, a pan needing no attention, and it failed. The observed symptom is that preheating is classed as hands-on and placed after the batter. Whether the cause is the extracted `attention`/edges or the scheduler still needs the graph JSON to confirm, **but this is the recipe to debug it on.** It's small, universal and unambiguous.
3. **Our time numbers are now a liability.** For three recipes the header has been wrong or unverifiable: pancakes badly inflated, oatmeal 4 vs 5 min, burger stage totals not reconciling. A cooking planner whose first number is wrong loses credibility before step 1.

## 2c. Pancake cooking attempt: locked out (`pancake cooking-abc cook.mp4`, 20 s)

**[Obs]** The user taps "Start Cooking" on the pancakes and gets a full-screen *"Already cooking. Another cook is already on. One cook at a time. Finish or leave that one before starting this."* with a single "Close" button. "Close" returns to the Plan. They tried **three times** (1.4 s, 9.2/12.2 s, 15.8 s) with the same result, then stopped recording. **Pancake cooking mode could not be reached at all.**

**[Code]**
- `engine.ts:72-74`: `open()` returns `conflict` for *any* stored session whose `planKey` or `graphId` differs, **before** any staleness check. The 6-hour-minimum stale rule (`constants.ts:19-28`) never applies to a different recipe's session.
- `CookingModeScreen.tsx:132-161`: the conflict screen deliberately offers only "Close". The comment says ending the other cook from here was left out, and that the screen can't name the other recipe because the session doesn't store a title.
- Net effect: **the only way out is to remember which recipe was left running, open it, tap Leave, then tap "End the cook".** The screen gives no hint which recipe that is. The likely culprit is the burger session left mid-chill in the earlier recording (burger_cook 58 s), but that's an inference.

**Why this is P0:**
- It's a total block on the core feature. It will happen to every tester who closes the app mid-cook, which is exactly what real cooks do.
- There's also a second risk (not verified): if re-importing the *same* recipe produces a new `planKey`/`graphId`, a user could be locked out of their own recipe.
- **Direction:**
  - Store the recipe title on the session and name it on the conflict screen.
  - Offer "Go to [recipe]" and "End it and start this".
  - Treat a stale session for a different recipe as ended, not as a conflict.

**Resolved 2026-09-27 (PR #21, `37d30f3`; naming/"Go to it"/"End it and start
this" were already added by PR #19).** The first two direction bullets above are
done. The third is not implemented as literally proposed — a stale/finished
blocking session still shows the conflict screen, it isn't silently treated as
ended — but the conflict screen now leads with "End it and start this" instead
of "Go to it" whenever the blocking session is `stale` or `finished`, making
that case a one-tap resolution without ever discarding a session without the
user acting. See the PR #21 closeout note at the end of this file.

## 3. Recent Changes — Are They Actually Working?

| Change | Verdict | Why |
|---|---|---|
| PR #19 / PR #21 — cooking-session conflict handling | **Working** | The "Another cook is already on" dead end (§2c) is resolved: the blocking recipe is named, "Go to it"/"End it and start this" both work (PR #19), and replacement is now atomic at the persistence layer — the first tap only stages locally, the second performs one guarded write, no `A → null → B` window, and the existing session survives a failed write (PR #21). Conflict-action priority now follows the blocking session's lifecycle state. Verified live in a browser, not just by the automated suite (499/499, typecheck/lint clean). One documented limitation: cross-tab `conflict_changed` detection is out of scope — see the closeout note at the end of this file. |
| M3.4 cooking mode UI (#17) | **Partially working** | The flow completes end to end (oatmeal ran to "is done"). The task screen is strong. Wait screens, progress and recovery are weak (F1, F2, F7, F9, F10, F11). |
| M3.3 session core (#16) | **Working (technically)** | Leave/return and absolute timers behave as designed (W2). What it *exposes* to the user is the gap: it knows `endsAt` but the wait screen doesn't show it. |
| M3.2 plan overview (#15) | **Working, with one structural flaw** | Collapsed stages with flow summaries are good (W5). Grouping by stage can contradict the actual order (F5). |
| M3.1 timing summary (#13/#14) | **Working, low value in this form** | "75–100 min · ~45 min hands-on" is useful. The range is wide, and the numbers don't reconcile with the stage totals (F15). |
| M2.13 hands-on/waiting split, fork/join (#12) | **Visible but unused** | The split shows (W4). Fork/join produced no forks in either recipe. The Map is linear in both. |
| M2.9–M2.11 YouTube import + GPT-5-mini | **Working for completeness, weak on correctness** | Better recall than ReciMe on the burger (W6). Failed on the alternative method (F3), cut-off labels (F6) and titles (F13). Speed is not shown in our clips (the memory note says ~2 min). |
| Auto-save to library (7932e6a) | **Probably working** | The burger shows a "Saved" pill; the oatmeal shows a "Save" button. That fits the oatmeal being imported before this commit, but I can't confirm it from the video. |
| M2.75 Map view | **Technically correct, poor product UX** | Accurate to the graph. For a linear graph it's a column of 14 grey boxes with text too small to read at phone scale. It tells the user nothing the Plan list doesn't. |

**Technically correct but poor product UX:** the wait-screen state model (F1, F2), the Map on linear recipes, the stage-grouped Plan (F5), the "nothing else can be done" footer (true to the graph, but no user wants to read it), and "Started".

## 4. ReciMe Analysis (what the videos actually show)

**Flow shown:** home → "+" → *Add a recipe* sheet (social media / photo / text / web / write / search by creator) → in-app browser → paste YouTube link → "Import to ReciMe" → "Importing…" (**about 8 s oatmeal, about 5 s burger**) → recipe preview → Save → "Recipe saved!" → "How did we do?" rating prompt. The burger clip starts in YouTube (copy link), then ReciMe's "URL detected in your clipboard → Paste" banner.

**Does well**
- **Import speed and flow.** A 5–8 s import. It detects the link on the clipboard, and after import it asks "We found a recipe website in the caption. Does that look correct?"
- **Clean titles:** "Crispy veggie burger" instead of the raw YouTube title.
- **Recipe page:** serif section headings, **bold quantities**, small ingredient icons, and ingredient names highlighted blue inside the steps (so you see where each ingredient is used). Calm, generous spacing. Numbered steps are the original recipe text.
- **Correct oatmeal:** 3 steps. The microwave note is left out, not turned into a step.
- **"Report mistake"** is always visible. They expect extraction errors and give users a way to flag them.

**Does poorly**
- **The burger extraction is broken.** 3 ingredients under the wrong heading ("BUTTER FOR TOASTING THE BURGER BUNS": buns, mayonnaise, lettuce). The instructions stop at step 7, "Keep it in the refrigerator to shape the patties". A user following it would never fry a patty.
- **Cooking help needs a subscription.** "Cook step-by-step" shows a padlock, nutrition is blurred, and smart imports are rationed ("5/5 smart imports left. Try Plus for free").
- **Noise:** quota banners on every screen, an onboarding checklist, a rating prompt straight after save, and "Unlock faster importing".
- **No timing model** is visible at all: no durations, no hands-on vs waiting, no stages, no parallelism.

## 5. Our App vs ReciMe

| Area | Our App | ReciMe | Important Observation |
|---|---|---|---|
| Recipe overview | Title, servings, time range, hands-on time, 3 collapsible stages | Photo, clean title, ingredients, numbered steps, nutrition (locked) | They win on readability. We win on *shape* (how long, how much is hands-on). |
| Starting cooking | Red "Start Cooking" → entry screen → black "Start cooking" | Behind a subscription (not shown) | We have it free, with one extra tap. |
| Understanding what to do | One task at a time, big title | Read the whole list | Ours is better *during* cooking; theirs is better for reading ahead. |
| Step-by-step | Works; repeated title/label/body text; long steps scroll | Not shown | Tighten our copy before comparing. |
| Parallel cooking | Claimed in concept, **absent** in both recipes | Absent | Neither app delivers it today. This is the gap we exist to fill. |
| Timers | Absolute time, survives backgrounding, **no countdown shown** | Not shown | We have the engine and haven't surfaced it on screen. |
| Progress | None inside cooking mode | Numbered list (implicit) | A plain numbered list gives more sense of progress than our cooking mode does. |
| Task state | Hands-on / hands-off / wait screens differ | n/a | Right idea; "Started" and the fragment titles blur it. |
| Completion | "X is done" → back to the start screen | n/a | The loop back to the start is confusing. |
| Navigation | Tabs (Cooking Plan / Ingredients) + sub-tabs (Plan / Map) + a text toggle | Single scrolling page | We have 3 levels of navigation on one screen. |
| Cognitive load | Low in cooking mode, high on the Plan screen (tiny grey text, 5-line title) | Low | The Plan screen is our heaviest screen. |
| Information density | The expanded Plan shows everything at once in 13–14 px grey | Moderate, well spaced | Our density is high for too little extra information. |
| Visual hierarchy | Strong in cooking mode, weak on the Plan | Consistent | |
| Mobile usability | Big "Done"; small "Leave cooking" and "Give it longer" text links | Big targets, bottom tab bar | |
| Error recovery | Can leave and return; **no undo/back** | "Report mistake", "Edit recipe" | They admit mistakes happen; we assume the graph is right. |
| Extraction quality | Complete (burger); wrong on the alternative method (oatmeal) | Correct (oatmeal); broken (burger) | Both fail, differently. Ours fails in a way cooking mode then *enforces*. |
| Overall flow | Plan → cook → done | Import → read → save | Different products: they're a recipe *keeper*, we're trying to be a cooking *runner*. |

## 6. Product Differentiation

**Already different in a way that matters:** a free, robust, one-task-at-a-time cooking mode with timers that survive the phone sleeping. Doneness cues. Hands-on vs waiting time. Complete extraction on a hard recipe (burger).

**Could become a real advantage:**
- **Filling wait time.** The burger's 26 minutes of cooling and chilling is exactly the "oh, I can make the batter now" moment `CLAUDE.md` describes. It isn't happening yet.
- **A wall-clock plan** ("chilled around 8:53 pm") across wait screens.
- **A "what's cooking" view when several things run at once.** It exists in code (`WhatsCookingSheet`) but never triggered in these recipes.

**Fake differentiation (right now):**
- **The Map view.** On linear recipes it is a list drawn as boxes. It won't earn its place until a recipe with real branches renders legibly on a phone.
- **Stages** as LLM-assigned categories that can contradict the order you actually cook in.
- **The "nothing else can be done" footer.** It explains an absence of value.
- **Time ranges** ("75–100 min") that don't add up across views make the precision look false.

**Why would a user pick us over ReciMe today?** Only if they want free guided cooking with reliable timers. **Not** for parallelism, which is the reason we exist and which nobody can see yet.

## 7. Parallel Cooking / Cooking Grid Evaluation

| Question | Answer from the evidence |
|---|---|
| Does the user understand the grid? | There is no grid to understand. The Map is a single column in both recipes. |
| Is the relationship between tasks clear? | Arrows are clear. The bracket lines on the left (skip edges) are unexplained, and the node text is too small to read. |
| Active / waiting / blocked / next? | Cooking mode shows only *current*. None of active, waiting, blocked or next is shown alongside anything else. |
| Is parallelism useful or just visual complexity? | Untested: none was produced. |
| Does it help with multitasking? | Not demonstrated. |
| Dependencies clear? | In the Map, yes. In the Plan they contradict it (F5). |
| Prevents missing something? | Partly. One step at a time helps. No progress indicator or undo hurts. |
| Reduces total time? | Not in either recipe (`savedMin === 0`). |

**Burger, specifically.** Making the batter (maida + cornflour + water) and seasoning the breadcrumbs don't need the patty mixture. A cook would do them during the 12 + 14 minutes of cooling and chilling. The scheduler scheduled neither into those windows.
- **[Obs]** The Map draws both *after* "Cover the cooled mixture" in one chain. That suggests the extracted graph made them depend on it (the extractor following text order).
- **Root cause not verified:** the imported graph isn't stored in the repo, so I couldn't inspect its edges.
- **Most important diagnostic to run next:** decide whether this is an extractor over-serialisation problem or a scheduler problem. The whole USP depends on it.

**Verdict:** **Not validated. It needs major work, and the first problem is upstream of the UX.** Neither recipe demonstrated the concept, so any UX judgment about the "grid" is premature. Validate it on a recipe where parallelism provably exists (for example the Kadai Paneer or biryani fixtures) before investing further in the Map.

## 8. UX & Design Audit (specific screens)

- **Plan screen:**
  - The pinned header eats a third of the screen (F13).
  - Three navigation levels (Cooking Plan/Ingredients → Plan/Map → Show full recipe/overview).
  - Expanded rows are dense 13–14 px grey-on-beige text. "(hands off)" and "(low attention)" are tiny parentheticals, when they're the most important scheduling facts.
  - The stage-tint difference between stages is barely visible.
- **Map:** node text is about 9–10 px at phone scale. The legend (Prep/Cook/Finish dots) sits below the fold on the burger. The left bracket lines have no explanation.
- **Cooking task screen:** the best screen we have. Fix the repeated title/label/body (F8), and the grey quantity line under the body is easy to miss. That is the line you need while holding a spoon.
- **Wait screen:** a large empty middle where the time should be (F1). The title is a fragment (F7). "Give it longer" is a small text link, and on the fridge step it's the only control (F2).
- **Leaving screen:** good. The warmer ground colour signals "you're stepping away" clearly.
- **Done screen:** fine copy, wrong destination (F11).
- **Consistency:**
  - Red "Start Cooking" (Plan) vs black "Start cooking" (entry).
  - "Save" button vs "Saved" pill.
  - "Show full recipe" vs "Show overview" toggling on the same link.
- **Overall feel:** cooking mode feels deliberate and polished. The Plan and Map screens still feel like prototypes: text-heavy, low contrast and grey-on-grey.

## 9. Engineering / Architecture Risks

**Confirmed issues**
1. The wait view has `endsAt` but renders no remaining time for normal waits (`viewModel.ts:271-301`).
2. There's no "done" action for waits without a doneness cue (`viewModel.ts:287-296`).
3. There's no undo/back in `ActionDescriptor`. Tapping "Done" by mistake can't be recovered from the UI.
4. The Plan view groups by `Node.stage` (`plan/derive.ts`), so the order shown on screen can differ from the scheduled order.
5. There's no wake lock.
6. `splitCopy` falls back to "whole instruction as body", which guarantees repeated text on long first sentences (`copy.ts:79-85`).

**Potential risks**
- **Extraction correctness is now load-bearing.** Cooking mode enforces the graph, so an extraction error (F3) is no longer a cosmetic mistake. The user acts on it at the stove. There is no in-app "this step is wrong / skip it" path.
- **Imported graphs aren't kept anywhere I can inspect** (the library is in localStorage), so production failures like the burger's missing parallelism can't be diagnosed after the fact.
- **Stage labels come from the LLM** and drive both grouping and tint. If they're wrong, both the layout and the colours are wrong.
- **Several screens state times that disagree** (header range vs stage sums vs step durations vs the recipe text). Each is derived separately, which erodes trust.

**Recommendations**
- [Rec] Save every import's graph and plan JSON (the dev/local store is enough) so failures can be debugged.
- [Rec] Add both of these recipes as golden fixtures once their expected behaviour is decided: oatmeal = no microwave step; burger = batter in the chill window, if the owner agrees that's correct cooking.

## 10. Priorities

### P0 — Must fix
1. **Wait screens show no time and can't be ended early.** F1 and F2. On a phone this means staring at a blank screen next to a pan. *Direction:* every wait shows remaining time and its end clock (from `endsAt`), and every wait gets an "It's done" action. *Impact:* the biggest trust gain per line of code.
2. **The screen sleeps (no wake lock).** F16. The screen going dark mid-cook defeats a cooking mode. *Direction:* ship the already-planned M3.4 CP2. *Impact:* makes the app usable at the stove at all.
3. **Extraction turns alternatives or notes into mandatory steps.** F3 (plus F15's duration mismatch). The user is told to cook the dish twice, and cooking mode enforces it. *Direction:* extractor prompt and validation for alternative methods and optional notes, plus a check that durations match the text; add a regression fixture. *Impact:* avoids first-cook failures that lose the user.
4. **The USP is invisible.** §7 and F4. Without it the product is "another step reader". *Direction:* diagnose the burger graph (edges vs scheduler), then prove parallelism end to end on one real recipe. *Impact:* decides whether the product thesis holds.

### P1 — Important
- The Plan view order must match the cooking order (F5).
- Readable, complete step labels (F6). Clean recipe titles (F13).
- Wait titles written as instructions, not fragments ("Let it cool to room temperature", not "It completely comes down…") (F7).
- Remove repeated text on task screens (F8). Rename "Started" to something like "I've started it" (F9).
- Progress plus a next-step preview plus undo/back (F10). Done → back to the library or plan, not the start screen (F11). One start screen (F12).

### P2 — Improvement
- Ingredients: remove intermediates, merge duplicates, add checkboxes for gathering ingredients (F14).
- Plan density and contrast. Promote "hands off" and "low attention" from parentheticals to visible marks.
- Bigger targets for "Leave cooking" and "Give it longer".
- Consistent button colours and Save/Saved states.
- Hide the Map when the graph is linear, or make it legible.

### P3 — Nice to have
- Ingredient icons and highlighted ingredient names in steps (as ReciMe does).
- A recipe photo.
- A "Report a mistake" entry point.

## 11. Recommended Next Steps (proposal; nothing starts without your go-ahead)

1. **Fix the wait screens** (remaining time + end clock on every wait, "It's done" always available, rename "Started"), then **ship wake lock** (CP2 is already planned). Small, contained, and it fixes the worst in-kitchen failures.
2. **Diagnose the burger's missing parallelism.** Capture its graph JSON and check the edges into "Make the batter" and "Put Bread crumbs". Decide whether this is an extractor or a scheduler problem. Stop and report. Any change to the expected plan is your product decision.
3. **Extraction correctness pass:** alternative methods, duration vs text, complete labels, clean titles. Validate on oatmeal and burger plus the existing golden fixtures.
4. **Prove the USP on one recipe that truly has parallelism** (a Kadai Paneer–style dish). Record a real cook **on a phone** from import to done.
5. **Plan view follows cooking order;** add progress, next-step preview and undo in cooking mode.
6. **Test with 3–5 real cooks.** Only then return to Map polish, animation, or anything new.

## 12. Honest Assessment

1. **Meaningfully better than a normal recipe app for actually cooking?** *Slightly, for linear recipes:* one-step focus and reliable timers. *Not yet for the reason we exist:* no parallel cooking appeared.
2. **Is the parallel concept understandable to a normal user?** Unknown. It never appeared. The only place it surfaced was a footer saying it couldn't be done.
3. **Ready for real user testing?** Not quite. Fix P0 items 1–3 first. Otherwise testers will report the blank wait screen, the screen dimming and the double oatmeal, and you'll learn nothing about the concept.
4. **Single biggest weakness?** The core value (filling waits with parallel work) is invisible, and I can't tell from the evidence whether that's a graph problem or a scheduler problem.
5. **Single strongest thing?** The cooking-mode session engine and task screen: one clear action at a time, timers that survive leaving, and an honest "one thing is still on, around 8:53 pm".
6. **What not to build yet?** Quick-commerce ordering, meal plans, cookbooks/social, nutrition, more import sources, Map animation, and voice control.
7. **Improve before adding features?** The wait screens, wake lock, extraction correctness, and Plan order = cooking order.
8. **What ReciMe teaches us:** fast import, clean titles, bold quantities and ingredient highlighting, one scrolling page with no navigation layers, and admitting mistakes ("Report mistake").
9. **Where not to copy ReciMe:** paywalling cooking help, quota banners, onboarding checklists, rating prompts straight after save, and a plain recipe page as the main experience. Our reason to exist is the *run*, not the *record*.
10. **What I'd do next:** step 1 (wait screens + wake lock) this week, because it's cheap and removes the worst stove-side failures. Then step 2 (diagnose burger parallelism), because it decides whether the product thesis holds. Everything else waits on that answer.

### If we only do 3 things next
1. **Make every wait screen show time left and an end clock, with an "It's done" button, and turn on wake lock.**
2. **Find out why the burger's 26 minutes of waiting got no parallel tasks** (graph edges vs scheduler), and fix the cause.
3. **Stop extraction from turning alternatives or notes into steps** (the oatmeal microwave), then re-record one real parallel recipe on a phone.

---

## If we can only do 6 things next (updated with the pancake evidence)

Ordered by what to do first. Each item has its priority. **No P2 or P3 item made the top 6, and that is deliberate.** While the first screen shows a wrong total time and the concept never appears, polish is wasted. The P2/P3 items are listed after the table so they aren't lost.

*Revised after the pancake cooking clip (§2c): the lock-out goes in at #1. Wait screens and wake lock merge into one "cooking-mode reliability" item to keep the list at six.*

| # | Priority | Do this | Why this and not something else | Test it on |
|---|---|---|---|---|
| 1 | **P0 — Done** (PR #19 + PR #21, `37d30f3`) | **Removed the "Another cook is already on" dead end.** Names the other recipe, offers "Go to it" and "End it and start this" (the first tap only stages the replacement locally; the second, "Start cooking" tap performs one atomic, guarded write), preserves the existing session if that write fails, and orders the two actions by the blocking session's lifecycle state (`active`/`unknown` → "Go to it" first; `stale`/`finished` → "End it and start this" first) rather than a fixed order or silent expiry. | It completely blocked cooking mode, and every tester who walked away mid-cook would hit it. It was small and contained (engine `open()` + `ConflictScreen`), as predicted. | Verified live in a browser: two-tap staging with zero writes on the first tap, survival of a tab reload before the second tap, a genuine (not mocked) storage-write failure with a successful retry, and all four lifecycle states plus `canGoTo=false`. Automated: 499/499, typecheck/lint clean. See the PR #21 closeout note below. |
| 2 | **P0 — Done** (PR #22, `d7e304d`) | **Stopped extraction from turning optional, conditional or alternative instructions into required steps**, and duration is now checked against the recipe text. "If you plan…", "keep warm up to…", "Microwave method:" become notes on a step, not steps, including a follow-on with no marker of its own that only applies because an earlier instruction was optional. Frying repeated in batches ("about 3 minutes per side… in batches") is now treated as a whole-step estimate, not one unit. | It broke 2 of 3 recipes and created the wrong headline time (pancakes 55–70 min). Cooking mode then *enforces* the mistake. Every later fix sits on top of it. | Verified offline (514 tests; pizza and dal-makhni replays byte-identical to `main`) and live: one real Pancakes re-import through the production pipeline confirmed both optional instructions became notes (not nodes), the frying duration was floored correctly, no oven-wait nodes appeared, and the header inflation is gone (14–24 min vs. the previous 55–70). See the PR #22 closeout note below. |
| 3 | **P0** | **Diagnose and fix the missing parallelism**, pancakes first. Capture the graph JSON and check preheat's `attention` and its incoming edges. Then do the burger's batter and breadcrumbs vs the 26-minute chill. Report the cause before changing any expected plan. **Still open as of the 2026-09-26 CP2-B closeout** — that validation confirmed the tested extraction/graph change is *safe*, not that any recipe's graph captures the *most* parallelism its source supports. Different question; not answered by it. | The USP has appeared zero times in three recipes. Pancakes are the smallest possible test (one pan, one batter). If they can't show "heat the pan while you mix", nothing will. | Pancakes, then burger |
| 4 | **P0 — PR open** (PR #23, not yet merged) | **Cooking-mode reliability: wait screens + wake lock.** Every wait shows time left and an end clock, "It's done" is always available, "Started" becomes "I've started it", and the screen stays on (M3.4 CP2 Item 1). | These are the worst failures during an actual cook. The data (`endsAt`) already existed and CP2 was already scoped, so this was mostly UI. | Verified live on an Android phone over a secure origin (`adb reverse`): Kadai Paneer (with-cue wait), Chicken Biryani (no-cue wait), the synthetic two-pan "Bowl" recipe (multi-pan wait), and wake-lock hold/release across screen types. Automated: 517/517, lint clean. Oatmeal/burger not re-verified this round — see the PR #23 closeout note. |
| 5 | **P1** | **Readable plan:** Plan order = cooking order, complete step labels (no "If you plan", "Add the soaked mashed"), clean titles ("Buttermilk pancakes", not the YouTube title), servings vs yield. | Every screen before cooking starts depends on these. ReciMe shows that clean titles and plain labels are the minimum users expect. | All three recipes |
| 6 | **P1** | **Orientation and recovery in cooking mode:** "step n of N" plus a next-step preview, undo after "Done", finishing goes to the library (not back to the start screen), one start screen. | This lets the user trust they won't miss a step, and recover when they tap the wrong thing with wet hands. | Real cook on a phone, one parallel recipe |

**After these six: re-record all three recipes on a phone, end to end, and run a first round with 3–5 real cooks.**

**Parked: P2 (next after the six):**
- Ingredients cleanup: no intermediates like "Veggie patty mixture", no duplicate salt, gathering checkboxes.
- Plan text density and contrast: make "hands off" a visible mark, not a parenthetical.
- Bigger "Leave cooking" and "Give it longer" targets.
- Consistent button colours and Save/Saved states.
- Hide the Map for straight-line graphs, or make it legible.

**Parked: P3:**
- Ingredient and temperature highlighting inside steps, and ingredient icons (ReciMe style).
- Group ingredients as Dry/Wet as written in the source.
- A recipe photo.
- A "Report a mistake" link.
- The focus outline on the tab (PC7).

---

## CP2-B Validation Closeout (2026-09-26)

**This closes the CP2-B validation checkpoint. It does not resolve P0 #3.** Full
technical detail lives in `docs/M2.9-youtube-import-design.md` (§4.7's design rules,
§13's closing entry) — this note is the pointer for this evaluation's own priority
list, not a duplicate of it.

CP2-B (explicit `depends_on_steps`, staple-aware independence, optional/alternative
steps kept as notes, prompt v3) is the extraction/graph work undertaken in response to
this evaluation's F3, F5 and P0 #2 findings. Producer/consumer extraction under CP2-B
is now validated:

- **C4** (burger recipe): 3 live runs against the real production import path.
- **Cross2** (Vegan Ramen — structurally different: 5 independent producer branches
  converging at assembly, not a linear chain): 3 live runs.
- **6 live runs total, across 2 structurally different recipes.**
- Producer→consumer relationships were recovered through direct label matching and,
  where that wasn't sufficient alone, through explicit dependency relationships.
- All 6 runs remained safety-valid across the tested safety invariants.
- Real repair was exercised on live, naturally-occurring violations; offline replay
  matched the live repaired graph exactly in both cases where repair fired.
- No D-build or D-unexplained findings.
- Model variance affected parallelism/performance in some runs but did not create a
  safety failure in any tested case.
- **Therefore, no CP2-B production change is justified from this validation.**

**Not claimed:**
- **Not** that all recipe/source structures are validated — only the 2 tested shapes,
  both richly-grounded (manual captions, or a full written method).
- **Not** that acquisition robustness is solved. Screening for the Cross2 validation
  rejected 2 of 3 candidate recipes before they ever reached the extractor: one had
  no method text anywhere in its available source; one has a real caption track that
  production's own caption-language-selection logic currently fails to reach (an
  `es-US`-tagged video whose original-language auto-captions exist but aren't
  selected, falling back to a translated track that was then rate-limited).
- **Not** that maximum parallelism is solved. CP2-B validation confirms the tested
  change is *safe*; it says nothing about whether a given recipe's graph captures the
  most parallelism its source actually supports. **P0 #3 (pancakes first) stays
  open** — see its row in the priorities table above.

**Deferred follow-ups (recorded, not opened as implementation tasks):**
1. Acquisition robustness — caption-track selection/fallback, and the rejected-
   candidate findings generally.
2. Model variance / parallelism optimization — relevant if and when maximum
   parallelism becomes a product priority; not scheduled now.

---

## PR #21 Closeout — P0 #1 Resolved (2026-09-27)

P0 #1 (§2c; row 1 of "If we can only do 6 things next" above) — the "Another
cook is already on" dead end — is resolved. Merged to `main` as **PR #21**,
commit `37d30f3`, building on PR #19's earlier fix (which had already added
naming, "Go to it" and "End it and start this").

**What changed:**
- The conflict screen identifies the blocking recipe by name and shows a
  message appropriate to its lifecycle state (`active`/`stale`/`finished`/
  `unknown`).
- "Go to it" and "End it and start this" are both offered wherever the
  blocking session can be navigated to; where it can't (e.g. an unsaved
  import), only "End it and start this" is offered — unchanged from PR #19.
- Replacement is now atomic at the persistence layer. The first "End it and
  start this" tap only stages the replacement locally — no write. The second,
  "Start cooking" tap performs one guarded write that both ends the blocking
  session and starts the new one. There is no `A → null → B` window.
- If that write fails, the existing (blocking) session is preserved, the
  pending replacement stays retryable, and the user sees an inline retryable
  error ("Couldn't save on this device — storage may be full.").
- The two conflict-screen actions are now ordered by the blocking session's
  lifecycle state: `active`/`unknown` lead with "Go to it"; `stale`/`finished`
  lead with "End it and start this". This supersedes the "let a stale session
  expire silently" idea originally proposed in §2c's direction bullets with a
  one-tap resolution to the same effect, without ever discarding a session
  without the user acting.

**Verification:**
- Automated: 499/499 tests passing, TypeScript and lint clean.
- Manual, against a live running instance of the branch: the two-tap
  zero-write staging behavior (confirmed via `setItem` call-count
  instrumentation, not just visual inspection); the staged replacement's
  survival of a tab reload before the second tap; a genuine (not mocked)
  browser `QuotaExceededError` on the atomic write, confirming the blocking
  session survives and the retry succeeds once storage is freed;
  conflict-action priority for all four lifecycle states plus `canGoTo=false`,
  each reached via crafted session data exercising the real selectors; and
  that an ordinary (non-conflict) "Start cooking" still goes through the
  unchanged `session.start` path.

**Known limitation — an explicit scope boundary, not a bug:**
`store.replace`'s `expectedPlanKey` guard — the mechanism behind the
`conflict_changed` rejection (the blocking session changing between the first
and second tap) — is implemented and covered by an automated store-level
test. Cross-tab / storage-event detection was explicitly **not** implemented
and was kept out of scope by design. A real two-tab manual test confirmed the
consequence: the store never re-reads `localStorage` outside its own writes
and has no `storage` event listener, so a session change made in another tab
is invisible to the tab holding the staged replacement — `conflict_changed`
cannot currently be triggered by a cross-tab change. This was decided as an
explicit scope boundary during implementation, not discovered afterward as a
gap.

## PR #22 Closeout — P0 #0 Resolved (2026-09-27)

P0 #0 ("If we can only do 6 things next," row 2) — extraction turning
optional, conditional or alternative instructions into required steps, and
duration not checked against the recipe text — is resolved. Merged to `main`
as **PR #22**, commit `d7e304d` (branch tip `8f1b680`).

**What changed:**
- A `role_cue` not grounded in a step's own text ("borrowed" from elsewhere
  in the recipe) now demotes a step only when it chains, via
  `attach_to_step`, to the specific earlier optional/alternative instruction
  it actually belongs to — never any other unrelated optional wording in the
  source.
- A step the model marks required outright is never demoted based on its
  wording, but now gets a review warning if its text opens with an optional
  marker ("If you", "Optional", "Alternatively", "`<word> method:`").
- Duration is now independently verified against each step's own text, the
  same way `attention_cue`/`freshness_cue` already were: a stated duration
  with no matching phrase in the text is downgraded to an estimate; a
  per-side/batch/piece time ("about 3 minutes per side … in batches") is
  floored to a whole-step total instead of counted as one unit; "up to N
  minutes" is treated as a holding limit, never the step's own duration.
- The extraction prompt (v4) adds the model-facing half of the above: attach
  a marker-less optional follow-on to the earlier optional instruction it
  depends on, give per-unit times as the whole step's total, and treat "up
  to N" as a holding limit.

**Verification:**
- Automated: 514 offline tests passing (249 in the targeted
  extraction/schedule suite), ruff and mypy clean.
- The pizza-dough and dal-makhni replay fixtures' full graph-build output
  verified byte-identical to `main` before and after every change.
- One live Pancakes re-import through the real production pipeline (prompt
  v4): both the oven-preheat and keep-warm instructions correctly became
  notes, not nodes; the keep-warm note's cue was correctly attached through
  its actual optional parent, not an unrelated cue; the per-side frying
  duration was floored to at least the deterministic minimum; no oven-wait
  nodes appeared; and the header inflation is gone (14–24 min vs. the
  previous 55–70).

**Non-blocking observations from the live run (not fixed here, recorded for
later):**
- Both optional notes attached to the skillet-preheat step rather than the
  frying step, via the existing nearest-required-step fallback.
- Three "ingredient not found" warnings (component-label mismatches).
- One validation violation on this run triggered the existing
  repair-then-degrade path; the final graph still validated and correctly
  kept both notes as notes.

## PR #23 (open) — P0 #4 Implemented (2026-09-27)

P0 #4 ("If we can only do 6 things next," row 4) — cooking-mode reliability:
wait screens show no time and can't be ended early without a doneness cue
(F1, F2), and the screen sleeps mid-cook (F16) — is implemented and opened as
**PR #23** (branch `feat/p0-4-wait-screens-wake-lock`, commits `82fb297`
wait screens + `0d00d57` wake lock). **Not yet merged.** Done ahead of #3 by
explicit owner choice (P0 #3, missing parallelism, stays open — see below).

**What changed:**
- Wait screens (`wait`/`long_wait`) show a rounded time-left line ("About N
  min left" / "Less than a minute left" under a minute — `Math.ceil`, so the
  number never ticks up as time passes) and a wall-clock "Ready around ..."
  end time, both computed from the engine's existing `endsAt`/`now` — no
  scheduler or engine change, per `CLAUDE.md`'s renderer rule.
- "It's done" is unconditional on a single-subject wait (F2) — it no longer
  requires a doneness cue; the engine already allowed `markDone` on any
  running hands-off node at any time, only the view was hiding the button.
  The multi-pan wait (no single subject) lists each pan's own end clock
  instead of a single aggregate time, and still has no primary action.
- "Started" is renamed "I've started it" (F9).
- M3.4 CP2 Item 1 (wake lock, F16): holds `navigator.wakeLock` while Cooking
  Mode shows `task`, `handsoff_pending`, `wait` or `handover`; releases
  everywhere else, including `long_wait` and `sitting_break` (owner decision:
  those states mean the cook has walked away). The CP2 plan's hook-placement
  instruction was corrected against current `main`, which now has two early
  returns before the resolved view that didn't exist when that plan was
  written.

**Verification:**
- Automated: 517/517 tests passing, typecheck/lint clean.
- Live, on an Android phone over a secure origin (`adb reverse` to
  `localhost:5173` — a LAN-IP origin has no `navigator.wakeLock`): the
  with-cue wait (Kadai Paneer's "Cook tomato base"), the no-cue wait
  (Chicken Biryani's "Soak rice"), and the multi-pan wait (the synthetic
  two-pan "Spiced Lentil and Rice Bowl" recipe) all showed the correct
  time-left/end-clock/primary behavior. Wake lock held through `task`/`wait`
  and slept normally on `entry`/`sitting_break`/`done`.
- **Oatmeal and Burger — the two recipes this evaluation's own F1/F2/F16
  findings were based on — were not re-verified this round.** They exist
  only in the owner's browser localStorage, not as repo fixtures, and
  weren't reachable from the secure-origin device used for this PR (a
  different phone/Chrome profile than wherever they were originally saved).
  Worth a follow-up pass once merged.

## Current Priority (2026-09-27)

With P0 #1, P0 #0 (#2) done, and P0 #4 (cooking-mode reliability) implemented
and awaiting merge as PR #23 (above), the next open item in the "If we can
only do 6 things next" table is **#3 — the missing parallelism** (pancakes
first), deferred by explicit owner choice while #4 went first. Nothing in
P0 #4's work touched the scheduler or added/changed parallelism — it is
confined to `cooking-mode/` (the view layer and the new wake-lock module) —
so #3 remains exactly where the CP2-B closeout (2026-09-26) left it: that
validation confirmed the tested extraction/graph change is safe, not that any
recipe's graph captures the most parallelism its source actually supports.

Recommended order from here: **#3**, then the P1 items (#5 readable plan, #6
orientation/recovery).

## P1 #6 Implemented (2026-09-28)

P1 #6 ("Orientation and recovery in cooking mode," row 6 of the agreed top six,
F10/F11/F12) — no sense of position in the cook, no recovery from a mis-tap,
finishing loops back to the start, two start screens — is implemented on
branch `feat/p1-6-orientation-recovery` (not yet opened as a PR), per
`notes/p1-6-orientation-recovery-plan.md`. The render checkpoint (§E) was
shown and approved before steps 6–8 (App.tsx wiring, docs) proceeded.

**What changed:**
- `task`/`handsoff_pending` show "Step n of N" (`cooking/select.ts`'s
  `stepPosition` — the live running/done count, never a cumulative history
  counter or `stepContext`'s order index, which regresses on a skip) and
  "Next: ‹label›" (the screen's own primary action run through the real
  engine on a copy of the session, then `current()`).
- A 10 s "Back to ‹step›" undo link (`UNDO_WINDOW_MS`, `cooking/constants.ts`)
  on `task`, `handsoff_pending`, `wait`, `long_wait`, `sitting_break` and
  `done` — timed from the persisted `lastTransition.at`, so it survives
  backgrounding. Never on `handover` or the away/stale/entry screens.
- "Finished cooking" now navigates to the Library (F11); "End the cook and
  clear the timers" (leaving/returning) navigates to that recipe's Plan
  instead — two distinct exits where one `end` action previously conflated
  them. Stale's "Start again" is unchanged (the restart is itself the
  confirmation).
- The Plan's "Start Cooking" now starts the session itself when none is open,
  landing directly on step 1 (F12) — the black entry screen is no longer a
  second confirmation on the canonical path. It remains the resume/stale/
  staged-replace/storage-failure screen.
- `docs/DESIGN_SYSTEM.md` § *Resolved in P1 #6* records the calm-screen
  step-counter/preview exclusion reversal and the four decisions above;
  `docs/ROADMAP.md`'s M3.5 row marks the undo control shipped.

**Verification:**
- Automated: 532/532 tests passing (`stepPosition`, the multi-producer
  acknowledge case, the undo-link window, and `startCooking.ts`'s "one start
  path" all newly covered), typecheck/lint clean.
- Live, in a desktop browser at the 390×844 mobile column: drove Kadai Paneer
  through its parallel-prep window (Step n of N and Next: ‹label› both
  correct at every step, including the last-in-window preview naming the
  step blocked behind the wait) and confirmed the undo link via a DOM read
  immediately after tapping Done (screenshot capture in this environment
  reliably takes >10 s, past the window, so the link's *disappearance* was
  what showed up in screenshots — its presence was confirmed by reading the
  page immediately instead). Drove 2-Minute Maggi end to end: one start
  screen, "Finished cooking" → Library, reopening started a fresh cook with
  no stale conflict. Confirmed "End the cook and clear the timers" from
  Strawberry Shortcake returns to that recipe's Plan, not the Library or a
  stale entry screen.
