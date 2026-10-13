# Market research — food logging, Indian meals, photo-assisted nutrition (ABC Cook)

Status: research only. Not authorization to change the roadmap or implement anything.

Research date: 2026-10-11. Evidence labels used throughout:
- **[study]**: peer-reviewed or academic paper, read directly unless noted.
- **[official]**: vendor store listing or help documentation. Describes intended function, not satisfaction.
- **[vendor-claim]**: a performance claim by the vendor or a competitor's blog. Not independent.
- **[observed-video]**: seen in the three supplied screen recordings.
- **[anecdote]**: an individual user quote or review.
- **[interpretation]**: reasoning from the above.
- **[recommendation]**: proposed action.

---

## 0. Method and limitations (read first)

- **Reddit was not reachable.** The research tool refuses reddit.com for search and fetch alike. **No subreddit-level
  findings are reported.** None are invented, and no "Reddit consensus" is claimed. This is the biggest
  gap. A manual pass by the owner is listed in §10.
- **Google Play pages failed to render**, so no Play reviews were read. Apple App Store listings showed only
  **4 reviews each** for MyFitnessPal, ReciMe and Healthify, and 0 for CopyMenu. That is illustration, not a sample.
- The strongest user evidence is therefore **academic**. Two qualitative studies from 2015 (US-recruited, with
  MyFitnessPal/FatSecret/CalorieCount forums) and one cohort study from 2014. They are old and not
  India-specific. Treat them as mechanisms, not current prevalence.
- **No independent study tests photo calorie estimation on Indian dishes.** Every Indian-specific accuracy
  figure found is a vendor claim.
- No sample sizes, percentages or retention figures appear here unless a cited source states them.

---

## 1. Executive summary

1. **Logging friction is real and well documented, but it is not mainly about home cooking.**
   - In the strongest study, forgetting was the top reason entries were missed (54%).
   - People also skipped foods that were too hard to enter (40%) or whose contents they didn't know (40%).
   - Lapsed journalers most often stopped because the value faded over time (37%), ahead of effort (25%).
   - Source: Cordeiro et al., CHI 2015, *Rethinking*. [study]
2. **Home-cooked food is harder to log than packaged or fast food, but easier than restaurant, party or
   "ethnic" food.** Ease ratings on a 7-point scale (higher = easier): packaged 6.5, fast food 6.3,
   home-cooked 4.6, ethnic 3.7, restaurant 3.6, parties 2.9. Source: Cordeiro et al., *Barriers*. [study]
   Recipe builders exist and were still called burdensome. Cooks also said their cooking "isn't that consistent"
   from one time to the next, so a saved recipe doesn't fit the next cook. [anecdote within study]
3. **Indian home food adds a specific problem: oil and ghee.** They are invisible on the plate and vary by cook.
   - Calorie charts give ranges driven mostly by oil. [vendor/blog sources, weak]
   - India's official composition table (IFCT 2017) covers raw ingredients, not cooked dishes. [study]
   - A 2024 open recipe database (INDB, 1,014 recipes) computes dishes from ingredients. [study]
4. **Photo scanning recognises foods reasonably well but estimates calories poorly on mixed dishes.**
   - In the only independent multi-app test, the best apps identified 90–97% of food components.
   - Energy errors on mixed dishes ranged from −55% to +270%. Added fats like butter were often missed.
   - No Indian dishes were tested. Source: Li et al., *Nutrients* 2024. [study]
   - A 2025 study of a general AI model (ChatGPT-5) found energy error fell from ~31% to ~14% MAPE when an
     ingredient list with amounts was added to the photo. Source: Rodríguez-Jiménez et al., *Nutrients* 2025. [study]
   - **Known ingredients beat pixels.** That is the one place ABC Cook holds data others don't.
5. **The ABC Cook hypothesis has three real weaknesses.**
   - Logging a serving of a saved recipe is already solved by MyFitnessPal and Cronometer. [official]
   - The eating moment, not the cooking moment, is when people log: 86% of entries came within 10 minutes of
     eating (Cordeiro et al., *Rethinking*). [study]
   - CopyMenu already ships a cook history, cook mode and per-serving nutrition. [official]

   D's advantage is narrower than it looks. It is **a known-ingredient, known-batch record created at
   zero extra typing**, useful mainly for later portions and leftovers. It is not new capability.
