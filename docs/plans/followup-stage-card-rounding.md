# Follow-up: stage-card figure vs wait floor

Found 2026-10-14 (R2 review). On homemade donuts the R2 outline says `Hands free for ~55 min`
(`approxWaitPhrase`, floors to 5 min, never rounds a wait up) while the Rise stage card says
`~1 hr` (round to nearest). Both are honest, but a cook sees two figures for one rise.

Accepted for R2. Resolve later by making the stage card and the outline use one rounding
rule for the same wait (stage-card rounding in `plan/StageCard.tsx` / `lib/duration.ts`, or
the outline's floor), as a product decision. Not changed in R2.
