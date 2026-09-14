# Handoff — s16, M2.9 Step 10 done

**Branch:** `feature/M2.9-youtube-import`, commit `a914516`. Steps 1–10 complete/committed.

**Final decisions locked this session:**
- Repair call requests a compact `RepairProposal` (3 fields/step only), never the full recipe — structurally can't invent content, and avoids truncation.
- Anthropic repair calls MUST pass `effort="low"` (`adapters/base.py` `EffortLevel`) — without it, Sonnet 5's reasoning consumes the output budget and the call truncates even at 16k tokens. Extraction (Haiku) calls stay `effort=None`.
- `graph.py` `_ingredient_ids` matches a name to *all* ingredient ids sharing it (`name_to_ids: dict[str, list[str]]`), not just the last-seen — duplicate ingredient names (e.g. two "Butter" entries) are both consumable now.
- Tier 1 (`build_linear_graph`/`force_linear=True`) guarantees all ten invariants by *dropping* unsupportable claims (unconsumed ingredient → `optional=True`; orphaned `produces` → never set; `stated_total_min` → dropped if durations contradict it) — never by inventing a number or fact. Do not weaken this.

**Constraints for Step 11 (API routes) to respect:**
- Don't touch `validate.py`'s ten invariants or `stated_total_min` behavior.
- One repair pass max; `repair_or_degrade` already raises if called with no violations — call it only after a `validate()` failure.
- `ImportResult.status` must distinguish Tier 0 (`method_not_grounded`) / repaired / degraded outcomes; `RepairOutcome.tier` already carries this.

**Next task goal:** Step 11 — `api/routes/import_.py` (`POST /import` job + `GET /import/{job_id}` poll per design doc §4.5), `JobStore` protocol + in-memory dict, `main.py` registration, `test_api_import.py`. Do not start Step 12 (frontend).

**Relevant paths:** `apps/api/abc_cook/extract/{normalize,graph,repair,provenance,corroborate,validate}.py`, `extract/adapters/{base,anthropic}.py`, `schema/api.py` (`ImportJobResponse`), `tests/fixtures/import/`.