6. **Recommendation:** build nothing for food logging yet. **Finish M5 first.** Without finished cooking
   sessions, a post-cook action has no reach. Meanwhile, run a **no-build concierge test** (§9) inside M5 to learn
   whether cooks want to record what they ate, and when.

---

## 2. Competitor comparison

| | Core job | Food logging | Photo | Home recipes | Indian food | Paid gate (as listed) |
|---|---|---|---|---|---|---|
| **MyFitnessPal** | Calorie/macro diary | Search a database of 20.5M foods, meals, Quick add [official] | Meal Scan, **Premium** [official] | Saved recipes and meals. A recipe importer is reported as Premium [weak 3rd-party] | Indian items in "Most popular" with verified badges [observed-video] | Barcode, Meal Scan, voice, custom macros are Premium [official]. Video paywall ₹258.25/mo annual, ₹619/mo [observed-video] |
| **Healthify (HealthifyMe)** | Indian-first diet and coaching | Diary. "Free users still mainly use the app for food tracking" [TechCrunch 2023, company statement] | Snap and Auto-Snap from gallery [official]. 60–70% recognition claimed at launch [vendor-claim] | Coach generates recipes. Logging one's own recipe not documented in sources found | Trained on "150,000 Indian food items" [vendor-claim]. Company says thalis are hard | ₹399/mo basic, Pro ~₹4,000/mo (2023) [press] |
| **Cronometer** | Micronutrient-accurate diary | Diary | AI Photo-Logging, **Gold**. Help text tells users to check matches [official, via search snippet; page 403 on fetch] | Recipe import by URL, with unmatched ingredients flagged, **Gold** [official snippet] | Not researched in depth | Gold |
| **ReciMe** | Recipe saver | No diary | Imports recipe photos | Per-recipe calories and macros are **Plus** (paid) [official] | Paneer Lababdar in library [observed-video] | Plus: unlimited imports and nutrition [official] |
| **CopyMenu** (appsix, iOS v1.0.0 Apr 15, 2026; nutrition added v1.2.0 Jul 24) | Recipe saver | No diary. **"Cook history with ratings and personal notes"** [official] | Imports recipes from camera | Per-serving kcal/macros and a daily nutrition summary in the planner [official] | — | "Cat+" from $2.99/mo. Unlocks not described [official] |

**Identity check.** The app in the videos is **CopyMenu** (brand "copymenu", "Try Cat+", developer appsix),
not *Copy Me That*, which is a separate recipe manager.

**What each video actually shows.** Each file contains two apps.
- **myfitnesspal.mp4:** [observed-video]
  - Today dashboard: calorie goal 2,760 and macro goals, all at 0.
  - Meals: Breakfast, Lunch, Dinner, Snacks.
  - "+" menu: Log Food, Barcode, Voice, Meal Scan, Water, Weight, Exercise.
  - Search tabs: All, My Meals, My Recipes, My Foods.
  - Most-popular list of Indian items: Chapati 72 cal, Tawa Roti, Ghee, Curd, Paneer.
  - **Meal Scan appears only as a 4-page tutorial, then a paywall.** No scan ran and no food was logged.
    Its recognition was **not** tested.
  - Empty "Create meal / Copy previous meal" and "Create a food / Quick add" states.
  - Progress screen and ads.
- **recime.mp4:** [observed-video]
  - First half is ReciMe: Meal Plan, with an "Add to Meal Plan" sheet (date picker, then Breakfast/Lunch/Dinner/Snack), add recipe or note, and "Magic Meal Plan".
  - Second half is CopyMenu: home screen ("Copy a recipe" from link/IG/YouTube/camera) and the "My Week" planner.
- **copymenu.mp4:** [observed-video]
  - First half is ReciMe groceries:
    - free-text add
    - an "Add items" sheet with a servings stepper and Convert
    - checkbox ingredients, then the toast "20 items added · View groceries"
    - aisle grouping and a linked-recipe chip
    - **"Mark as cooked"** with stars and a note on the recipe page
    - visible merge artefacts such as "tomato 3 + 1 cup"
  - Second half is CopyMenu:
    - planner with a per-day "kcal | protein | carbs | fat" row showing **no visible numbers**, and recipe cards with a blurred kcal
    - shopping list by category, with "2 weeks / 4 weeks" and some items locked behind Cat+
    - parse artefact "0 for dusting"

---

## 3. User likes and dislikes (with evidence quality)

