# V2.1 follow-ups: issue log (observations only, nothing fixed here)

Branch `v2/cooking-hierarchy`. Written 2026-10-09 during the approved
"V2.1 follow-up: tap targets and quantity-line weight" implementation. The running-work strip (1d) is
owner-selected, not usability-validated; reopen condition in the design record. V-B and V-C are pending, and S2–S4
have not been run.

## 1. Burger: ingredient assignment and data inconsistency (suspected extraction issue, root cause not proven)
- Fixture: the B1/B2 design-pack Burger plan response (not tracked in the repo).
- The oil rows:
  - `ing_oil` "1 tsp", group "Veggie patty mixture".
  - `ing_oil_2` "1 tbsp" and `ing_oil_3` "for frying", both in group "For making the crispy veggie patty".
- All three oil rows are in `consumes` of:
  - `graph.nodes[2]` `step_set_a_pan_on_medium_heat` (Sauté aromatics).
  - `graph.nodes[9]` `step_make_the_batter_in_a_big` (Make batter). Its instruction mentions only "1 tbsp oil".
  - `graph.nodes[12]` `step_set_oil_for_frying_on_medium` (Deep-fry patties).
- Butter shows the same pattern. `ing_butter` "1 tbsp" and `ing_butter_2` "for toasting the burger buns" are both on
  nodes[2] (Sauté aromatics) and nodes[13] (Toast buns).
- Visible effect on the phone: the Make batter quantity line reads "… 1 tsp oil · 1 tbsp oil · for frying oil",
  which lists amounts that belong to other steps.

## 2. D6 countdown format: sheet vs. running-work strip
- The What's cooking sheet row shows `m:ss`, for example "13:58" for Cool and chill (from `sheetTime` in
  `viewModel.ts`). Directly beside it, the strip reads "About 14 min left".
- The `m:ss` reads as a live countdown, which goes against D6's "no `m:ss` anywhere". This is pre-existing on main. No
  timer change has been made.
- Re-observed 2026-10-09:
  - Kadai sheet: "11:59".
  - Biryani sheet: "9:54" and "5:51", in rows next to "~15m".

## 3. Skip for now tap target (pre-existing on main)
- Hit-tested size: 81 × 23 px (`elementFromPoint`; 632–654 on Burger Make batter, 360×697).
- Not changed in this follow-up; for later review only.

## 4. Short-step whitespace (watch item, not a confirmed defect)
- On short instructions, the fixed footer leaves a large empty band above it. Examples: Kadai "Cube capsicum",
  Burger "Mash poha".
- Body column content ends far above the footer, with 0 px hidden.
- Not addressed. It belongs with the broader visual pass, if anywhere.

## 5. Earlier inaccurate claim: "Leave cooking already meets 44 px"
- The V2.1 implementation said Leave's `::after` gave a 44 px tap area. The source comment in `CookingShell.tsx`
  still says "44px tap area".
- The directional phone check measured about 38 px.
- **Cause, diagnosed 2026-10-09 on the S22:**
  - An absolutely positioned `::after` is placed against the button's *padding* box, which is inside its 1 px border.
  - So `-inset-y-[7px]` gave (26 − 2) + 14 = **38 px** (rows 6–43), not 26 + 14 = 40.
  - In any case, 40 was below 44: the original arithmetic did not reach 44 even before the border was counted.
  - It was not z-order: no element intercepted the band, and rows past 43 were simply outside the `::after`.
- Now `-inset-y-[11px]`: rows 2–47, **46 px** hit-tested on the phone.
- Lesson: report measured hit geometry, not CSS arithmetic.

## 6. Leave cooking's extended band can lose a drag gesture
- The test ran on Burger "Make batter". No CookingShell screen in the four fixtures scrolls at 360×697, so the
  viewport was shortened with an emulation override to **360×520** (155 px hidden). The override was cleared afterwards.
- A synthetic CDP touch drag that started inside Leave's band, over the body column, **neither scrolled the body nor
  activated Leave**. Starts at y = 40 and y = 45 were tried, dragging to y = 300, and the gesture was lost.
- A control drag started at y = 120 scrolled normally (scrollTop 155 → 0).
- Low impact: it affects only drags that begin in roughly the top 10 px of the body column, and only on screens that
  scroll. Not fixed. For later judgement.

## Open uncertainty: Biryani wait screen, whisper link vs "It's done" (not a confirmed regression)
- Screen: Biryani "Deep, even golden brown…" (hands-off wait screen) at 360×697.
- **Browser hit-test after the change (measured, `elementFromPoint`):**
  - The whisper link covers rows 510–553 (at its left, centre and right edges).
  - Rows 554–560 belong to the footer container (non-interactive).
  - "It's done" starts at row 561 (swept at x = 27 and x = 75).
  - The two do **not** overlap.
- **Synthetic tap activation after the change (measured, x = 75 only):**
  - Rows 551–557 opened the link.
  - Rows 558–564 activated "It's done".
  - Chrome's touch adjustment explains this: unchanged controls such as "Skip for now" also activate about 6–10 px
    outside their boxes.
- **Old tap behaviour was not measured.** So it is **unknown** whether taps on rows 554–557 used to activate "It's
  done" and now open the link.
- The old hit-test rows for the link (about 521–542, with no pseudo-element) are **inferred, not measured**.
- The before/after tap-map experiment (rows 543–564 × 3 columns × 3 repetitions × 2 states) was **deliberately
  skipped** on 2026-10-09.
- The interaction is not fully validated.

## Unverified: finish-step strip link vs Done
- In all four fixtures every node is an ancestor of the sink. So nothing can be running on the finish step, and the
  strip (with its link) never sits directly above Done through the real engine.
- That adjacency has **not** been swept on a device.
- On the screens that were tested, the strip link's hit-test band stops 3 px above the strip's bottom edge. That
  says nothing measured about the finish step.
