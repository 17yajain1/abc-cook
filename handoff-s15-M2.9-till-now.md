# Handoff — S15, M2.9 (paused before implementing steps 8-9)

Branch: `feature/M2.9-youtube-import` (steps 1-7 committed).

**Decisions locked, not yet implemented:**
- Always call the LLM once per import, including bucket C/E; recompute `method_grounded` post-hoc as `bool(steps)`, never trust the model's field. Corrects design doc §6.3's "$0 for bucket C" claim — update that section when touching it.
- `graph.py` must independently verify before trusting: attention (`attention_cue` must be a real substring of the source text, else force `hands_on`), freshness (`freshness_cue` must contain a real immediacy marker, else `none`), window-host duration (clamp `typical = min` when `duration_stated=False`), and `depends_on_previous=False` claims (only honored if no shared ingredient and no produces/consumes link).
- Adapter uses `client.messages.parse(output_format=NormalizedRecipe)` — verified working on `anthropic` 1.5.0. Truncation (`stop_reason == "max_tokens"`) retries once at `max_tokens=8000`, kept separate from the invariants-failed repair pass.
- `corroborate.py`: position-match non-intro/outro chapters to stages in order; skip silently (no warning) if counts don't align — it's a warning, never a gate.

**Next task:** implement `extract/adapters/{base,anthropic}.py`, `extract/prompts/v1.md`, `extract/normalize.py`, `extract/graph.py`, `extract/provenance.py`, `extract/corroborate.py` per the above, tested against the frozen fixtures. Checkpoint after: first real graph from a real video, before any route/UI.

**Relevant paths:** `docs/M2.9-youtube-import-design.md` (rev 3) · `apps/api/abc_cook/schema/normalized.py` · `apps/api/abc_cook/extract/validate.py` · `apps/api/abc_cook/extract/acquire/` · `apps/api/tests/fixtures/import/*.raw.json` · `apps/api/.env` (`LLM_MODEL=claude-haiku-4-5-20251001`)