| Source | Platform | Sample | Dates | Themes | Strength |
|---|---|---|---|---|---|
| Cordeiro et al., *Barriers and Negative Nudges*, CHI 2015 | Survey plus forums (MyFitnessPal, FatSecret, CalorieCount) | 141 journalers (47 active, 94 lapsed); 5,526 posts in 627 threads | pub. Apr 2015 | Effort ("too much effort" 31, "time-consuming" 27, "tedious" 16 respondents); not knowing ingredients (76), oil and preparation (28), portions (40); unreliable or duplicated database entries; forgetting; guilt and skipping "bad" foods; avoiding hard-to-log foods | **Recurring** (two datasets agree) |
| Cordeiro et al., *Rethinking the Mobile Food Journal*, CHI 2015 | Survey plus 4-week field deployment | 257 surveyed; 27 in the field; 3,569 entries | pub. Apr 2015 | Forgetting 54%; skipped hard foods 40%; didn't know contents 40%; stopped because value fell 37%, effort 25%, time 16%, motivation 10%; only 9% mentioned calories as a goal; 86% of entries within 10 min of eating | **Recurring** (one study) |
| Helander et al., JMIR 2014 (The Eatery, a photo journal) | Retrospective app logs | 189,770 users | Oct 2011–Apr 2012 | Only 2.58% stayed active (≥10 photos and >1 week); 69% never took a valid photo; people with strict diets were most likely to stay | **Recurring** (one large cohort) |
| Epstein et al., *Beyond Abandonment*, CHI 2016 | Mechanical Turk survey | 193 people (activity, finance, location; **not food**) | 2016 | The cost of collecting data was the most common reason to stop (42.9–57.1% across domains); "happy abandonment" | **Adjacent only** |
| MyFitnessPal App Store listing | iOS | 4 visible reviews of ~33K ratings (4.7) | 2019–2025 | Praise for database breadth; billing and Premium complaints | **Anecdotal** |
| ReciMe App Store listing | iOS | 4 visible of ~309K ratings (4.8) | 2024–2025 | Per-serving nutrition liked; one asks for macro import from TikTok and **MyFitnessPal compatibility** | **Anecdotal** (but it is the recipe-to-tracker bridge) |
| Healthify App Store listing | iOS | 4 visible of ~6K (4.6) | 2022–2024 | "Snapping a meal tracks it so quickly"; price and cancellation complaints | **Anecdotal** |
| Reddit (r/IndianFitness, r/loseit, r/MyFitnessPal, r/Cooking) | — | **0, not accessible** | — | — | **Not assessed** |

**Negative nudge worth noting.** Logging difficulty pushes people *away* from home cooking: "Easier to scan a
code on some processed stuff" and "I just avoided eating things that were hard to log" (*Barriers*).
[anecdote within study] A cooking app has no interest in a diary that penalises cooking.

---

## 4. Indian and home-cooked pain points

- **Several barriers stack on one dish.** You need to know the ingredients, the amounts, the oil and preparation,
  and the portion eaten (*Barriers*, all four themes). One participant: "I loosely follow recipes, then I only eat
  some of what I make at a time." [anecdote within study] That is the batch and leftovers problem.
- **Oil and ghee are invisible and variable.** Several Indian calorie guides say oil drives most of the variance
  in sabzi and dal, often quoting ~40–45 kcal per tsp and ~120 per tbsp. [weak sources: blogs and app marketing]
  Independent evidence on how oil varies across Indian home cooks was **not found**.
- **There is no authoritative mixed-dish value.** IFCT 2017 has 528 raw foods and no composite dishes. INDB
  (2024) computes 1,014 recipes from ingredients. [study] So "dal" has no single true number, and any figure is a
  recipe estimate.
- **Thalis and multi-item plates** are hard for photo models, by the vendors' own account (HealthifyMe press,
  OpenAI customer story). [vendor-claim]
- **Who cooks is not always who eats.** Women in India spend far more time on unpaid domestic work than men
  (Time Use Survey 2024, secondary coverage: ~289 vs ~88 min/day for ages 6+). Cooking minutes alone were not
  found. [official stat, secondary] [interpretation] The cook finishing a session may not be the person whose
  intake matters, and the cook may log for several eaters or none. This weakens "log at cook finish" for India
  specifically.
- **Restaurant and canteen food** remains unknown-recipe, unknown-portion everywhere. ABC Cook has nothing to add
  there.

---

