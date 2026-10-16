### T1. Spend per run (INR, running total, cap 30)

| run | INR | running |
|---|---|---|
| chole-bhature__minimal__0 | 1.03 | 1.03 |
| chole-bhature__low__0 | 1.03 | 2.06 |
| chole-bhature__low__1 | 0.89 | 2.95 |
| chole-bhature__medium__0 | 2.07 | 5.02 |
| pumpkin-pancakes__minimal__0 | 0.27 | 5.29 |
| pumpkin-pancakes__low__0 | 0.34 | 5.63 |
| kadhi-pakora__minimal__0 | 0.52 | 6.14 |
| kadhi-pakora__low__0 | 0.65 | 6.79 |
| croissant__minimal__0 | 0.85 | 7.64 |
| croissant__low__0 | 0.67 | 8.31 |
| vanilla-cupcakes__minimal__0 | 0.36 | 8.67 |
| vanilla-cupcakes__low__0 | 0.40 | 9.07 |
| pizza-dough__minimal__0 | 0.59 | 9.66 |
| pizza-dough__low__0 | 1.43 | 11.10 |
| pizza-dough__low__1 | 0.66 | 11.76 |
| fast__pizza-dough__gpt-5-mini__0 | 0.28 | 12.04 |
| fast__pizza-dough__gpt-4.1-mini__0 | 0.32 | 12.36 |
| fast__pumpkin-pancakes__gpt-5-mini__0 | 0.10 | 12.46 |
| fast__pumpkin-pancakes__gpt-4.1-mini__0 | 0.08 | 12.54 |
| fast__kadhi-pakora__gpt-5-mini__0 | 0.21 | 12.75 |
| fast__kadhi-pakora__gpt-4.1-mini__0 | 0.21 | 12.96 |
| fast__croissant__gpt-5-mini__0 | 0.15 | 13.11 |
| fast__croissant__gpt-4.1-mini__0 | 0.11 | 13.21 |
| fast__vanilla-cupcakes__gpt-5-mini__0 | 0.09 | 13.31 |
| fast__vanilla-cupcakes__gpt-4.1-mini__0 | 0.07 | 13.38 |
| fast__chole-bhature__gpt-5-mini__0 | 0.34 | 13.72 |
| fast__chole-bhature__gpt-4.1-mini__0 | 0.38 | 14.10 |
| chole-bhature__translate-first:translate | 0.44 | 14.53 |
| chole-bhature__low__0__translate-first | 0.86 | 15.40 |
| stream__fast__gpt-4.1-mini | 0.14 | 15.54 |
| stream__full__gpt-5-mini-low | 0.62 | 16.16 |

**Total INR 16.16 of 30.** Sonnet repair was stubbed (0 calls). B2 and B0 cost INR 0.

### T2. Full-extraction matrix (gpt-5-mini; repair stubbed; goldens are MEDIUM-effort output)

| recipe | arm | wall s | calls | input tok (cached) | reasoning | visible out | INR | tier | steps | validate | repair would fire (rules) | vs golden: node recall / edge recall / stated durations equal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chole-bhature | minimal | 37.2 | 1 | 11934 (0) | 0 | 4557 | 1.03 | clean | 17 | True | no | no golden |
| chole-bhature | low | 34.6 | 1 | 11934 (0) | 192 | 4388 | 1.03 | repair-would-fire | 16 | False | YES: ingredients_consumed,produces_consumed | no golden |
| chole-bhature | low#1 | 38.2 | 1 | 11934 (11776) | 512 | 4547 | 0.89 | repair-would-fire | 17 | False | YES: ingredients_consumed,produces_consumed | no golden |
| chole-bhature | medium | 99.8 | 1 | 11934 (11776) | 6912 | 5102 | 2.07 | repair-would-fire | 22 | False | YES: ingredients_consumed,produces_consumed | no golden |
| pumpkin-pancakes | minimal | 10.7 | 1 | 8154 (6912) | 0 | 1337 | 0.27 | clean | 6 | True | no | 0.57 / 0.5 / True |
| pumpkin-pancakes | low | 13.8 | 1 | 8154 (6912) | 320 | 1443 | 0.34 | repair-would-fire | 6 | False | YES: ingredients_consumed | 0.71 / 1.0 / True |
| kadhi-pakora | minimal | 19.2 | 1 | 10001 (6912) | 0 | 2555 | 0.52 | clean | 9 | True | no | 0.82 / 1.0 / True |
| kadhi-pakora | low | 25.4 | 1 | 10001 (6912) | 1088 | 2253 | 0.65 | clean | 7 | True | no | 0.64 / 0.67 / False |
| croissant | minimal | 38.6 | 2 | 8061 (6912) | 0+0 | 2217+2456 | 0.85 | clean | 14 | True | no | 0.5 / 0.25 / True |
| croissant | low | 28.6 | 1 | 8061 (6912) | 1024 | 2676 | 0.67 | clean | 16 | True | no | 0.56 / 0.33 / False |
| vanilla-cupcakes | minimal | 15.4 | 1 | 8238 (6912) | 0 | 1866 | 0.36 | repair-would-fire | 10 | False | YES: ingredients_consumed | 1.0 / 0.0 / True |
| vanilla-cupcakes | low | 16.1 | 1 | 8238 (6912) | 1088 | 1014 | 0.40 | clean | 4 | True | no | 1.0 / 0.67 / True |
| pizza-dough | minimal | 23.5 | 1 | 13687 (6912) | 0 | 2552 | 0.59 | clean | 13 | True | no | 0.21 / 1.0 / False |
| pizza-dough | low | 54.9 | 2 | 13687 (6912) | 832+1984 | 2293+2200 | 1.43 | clean | 10 | True | no | 0.07 / None / False |
| pizza-dough | low#1 | 27.3 | 1 | 13687 (13568) | 1536 | 2188 | 0.66 | clean | 10 | True | no | 0.0 / None / False |
| chole-bhature | low (translate-first) | 37.6 | 1 | 10565 (7936) | 256 | 4385 | 0.86 | repair-would-fire | 19 | False | YES: ingredients_consumed,produces_consumed | no golden |

