"""Orchestrates one full import: a URL -> an `ImportResult`. No FastAPI here.

See docs/M2.9-youtube-import-design.md §4.1 for the seam diagram this wires together:
acquire -> normalize -> graph -> validate -> repair_or_degrade (only on failure) ->
provenance -> corroborate -> schedule. Kept separate from `api/routes/import_.py` so
the pipeline is testable without an ASGI app -- the same reason `graph.py`/`repair.py`
are their own modules rather than one big function -- and so the route module's only
job is HTTP plumbing and job-state bookkeeping.

One LLM call per import (CLAUDE.md), two only if `validate()` finds a violation and
`repair_or_degrade` fires its one repair pass -- this module makes no LLM call of its
own; it only sequences calls already owned by `normalize.py` and `repair.py`.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlparse

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import NoRecipeFoundError
from abc_cook.extract.acquire.pipeline import acquire as default_acquire
from abc_cook.extract.acquire.preview import build_preview
from abc_cook.extract.adapters.base import CallUsage, EffortLevel, LLMAdapter
from abc_cook.extract.cache import (
    CachedResult,
    ResultCache,
    cache_identity,
    current_fingerprint,
    is_cacheable,
    is_cacheable_source,
)
from abc_cook.extract.normalize import EXTRACTION_EFFORT, normalize, render_source_text
from abc_cook.extract.postprocess import (
    DEFAULT_BURNER_CAPACITY,  # noqa: F401 -- re-exported; cache.py reads it from here
    Tier,
    postprocess,
)
from abc_cook.extract.pricing import total_cost_inr
from abc_cook.extract.repair import RepairOutcome, repair_or_degrade
from abc_cook.extract.source_key import SourceKey, make_source_key
from abc_cook.extract.validate import Violation
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    ImportOriginal,
    ImportResult,
    ImportSource,
    ImportStatus,
    NormalizedRecipe,
    SourcePreview,
)

_logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ImportTelemetry:
    """Measured facts about one `run_import` call (M2.10 s18 F5).

    Deliberately not a field on `ImportResult` (that schema is the frozen /import
    response contract, and TS types are generated from it -- CLAUDE.md) -- a caller
    that wants this passes `on_telemetry`. `cost_inr` is None whenever any call's
    model has no known price (`pricing.py`) rather than silently under-reporting.
    Does not include a dangling-branch count (diagnosis §E "second cause" / metric
    #10) -- detecting that needs graph-topology analysis this phase didn't build.
    """

    extraction_calls: list[CallUsage]
    extraction_escalated: bool
    extraction_truncations: int
    repair_calls: list[CallUsage]
    violations_pre_repair: list[str]
    tier: Tier
    step_count: int
    windows: int
    saved_min: float
    sources: list[ImportSource]
    source_kind: str = "unknown"
    """Coarse host family of the URL ("youtube" / "instagram" / "other") -- derived from
    the hostname only, for bench tables; never used for routing."""
    stage_s: dict[str, float] = field(default_factory=dict)
    """A0: wall-clock seconds per pipeline stage, keys `acquire`, `extract` (normalize,
    incl. its escalation retry), `build_graph`, `repair` (0.0 when none fired),
    `schedule`. A stage the run never reached is absent (a Tier 0 refusal has no
    `build_graph`). `extract` includes the ~all of GPT-5-mini's reasoning time."""
    ttp_s: float = 0.0
    """Time-to-cooking-plan: seconds from `run_import` entry to the finished result."""
    ttr_s: float = 0.0
    """Time-to-readable-recipe: seconds until the user could first read the recipe.
    With no progressive preview yet (A2) this equals `ttp_s` by definition -- the
    recipe is only readable when the whole plan is. A2 will make it the end of acquire
    for blog URLs, so bench tables stay comparable across that change."""
    repair_attempted: bool | None = None
    """M2.10 s18 repair-scope triage: None when no repair was needed at all (tier is
    "tier0" or "clean"); False when violations existed but the triage gate skipped
    the Sonnet call because at least one was outside `repair.REPAIRABLE_RULES`
    (`repair_calls` is then always `[]`); True when repair was actually attempted."""
    repair_skip_reason: str | None = None
    cache_hit: bool = False
    """A3: True when the result was served from the result cache -- no acquire, no LLM
    call, no scheduling ran (`tier`/`step_count` are the stored cold run's, and `stage_s`
    is just `{"cache": seconds}`). Never set on the cold path."""

    @property
    def total_calls(self) -> list[CallUsage]:
        """Every real LLM call this import made, extraction then repair, in order."""
        return [*self.extraction_calls, *self.repair_calls]

    @property
    def degraded(self) -> bool:
        """True when the user got the linear fallback rather than a scheduled graph."""
        return self.tier == "degraded"

    @property
    def output_tokens(self) -> int:
        """Total output tokens across every call (includes reasoning tokens)."""
        return sum(c.output_tokens for c in self.total_calls)

    @property
    def reasoning_tokens(self) -> int | None:
        """Total hidden reasoning tokens, or None if no call reported any."""
        reported = [c.reasoning_tokens for c in self.total_calls if c.reasoning_tokens is not None]
        return sum(reported) if reported else None

    @property
    def cost_inr(self) -> float | None:
        """This import's total measured cost, or None if any call is unpriced."""
        return total_cost_inr(self.total_calls)


def _source_kind(url: str) -> str:
    """Coarse host family for telemetry only (`ImportTelemetry.source_kind`)."""
    host = (urlparse(url).hostname or "").lower()
    if host.endswith(("youtube.com", "youtu.be")):
        return "youtube"
    if host.endswith("instagram.com"):
        return "instagram"
    return "other"


def _sources(raw: RawAcquisition) -> list[ImportSource]:
    """Which acquisition legs actually produced something, in leg order (M2.10)."""
    sources: list[ImportSource] = []
    if raw.description:
        sources.append("description")
    if raw.blog_recipe is not None:
        sources.append("blog")
    if raw.transcript:
        sources.append("transcript")
    return sources


def _lookup(cache: ResultCache, identity: str) -> CachedResult | None:
    """`cache.get`, with any failure treated as a miss (a cache never fails an import)."""
    try:
        return cache.get(identity)
    except Exception:
        _logger.warning("result cache: get failed; treating as a miss", exc_info=True)
        return None


def _store(cache: ResultCache, identity: str, entry: CachedResult) -> None:
    """`cache.put`, best effort."""
    try:
        cache.put(identity, entry)
    except Exception:
        _logger.warning("result cache: put failed; continuing", exc_info=True)


def run_import(
    url: str,
    adapter: LLMAdapter,
    *,
    graph_id: str,
    acquire_fn: Callable[[str], RawAcquisition] = default_acquire,
    on_status: Callable[[ImportStatus], None] | None = None,
    on_telemetry: Callable[[ImportTelemetry], None] | None = None,
    on_preview: Callable[[SourcePreview], None] | None = None,
    extraction_effort: EffortLevel | None = EXTRACTION_EFFORT,
    cache: ResultCache | None = None,
    fresh: bool = False,
    source_key: SourceKey | None = None,
) -> ImportResult:
    """Run the full pipeline for one URL.

    Args:
        url: The recipe source URL.
        adapter: The LLM provider boundary, passed through to `normalize.py` and,
            if needed, `repair.py`.
        graph_id: Id for the resulting `CookingGraph` -- callers pass the job id so
            the graph and the job that produced it share one identifier.
        acquire_fn: Defaults to the real YouTube+blog pipeline; overridden in tests
            with a fake so this stays offline by default.
        on_status: Optional callback invoked as the pipeline crosses each design-doc
            §4.5 stage (`acquiring` / `extracting` / `validating`), so the caller can
            update a poll-able job store in real time. Never invoked with a terminal
            status -- the return value is the source of truth for that.
        on_telemetry: Optional callback invoked exactly once, right before this
            function returns, with this import's `ImportTelemetry` (M2.10 s18 F5) --
            never a field on `ImportResult` itself (§ImportTelemetry docstring).
        extraction_effort: Reasoning effort for the extraction call (default: the
            provider's own, i.e. production behaviour). Overridden only by the A4 A/B script.
        on_preview: Optional callback invoked once, right after acquire, when the
            source has a readable `SourcePreview` (A2). From then on the reported
            status is `plan_building` instead of `extracting`/`validating`.
        cache: Optional result cache (A3). `None` (the default) leaves the pipeline
            exactly as it was. When set, a repeat import of a cacheable source returns
            the stored result untouched -- same `graph.id`, same `source.imported_at` --
            without calling acquire, the adapter, `build_graph` or `schedule`.
        fresh: Skip the cache *lookup* only; a cacheable result is still stored.
        source_key: The typed source key. Defaults to the URL's own
            (`make_source_key("url", url)`); the route passes a `text` key for pasted
            text. Text and fallback-derived keys (`SourceKey.is_fallback`) are never
            cached (no get, no put).

    Returns:
        An `ImportResult`. Always one of the three tiers (§4.2): Tier 0 refusal,
        Tier 1 linear degrade, or a clean/Tier-1.5 scheduled plan -- never a raise for
        an ordinary extraction failure. Only a genuinely unexpected error (a bug, a
        network exception `acquire_fn` doesn't catch) propagates to the caller.
    """
    started = time.monotonic()
    stage_s: dict[str, float] = {}

    def _timed[T](stage: str, fn: Callable[[], T]) -> T:
        t0 = time.monotonic()
        try:
            return fn()
        finally:
            stage_s[stage] = time.monotonic() - t0

    has_preview = False
    sources: list[ImportSource] = []
    source_label = _source_kind(url)

    key = source_key if source_key is not None else make_source_key("url", url)
    use_cache = cache is not None and is_cacheable_source(key)
    identity = (
        cache_identity(key.value, current_fingerprint(extraction_effort)) if use_cache else None
    )

    def _status(status: ImportStatus) -> None:
        if has_preview and status in ("extracting", "validating"):
            status = "plan_building"
        _logger.info(
            "run_import: graph_id=%s -> %s at %.1fs", graph_id, status, time.monotonic() - started
        )
        if on_status is not None:
            on_status(status)

    def _telemetry(
        *,
        extraction_calls: list[CallUsage],
        extraction_escalated: bool,
        extraction_truncations: int,
        repair_calls: list[CallUsage],
        violations_pre_repair: list[str],
        tier: Tier,
        step_count: int,
        windows: int,
        saved_min: float,
        repair_attempted: bool | None = None,
        repair_skip_reason: str | None = None,
        cache_hit: bool = False,
    ) -> None:
        total_s = time.monotonic() - started
        telemetry = ImportTelemetry(
            extraction_calls=extraction_calls,
            extraction_escalated=extraction_escalated,
            extraction_truncations=extraction_truncations,
            repair_calls=repair_calls,
            violations_pre_repair=violations_pre_repair,
            tier=tier,
            step_count=step_count,
            windows=windows,
            saved_min=saved_min,
            sources=sources,
            source_kind=source_label,
            stage_s=dict(stage_s),
            ttp_s=total_s,
            ttr_s=total_s,
            repair_attempted=repair_attempted,
            repair_skip_reason=repair_skip_reason,
            cache_hit=cache_hit,
        )
        _logger.info(
            "run_import: graph_id=%s finished tier=%s kind=%s ttp=%.1fs stages=%s "
            "out_tokens=%d reasoning_tokens=%s llm calls: %s cache_hit=%s",
            graph_id,
            tier,
            telemetry.source_kind,
            total_s,
            {k: round(v, 2) for k, v in stage_s.items()},
            telemetry.output_tokens,
            telemetry.reasoning_tokens,
            [f"{c.model} {c.latency_ms / 1000:.1f}s" for c in [*extraction_calls, *repair_calls]],
            cache_hit,
        )
        if on_telemetry is not None:
            on_telemetry(telemetry)

    if cache is not None and identity is not None and not fresh:
        hit = _lookup(cache, identity)
        if hit is not None:
            stage_s["cache"] = time.monotonic() - started
            sources = hit.result.sources
            _telemetry(
                extraction_calls=[],
                extraction_escalated=False,
                extraction_truncations=0,
                repair_calls=[],
                violations_pre_repair=[],
                tier=hit.tier,
                step_count=hit.step_count,
                windows=len(hit.result.plan.windows) if hit.result.plan else 0,
                saved_min=hit.result.plan.saved_min if hit.result.plan else 0.0,
                cache_hit=True,
            )
            return hit.result

    _status("acquiring")
    try:
        raw = _timed("acquire", lambda: acquire_fn(url))
    except NoRecipeFoundError as exc:
        _telemetry(
            extraction_calls=[],
            extraction_escalated=False,
            extraction_truncations=0,
            repair_calls=[],
            violations_pre_repair=[],
            tier="tier0",
            step_count=0,
            windows=0,
            saved_min=0.0,
        )
        return ImportResult(status="no_recipe_found", warnings=[str(exc)])
    sources = _sources(raw)
    if raw.source_kind == "text":
        source_label = "text"
    preview = build_preview(raw)
    if preview is not None:
        has_preview = True
        if on_preview is not None:
            on_preview(preview)

    _status("extracting")
    outcome = _timed("extract", lambda: normalize(raw, adapter, effort=extraction_effort))
    if outcome.tier0_result is not None:
        _telemetry(
            extraction_calls=outcome.calls,
            extraction_escalated=outcome.escalated,
            extraction_truncations=outcome.truncations,
            repair_calls=[],
            violations_pre_repair=[],
            tier="tier0",
            step_count=0,
            windows=0,
            saved_min=0.0,
        )
        return outcome.tier0_result.model_copy(
            update={
                "sources": sources,
                "warnings": [*outcome.tier0_result.warnings, *raw.acquisition_warnings],
            }
        )
    recipe = outcome.recipe
    assert recipe is not None  # NormalizeOutcome: exactly one of recipe/tier0_result is set

    _status("validating")
    # A pasted text is its own source (`SourceRef` docs: "the pasted text itself").
    source = SourceRef(
        kind=raw.source_kind,
        value=(raw.description or "") if raw.source_kind == "text" else url,
        imported_at=datetime.now(UTC),
    )
    # Title resolution, graph build, validation, repair/degrade and scheduling all live
    # in `postprocess.py`, shared with the free saved-recipe refresh (`reprocess`).
    # `original` is what that step reads -- and what a saved recipe keeps.
    original = ImportOriginal(
        recipe=recipe,
        repair=None,
        source_text=render_source_text(raw),
        raw_title=raw.title,
        blog_name=raw.blog_recipe.get("name") if raw.blog_recipe else None,
        source=source,
        graph_id=graph_id,
        acquisition_warnings=list(raw.acquisition_warnings),
        sources=sources,
    )

    def _live_repair(
        recipe: NormalizedRecipe,
        source_text: str,
        violations: list[Violation],
        *,
        graph_id: str,
        source: SourceRef,
    ) -> RepairOutcome:
        return repair_or_degrade(
            recipe, source_text, violations, adapter, graph_id=graph_id, source=source
        )

    post = postprocess(original, repair_fn=_live_repair)
    stage_s.update(post.stage_s)
    result = post.result
    if result.status != "done":
        _telemetry(
            extraction_calls=outcome.calls,
            extraction_escalated=outcome.escalated,
            extraction_truncations=outcome.truncations,
            repair_calls=[],
            violations_pre_repair=[],
            tier="tier0",
            step_count=len(post.recipe.steps),
            windows=0,
            saved_min=0.0,
        )
        return result

    assert result.plan is not None  # status "done" always carries a plan
    _telemetry(
        extraction_calls=outcome.calls,
        extraction_escalated=outcome.escalated,
        extraction_truncations=outcome.truncations,
        repair_calls=post.repair.calls if post.repair is not None else [],
        violations_pre_repair=[v.rule for v in post.violations_pre_repair],
        tier=post.tier,
        step_count=len(post.recipe.steps),
        windows=len(result.plan.windows),
        saved_min=result.plan.saved_min,
        repair_attempted=post.repair.repair_attempted if post.repair is not None else None,
        repair_skip_reason=post.repair.skip_reason if post.repair is not None else None,
    )
    # Second `text:` guard on purpose: `raw.source_kind` is the acquisition's own word
    # for it, independent of whatever `source_key` the caller passed.
    if (
        cache is not None
        and identity is not None
        and raw.source_kind != "text"
        and post.tier in ("clean", "repaired")
        and is_cacheable(result, post.tier)
    ):
        _store(cache, identity, CachedResult(result, post.tier, len(post.recipe.steps)))
    return result
