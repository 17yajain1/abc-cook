# Decisions 2026-10-16: speed plan and ingredients-first

## Ingredients-first import screen (owner decision)
While an import runs: title/photo header (~0.5 s, oEmbed + thumbnail) -> ingredients list (~11-13 s) -> steps fill in one by one (~18 s+) -> timings, cooking mode and "start ~X before" unlock only when the validated plan arrives (~33-37 s). Draft content is labelled and has no durations, timers or start-time advice. Same single extraction call, streamed; no second LLM call. The ingredients view is built so R3 (chips) and R4 (servings) reuse it. One page vs two is decided in the S2 plan.

## Why
Measured: ingredients complete ~8.1 s into the call, first step ~15.2 s, full plan ~25.8 s (kadhi). ReciMe web shows nothing until the whole recipe arrives at ~13-17 s (black-box HARs, no cache, no streaming).

## Order
S1 (instant preview + honest errors + ingredients-first layout) -> S2 (ingredients-first streamed draft) -> S3 (strict JSON output + FGC-11 croissant + FGC-12 minimal vs low n=3) -> R3 -> R4 -> R5 -> R6 -> M5. After M5: cross-user cache on Supabase; output-size reduction (lever 4).

## Targets for M5
First screen <=3 s; ingredients <=15 s; full plan <=40 s typical (<=30 s is the post-M5 goal), <=60 s long video; cost <=Rs 2; same-user repeat import Rs 0 (library pre-check). No new wrong advice.