### T3. Chole attempts (FU1ZVLMbWjA, 11,602-char Hindi transcript)

| attempt | max_tokens | wall s | reasoning | visible | reached a plan? | tier | steps | INR |
|---|---|---|---|---|---|---|---|---|
| CAPTURE 2026-10-16 (effort_ab `medium` = provider default) | 16000 | 141.1 | 16000 | 0 | NO (Tier 0) | tier0 | 0 | 2.75 |
| minimal | 16000 | 37.2 | 0 | 4557 | YES | clean | 17 | 1.03 |
| low | 16000 | 34.6 | 192 | 4388 | YES | repair-would-fire | 16 | 1.03 |
| low#1 | 16000 | 38.2 | 512 | 4547 | YES | repair-would-fire | 17 | 0.89 |
| medium | 16000 | 99.8 | 6912 | 5102 | YES | repair-would-fire | 22 | 2.07 |
| low + translate-first (gpt-4.1-mini, +15.9s, +INR 0.438) | 16000 | 37.6 | 256 | 4385 | YES | repair-would-fire | 19 | 0.86 |
| 32K probe | 32000 | not run | - | - | - | - | - | 0 (rule: only if some 16K attempt failed; none did) |

### T4. Tokens per character (tiktoken o200k_base; matches API usage within +2 tokens on all 6)

| recipe | lang | transcript chars | transcript UTF-8 bytes | transcript tokens | tok/char (transcript) | tok/char (whole source) | predicted input | API input |
|---|---|---|---|---|---|---|---|---|
| pizza-dough | en | 8293 | 8293 | 1882 | 0.227 | 0.266 | 13685 | 13687 |
| pumpkin-pancakes | en | 2242 | 2242 | 563 | 0.251 | 0.255 | 8152 | 8154 |
| kadhi-pakora | en | 3202 | 3202 | 783 | 0.245 | 0.278 | 9999 | 10001 |
| croissant | en | 1583 | 1585 | 404 | 0.255 | 0.258 | 8059 | 8061 |
| vanilla-cupcakes | None | 0 | 0 | 0 | None | 0.263 | 8236 | 8238 |
| chole-bhature | hi | 11602 | 29442 | 3658 | 0.315 | 0.323 | 11932 | 11934 |

System prompt = 7446 tok = v7.md 4423 + JSON-Schema/format wrapper 3023. Blog JSON-LD (pizza): 3459 tok pretty vs 3047 compact.

### T5. Staged fast call (flat schema; scratch prompt) vs full call at low