## 5. Photo recognition vs nutrition estimation

Five separate tasks, and the evidence for each:

| Task | Evidence |
|---|---|
| 1. Recognise foods | Best apps identified 90–97% of food components in 22 controlled photos (MyFitnessPal 97%, Fastic 92%, HealthifyMe 90%). Lose It! and FatSecret identified 46% (Li et al. 2024). [study] Controlled lighting and angle; no Indian dishes. |
| 2. Estimate portion | Weak. Errors are largest where food is stacked or covered (DPF-Nutrition preprint). [study, not read in full] |
| 3. Hidden fats and ingredients | "Butter and added fats frequently missed" (Li et al. 2024). [study] In one competitor-run dal test, no oil question was asked. [vendor-claim, single dish] |
| 4. Calories and macros | Mixed-dish energy errors per app ranged from −55% to +270% (bibimbap +270%, stir-fry +66%). Manual logging apps were also biased, under-estimating the Asian diet by 1,520 kJ (Li et al. 2024). [study] ChatGPT-5 photo-only energy MAPE was 30.5%; photo plus ingredients with amounts, 13.9%; ingredients with no photo, 18.1% (Rodríguez-Jiménez 2025, n=195 dishes; not Indian). [study] |
| 5. "Good enough" for the user's purpose | It depends on the goal. Only 9% of a 257-person survey named calories as a goal (*Rethinking*). Photo journals without numbers supported reflection (DECAF). [study] |

**Effort including corrections.**
- No study measured total time to log, corrections included, across photo, search, saved-meal and recipe methods.
- In the DECAF field study, 60% of experienced participants had skipped meals that were too hard to log with
  earlier methods. With photos, 22% did. Forgetting barely moved: 95% before vs 93% with photos. [study]
- **[interpretation]** Photos reduce *entry* friction, not *remembering*, and not *accuracy*.

**Implication.**
- Photo-based calorie estimation for Indian home food has no independent validation.
- If ABC Cook ever touches nutrition, its edge is the **ingredient list with amounts**. That is the context that
  halved error in the 2025 study.
- A photo is not ABC Cook's edge. And CLAUDE.md forbids per-interaction LLM calls without approval, plus the
  cost and privacy (third-party image processing, retention) that come with them.

---

## 6. Evidence against the opportunity

1. **Wrong moment.** People log at eating time: 86% within 10 minutes of eating, and a photo of the plate is
   the cue (*Rethinking*). Cook-finish equals eating time only when one person cooks and eats immediately.
   [study + interpretation]
2. **Already solved.** "Make a recipe and log one serving" is a standard MyFitnessPal and Cronometer workflow.
   [official / forum] ReciMe and CopyMenu already show per-serving nutrition. CopyMenu keeps a cook history.
   [official]
3. **Most users stop anyway.** 2.58% stayed active in a 190K-user photo journal (Helander 2014). [study] A logging
   feature inherits that attrition.
4. **Value decays.** The top reason lapsed journalers stop is that they got what they needed (37%). [study] A
   cooking app that adds logging may see brief use, then happy abandonment.
5. **Home cooking varies.** "Most of my cooking isn't that consistent." [anecdote within study] An imported recipe is
   what was *intended*, not what was cooked, especially for oil.
6. **Cook ≠ eater** in many Indian households (§4). [interpretation]
7. **Guilt and judgment** make numbers counter-productive for some users (13% of survey respondents and 45% of
   field participants skipped "bad" foods). [study]
8. **No demand signal from ABC Cook users exists yet.** M5 has not run.

---

## 7. Candidates compared

| | Demand evidence | Effort / repeat use | Accuracy & trust | Differentiation | Cost / dependencies | Must validate |
|---|---|---|---|---|---|---|
| **A** Basic diary | Strong in general (huge diary apps), none specific to ABC Cook | Free text is low-friction but numbers must be typed | Only as good as what the user types | **None** | Small build; no database | Whether ABC Cook users want a diary at all |
| **B** Recipe nutrition | ReciMe and CopyMenu sell it; one reviewer asks for macros and MyFitnessPal sync | Zero effort once computed | Oil, unstated servings (ABC Cook defaults to 4), no unit conversion | Low (competitors have it) | Food-composition DB (IFCT/INDB/USDA), ingredient matching, unit→gram conversion, servings scaling: all absent in the repo | Whether users trust a number with an honest range |
| **C** Photo | Heavily marketed; Healthify says free users mainly track food | Low entry effort; corrections still needed | Weakest on mixed and Indian dishes; no independent Indian validation | Low (incumbents have it, often paywalled) | Paid vision call per log; image privacy; new upload infrastructure | Accuracy on Indian home plates |
| **D** Session-linked logging with numbers | **None found** | Prefilled, but at possibly the wrong moment | Inherits B's accuracy problems | Moderate: entry point plus known batch | Needs B for numbers | Timing; cook ≠ eater |
| **D-lite** Cooking record without numbers | **None found**; DECAF suggests no-number journals can still be valued | Lowest: one or two taps | Nothing claimed, so nothing wrong | Small; CopyMenu's cook history is close | Local store only; no AI, no database | Whether anyone looks at the record later |

