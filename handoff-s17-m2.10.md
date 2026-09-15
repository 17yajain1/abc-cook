# Handoff — s17, M2.10 (transcript leg) Steps 2–3 done

**Branch:** `feature/M2.10-transcript-leg`. Steps 1–3 committed; step 4 (Checkpoint 2) run but unresolved; step 5 (doc §14 + PR) not started.

**Final decisions locked this session:**
- Track order: manual(video lang) → manual(en) → auto(`<lang>-orig`) → auto(`<lang>`) → auto(en). Never any other translated auto key.
- Transcript always in the one LLM call when present — no sufficiency heuristic, no second call. 24,000-char cap, truncate at a segment boundary.
- Prompt v2 per-field precedence: written wins ingredient qty; method = blog > description > transcript (transcript *is* the method if nothing written exists); any source may ground a cue; transcript chatter excluded.
- `ImportResult.sources` always populated, on both Tier 0 and `done`.

**Constraints:** no ASR/vision (leg 4/5); `graph.py`/`node.py`/scheduler/six golden fixtures untouched (verified empty diff — keep it that way); one LLM call per import still holds.

**Next task goal — resolve before step 5:**
1. `normalize.py` `MAX_TOKENS=8000` truncates transcript-fed videos (Ramen fixture reproduces it; 12K not reliably enough either) — needs a decision, not just a bump.
2. Both real successes degraded to Tier 1 (linear, `saved_min=0.0`, zero windows) despite grounded unattended/periodic steps — `repair_or_degrade` gives up on larger extractions. Root-cause before shipping.
3. Still need a garlic-bread-style URL (blog + transcript both present) for the precedence test.

**Paths:** `abc_cook/extract/acquire/{transcript,youtube,pipeline}.py`, `abc_cook/extract/{normalize,import_pipeline}.py`, `abc_cook/extract/prompts/v2.md`, `abc_cook/schema/normalized.py` (`ImportSource`), `tests/{test_acquire_transcript,test_import_llm_transcript}.py`, `tests/fixtures/import/{captions-*,no-captions}.raw.json`. Plan: `C:\Users\ashya\.claude\plans\analyse-my-discussion-on-inherited-treasure.md`.
