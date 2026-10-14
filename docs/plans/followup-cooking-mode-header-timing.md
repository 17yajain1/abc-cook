# Follow-up: Cooking mode header shows only the last sitting

Found 2026-10-14 (R2 O3). `headerTiming` (`apps/web/src/lib/duration.ts`) reports the *last*
sitting's range when `summary.sessions.length > 1`. `CookingModeScreen` renders it as its
header timing, so pizza reads `30-50 min` and rajma `50-60 min` there, which looks like the
total time. R2 fixes only the recipe page (servings-only meta line, `plan/headerMeta.ts`).

Decide separately what Cooking mode should show for a multi-sitting recipe (same options as
R2's O3: drop the timing, or label it as the last sitting). Not changed in R2.