**Is D just a different entry point into a solved problem?** [interpretation] **Mostly, yes.**
- The dependency graph adds no nutrition accuracy.
- What ABC Cook uniquely holds at finish is: recipe identity, the ingredient list with amounts, servings made,
  and a timestamp. In principle it could also hold "what I changed" (more oil, fewer servings).
- Those amount to **batch provenance**. That is useful for (a) later leftover entries and (b) future
  ingredient-based estimates, which the 2025 study suggests are the more accurate input.
- That is a real but **second-order** advantage. It matters only once people cook with ABC Cook repeatedly.

**Planned vs prepared vs consumed vs leftovers.** [recommendation, for any future design]
- Keep these as separate facts. A finished session records only *prepared* (a batch).
- *Consumed* is a separate, optional, user-stated portion that can arrive later, including as leftovers.
- *Planned* exists nowhere in ABC Cook and needs no building for this question.
- Meal planning and groceries are **not** needed to test the core hypothesis. Leave them out.

---

## 8. M5 sequencing

**Recommendation: M5 first. Food logging waits.** [recommendation]

- Reach comes first: a post-cook action only reaches people who finish cooks. M5's exit ("three of ten have
  finished a cooking session") is the reach number.
- The roadmap's own stop-signal is "people import but never start cooking mode." If that fires, a cook-finish
  log is moot.
- **There is no measurement mechanism today.**
  - The app is local-only (localStorage).
  - No deploy, accounts, Supabase or usage log exist.
  - M5 itself adds "a crude usage log."
  - So until M5, any logging signal must come from talking to people, not from the app. A local-only log
    tells the owner nothing.

---

## 9. Smallest validation experiment (no code)

**"Concierge cook-and-eat note", run alongside M5's ten testers.** [recommendation]

1. **Recruit.** Use the M5 cohort. Note who in their household cooks and who eats, and whether they currently
   track food (which app, or none).
2. **Prompt.** After each finished ABC Cook session, the participant sends the owner a short message
   (WhatsApp or similar):
   - what they made
   - who ate it
   - how much *they* ate (½, 1, 2 servings, none yet)
   - whether there are leftovers
3. **Split timing.**
   - Half are asked to send the note **when they finish cooking**.
   - Half are asked to send it **when they sit down to eat**.
   - Measure completion and how often they skip or forget. The owner records this by hand; no app telemetry.
4. **Exit interview** (10 min). Ask:
   - Would a record like this be useful a week later? For what?
   - Would you want calories? How much would you trust them if they came from the recipe?
   - Current trackers only: how do you log home food today?
5. **Supplement.** Run 5–8 interviews with people who track with Healthify or MyFitnessPal *and* cook at home,
   recruited outside M5. They are the population D would serve.

**Decision rules.** [recommendation; the owner should set the thresholds before running, not after seeing data]

| If you see… | Then… |
|---|---|
| Notes stop after the first week | Drop the idea |
| Cook-at-finish notes are completed clearly less often than eat-time notes | Do not anchor logging to cook finish |
| Cook ≠ eater in most households | Do not anchor logging to cook finish |
| Nobody wants the record without calories, *and* nobody trusts recipe-based calories | Drop the idea |
| Trackers say they would still log in their existing tracker | Explore an export (for example, a per-serving summary to paste into MyFitnessPal or Healthify) instead of building a diary |
| Notes sustain, participants ask to see past cooks or leftovers, and cook ≈ eater | Spec D-lite as the first build. Revisit recipe-based estimates only after servings scaling and unit conversion exist |

---

## 10. Open questions and sources