| recipe | model | wall s | in | reasoning | out | INR | steps | stated minutes | full-call wall s (low) |
|---|---|---|---|---|---|---|---|---|---|
| pizza-dough | gpt-5-mini | 7.5 | 6601 | 0 | 844 | 0.28 | 15 | [2, 5, 8, 18, 60] | 54.9 |
| pizza-dough | gpt-4.1-mini | 5.8 | 6602 | 0 | 669 | 0.32 | 18 | [2, 5, 10, 60, 270, 1080] | 54.9 |
| pumpkin-pancakes | gpt-5-mini | 4.5 | 1068 | 0 | 471 | 0.10 | 9 | [] | 13.8 |
| pumpkin-pancakes | gpt-4.1-mini | 3.0 | 1069 | 0 | 330 | 0.08 | 10 | [] | 13.8 |
| kadhi-pakora | gpt-5-mini | 7.2 | 2915 | 0 | 847 | 0.21 | 12 | [10, 30] | 25.4 |
| kadhi-pakora | gpt-4.1-mini | 7.2 | 2916 | 0 | 816 | 0.21 | 13 | [10, 30] | 25.4 |
| croissant | gpt-5-mini | 6.4 | 975 | 0 | 740 | 0.15 | 20 | [5, 6, 20, 60, 60, 60] | 28.6 |
| croissant | gpt-4.1-mini | 4.4 | 976 | 0 | 547 | 0.11 | 16 | [6, 10, 25, 60, 60, 60] | 28.6 |
| vanilla-cupcakes | gpt-5-mini | 3.8 | 1152 | 0 | 404 | 0.09 | 7 | [10] | 16.1 |
| vanilla-cupcakes | gpt-4.1-mini | 2.2 | 1153 | 0 | 208 | 0.07 | 4 | [10, 20] | 16.1 |
| chole-bhature | gpt-5-mini | 12.4 | 4848 | 0 | 1414 | 0.34 | 23 | [1, 5, 7, 10, 10] | 34.6 |
| chole-bhature | gpt-4.1-mini | 13.6 | 4849 | 0 | 1559 | 0.38 | 23 | [1, 2, 4, 5, 7, 10, 10, 10, 15, 360, 360] | 34.6 |

### T6. Streaming probes (kadhi-pakora)

| call | first visible token s | ingredients key s | steps key s | first step complete s | total s | out tok | reasoning | INR |
|---|---|---|---|---|---|---|---|---|
| stream__fast__gpt-4.1-mini | 1.2 | 1.3 | 3.5 | 3.8 | 6.8 | 824 | 0 | 0.14 |
| stream__full__gpt-5-mini-low | 7.7 | 8.1 | 13.7 | 15.2 | 25.8 | 3521 | 960 | 0.62 |

### T7. Run-to-run noise floor and arm-vs-arm (fuzzy structural diff)

| comparison | tiers | node recall | edge recall | edge precision | stated durations | total_min |
|---|---|---|---|---|---|---|
| pizza-dough: low#0 vs low#1 | clean / clean | 0.7 | 0.33 | 1.0 | [2, 4, 8, 60, 240, 1080] vs [2, 4, 8, 60, 240, 1080] | 1459.0 vs 1476.0 |
| chole-bhature: low#0 vs low#1 | repair-would-fire / repair-would-fire | 0.65 | 1.0 | 0.75 | [5, 360] vs [6, 10, 360, 360] | 473.0 vs 909.0 |
| pumpkin-pancakes: minimal vs low#0 | clean / repair-would-fire | 0.5 | 0.0 | 0.0 | [] vs [] | 27.0 vs 17.0 |
| kadhi-pakora: minimal vs low#0 | clean / clean | 1.0 | 0.86 | 0.46 | [] vs [10] | 51.0 vs 54.0 |
| croissant: minimal vs low#0 | clean / clean | 0.62 | 1.0 | 0.75 | [5, 6, 20, 60, 60, 60] vs [5, 6, 20, 55, 55, 55] | 258.0 vs 269.0 |
| vanilla-cupcakes: minimal vs low#0 | repair-would-fire / clean | 1.0 | 0.0 | 0.0 | [9, 20] vs [9, 20] | 67.0 vs 40.0 |
| pizza-dough: minimal vs low#0 | clean / clean | 1.0 | 0.29 | 0.5 | [2, 4, 8, 60, 240, 1080] vs [2, 4, 8, 60, 240, 1080] | 1480.0 vs 1459.0 |
| chole-bhature: minimal vs low#0 | clean / repair-would-fire | 0.75 | 0.62 | 0.33 | [1, 4, 10, 10, 30, 360] vs [5, 360] | 395.0 vs 473.0 |
| chole-bhature: low#0 vs medium | repair-would-fire / repair-would-fire | 0.59 | 0.71 | 0.56 | [5, 360] vs [1, 3, 4, 6, 9, 9, 28, 350, 350] | 473.0 vs 849.0 |
| chole-bhature: minimal vs medium | clean / repair-would-fire | 0.55 | 0.33 | 0.15 | [1, 4, 10, 10, 30, 360] vs [1, 3, 4, 6, 9, 9, 28, 350, 350] | 395.0 vs 849.0 |