**Open:**
- Reddit evidence. Owner to search manually: r/IndianFitness, r/loseit, r/MyFitnessPal, r/Cooking, r/india,
  for "home cooked", "dal", "ghee", "recipe builder", "meal scan".
- Play Store reviews for Healthify and MyFitnessPal (India locale).
- Healthify's current Snap accuracy and paywall status.
- Whether Cronometer and MyFitnessPal recipe import is free in India today.
- Independent tests of photo logging on Indian plates.
- How oil quantity varies across Indian home cooks.
- What CopyMenu's cook history does in practice.
- Whether ABC Cook users are trackers at all.

**Sources:**
- Cordeiro F. et al., *Barriers and Negative Nudges: Exploring Challenges in Food Journaling*, CHI 2015, doi:10.1145/2702123.2702155. Text: https://my.eng.utah.edu/~cs5540/au16/readings/PersonalInformatics-Cordeiro2015.pdf
- Cordeiro F., Bales E., Cherry E., Fogarty J., *Rethinking the Mobile Food Journal*, CHI 2015, doi:10.1145/2702123.2702154. Text: https://homes.cs.washington.edu/~jfogarty/publications/chi2015-decaf.pdf
- Helander E. et al., *Factors Related to Sustained Use of a Free Mobile App for Dietary Self-Monitoring…*, JMIR 2014;16(4):e109. https://pmc.ncbi.nlm.nih.gov/articles/PMC4004142
- Epstein D. et al., *Beyond Abandonment to Next Steps*, CHI 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC5428074/
- Li X. et al., *Evaluating the Quality and Comparative Validity of Manual Food Logging and AI-Enabled Food Image Recognition in Apps for Nutrition Care*, Nutrients 2024;16(15):2573. https://pmc.ncbi.nlm.nih.gov/articles/PMC11314244/
- Rodríguez-Jiménez M. et al., *Image-Based Dietary Energy and Macronutrients Estimation with ChatGPT-5*, Nutrients 2025;17(22):3613. https://pmc.ncbi.nlm.nih.gov/articles/PMC12655113/
- Indian Nutrient Databank (INDB), Current Developments in Nutrition 2024. https://pmc.ncbi.nlm.nih.gov/articles/PMC11277795/
- AI image dietary assessment systematic review (Annals of Medicine 2023; abstract via search only). https://www.tandfonline.com/doi/full/10.1080/07853890.2023.2273497
- SnappyMeal (arXiv 2511.03907, abstract only). https://arxiv.org/abs/2511.03907
- Silva & Epstein, *Investigating Preferred Food Description Practices in Digital Food Journaling*, DIS 2021 (snippet only). https://library.selfresearch.org/research/investigating-preferred-food-description-practices-in-digital-food-journaling/
- MyFitnessPal App Store listing. https://apps.apple.com/in/app/myfitnesspal-calorie-counter/id341232718
- Healthify App Store listing. https://apps.apple.com/app/id943712366
- ReciMe App Store listing. https://apps.apple.com/app/id1593779280
- CopyMenu App Store listing. https://apps.apple.com/app/id6761840952
- Cronometer Mobile Photo Logging help (fetch returned 403; search snippet only). https://support.cronometer.com/hc/en-us/articles/39013533811092-Mobile-Photo-Logging
- TechCrunch, *HealthifyMe introduces AI-powered image recognition for Indian food*, 2023-09-21. https://techcrunch.com/2023/09/21/khosla-backed-healthifyme-introduces-ai-powered-image-recognition-for-indian-food/
- Time Use Survey 2024, secondary coverage. https://www.businesstoday.in/india/story/time-use-survey-women-take-on-most-of-household-and-caregiving-work-465946-2025-02-25
- Weak, labelled where used: FeastGood Meal Scan test https://feastgood.com/meal-scan-accuracy-for-nutrition-apps/ ; NutriScan HealthifyMe comparison https://nutriscan.app/blog/posts/healthifyme-vs-nutriscan-2026-indian-food-photo-scan-cee252fd82

---

## 11. Direct answers

- **Is home-cooked logging a meaningful problem?** Yes, as a known friction: home food is rated harder to log
  than packaged food, and recipe builders are called burdensome. **But** it is not the top reason people stop.
  Forgetting and fading value are. And there is **no evidence yet that ABC Cook's users want to log at all.**
- **Is photo scanning the right first solution?** **No.**
  - Recognition is decent, but calorie error on mixed dishes is large.
  - Hidden fats are missed, and there is no independent Indian validation.
  - Incumbents already ship it behind paywalls.
  - It would break the one-LLM-call-per-import cost rule.
- **Does ABC Cook have a credible advantage?** A narrow one.
  - The graph doesn't improve nutrition accuracy.
  - What ABC Cook does hold at cook finish is batch provenance: the ingredients with amounts and servings made.
    That supports leftovers and future recipe-based estimates.
  - The timing (cook finish vs eating) and cook ≠ eater may cancel it.
- **Should food logging wait for M5?** **Yes.** M5 measures the reach a post-cook feature depends on, and nothing
  can be measured before it.
- **Smallest experiment next?** The no-code concierge note during M5 (§9), split by cook-time vs eat-time,
  plus 5–8 interviews with home cooks who already track.
- **What would make us abandon or change it?**
  - Notes stop within a week.
  - Eat-time beats cook-time.
  - Cook ≠ eater is common.
  - Trackers prefer their existing app (then pivot to export).
  - M5 shows people don't finish cooks at all (then the whole thesis comes first).

---

## 12. Launch parity and product decision

**Status: a proposed launch-scope decision that needs owner approval.** It does not authorise changing
`docs/ROADMAP.md` or `docs/PRODUCT.md`, or implementing anything.

**What the research found.**
- **ReciMe:** a "Mark as cooked" action on the recipe page, with a star rating and a note field. [observed-video,
  `copymenu.mp4`, ReciMe segment]
- **CopyMenu:** "cook history with ratings and personal notes" in its App Store listing. [official]
- **[interpretation]** These are **cooking-history features, not food diaries.** Neither source shows either
  product recording what was eaten, portions, unrelated meals or daily intake. (Both separately show per-serving
  recipe nutrition, ReciMe behind its paid tier.)

**Proposed for launch (needs approval): a minimal cooking history.** One record per finished cook:
- **Recipe identity:** the saved recipe and its title at the time of the cook.
- **Cooking date:** when the session finished.
- **Optional rating or note:** both skippable, never required to finish.

Why it is worth considering for launch:
- It closes a visible parity gap with both recipe competitors.
- It fits the product's "run" more than the "record": it marks a completed cook rather than tracking intake.
- It needs no AI, no external service and no nutrition data.

Repo context for whoever scopes it:
- Today, "Finished cooking" calls `session.end()`, which discards the session (`apps/web/src/cooking-mode/CookingModeScreen.tsx:180-183`).
- So a history needs a new persisted record, written before `end()` and kept separate from `SavedRecipe`. That
  record is replaced in place on re-import (`apps/api/abc_cook/schema/library.py`).
- It would be local to the device, like the library, until M5's persistence exists.

**Open question for the owner: "portion eaten".** An optional, one-tap field on the same record: ½ · 1 · 2 ·
none yet.

- **Potential value:**
  - It is the smallest step from *prepared* to *consumed* without becoming a diary.
  - For batch cooking it records how much of the batch was eaten, which tells you how much is left over.
  - It is the hook a future "log leftovers" entry would attach to, against the same cook.
  - If recipe-based estimates ever arrive, a stored portion lets them be computed retroactively without
    re-asking the user.
- **Data implications:**
  - It turns a cooking record into a consumption record, which is health-adjacent data stored on a shared device
    with no account or backup.
  - It is only meaningful alongside "servings made". ABC Cook defaults unstated servings to 4
    (`servings_stated = false`), so a portion of a defaulted batch is unreliable unless the user confirms servings.
  - It raises "whose portion?" when cook ≠ eater (§4).
- **UX implications:**
  - A second question on the done screen, competing with the single primary action.
  - It must never block finishing.
  - The "none yet" option is essential so the default doesn't imply eating.
  - Wording should avoid diet or judgement framing (§6, point 7).

**Still deferred:**
- diary entries for meals unrelated to an ABC Cook session
- calorie and macro tracking
- photo logging
- nutrition database integrations (IFCT, INDB, USDA or vendor APIs)

**M5 still matters.** A cooking history only fills when users finish cooking sessions. M5's "three of ten
finished a session" is the condition under which this feature has any content.

**The concierge experiment (§9) stays.** A cooking history answers parity. The concierge note tests whether there
is demand for anything beyond it (portions, leftovers, nutrition), and whether cook-finish or eat-time is the
right moment.
