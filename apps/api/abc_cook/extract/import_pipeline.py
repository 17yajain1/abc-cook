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
from typing import Literal
from urllib.parse import urlparse

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import NoRecipeFoundError
from abc_cook.extract.acquire.pipeline import acquire as default_acquire
from abc_cook.extract.acquire.preview import build_preview
from abc_cook.extract.adapters.base import CallUsage, LLMAdapter
from abc_cook.extract.corroborate import corroborate
from abc_cook.extract.graph import build_graph
from abc_cook.extract.normalize import normalize, render_source_text
from abc_cook.extract.pricing import total_cost_inr
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.repair import repair_or_degrade
from abc_cook.extract.title import resolve_title
from abc_cook.extract.validate import validate
from abc_cook.schedule import schedule, stage_spans, summarize
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    ImportResult,
    ImportSource,
    ImportStatus,
    SourcePreview,
)

DEFAULT_BURNER_CAPACITY = 1
"""Imports carry no kitchen sidecar (unlike `api/routes/recipes.py`'s fixtures) --
one burner is the safe default (COOKING_GRAPH.md §4.6)."""

_logger = logging.getLogger(__name__)

Tier = Literal["tier0", "clean", "repaired", "degraded"]


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


def run_import(
    url: str,
    adapter: LLMAdapter,
    *,
    graph_id: str,
    acquire_fn: Callable[[str], RawAcquisition] = default_acquire,
    on_status: Callable[[ImportStatus], None] | None = None,
    on_telemetry: Callable[[ImportTelemetry], None] | None = None,
    on_preview: Callable[[SourcePreview], None] | None = None,
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
        on_preview: Optional callback invoked once, right after acquire, when the
            source has a readable `SourcePreview` (A2). From then on the reported
            status is `plan_building` instead of `extracting`/`validating`.

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
        )
        _logger.info(
            "run_import: graph_id=%s finished tier=%s kind=%s ttp=%.1fs stages=%s "
            "out_tokens=%d reasoning_tokens=%s llm calls: %s",
            graph_id,
            tier,
            telemetry.source_kind,
            total_s,
            {k: round(v, 2) for k, v in stage_s.items()},
            telemetry.output_tokens,
            telemetry.reasoning_tokens,
            [f"{c.model} {c.latency_ms / 1000:.1f}s" for c in [*extraction_calls, *repair_calls]],
        )
        if on_telemetry is not None:
            on_telemetry(telemetry)

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
    outcome = _timed("extract", lambda: normalize(raw, adapter))
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

    # P1 #5 Commit 3: resolve `graph.title` once, here, before `build_graph` --
    # never in graph.py, which only ever copies `recipe.title` through. The model's
    # own claim is accepted if it's grounded in the raw title or the linked blog's
    # `name`; otherwise this replaces it with a deterministic cleanup of the raw
    # title. `source_title` below is deliberately never read from `recipe.title`,
    # resolved or not -- it is always `raw.title`, verbatim (title.py).
    blog_name = raw.blog_recipe.get("name") if raw.blog_recipe else None
    resolved_title = resolve_title(
        recipe.title,
        raw.title,
        blog_name,
        source_text=raw.description if raw.source_kind == "text" else None,
    )
    if resolved_title != recipe.title:
        recipe = recipe.model_copy(update={"title": resolved_title})

    _status("validating")
    source_text = render_source_text(raw)
    # A pasted text is its own source (`SourceRef` docs: "the pasted text itself").
    source = SourceRef(
        kind=raw.source_kind,
        value=(raw.description or "") if raw.source_kind == "text" else url,
        imported_at=datetime.now(UTC),
    )

    build_result = _timed(
        "build_graph",
        lambda: build_graph(recipe, source_text, graph_id=graph_id, source=source),
    )
    if build_result.graph is None:
        # Defensive only -- normalize.py's Tier 0 gate (bool(recipe.steps)) should
        # already have stopped this above; graph.py's own docstring says never rely
        # on a caller remembering that (§10.C).
        _telemetry(
            extraction_calls=outcome.calls,
            extraction_escalated=outcome.escalated,
            extraction_truncations=outcome.truncations,
            repair_calls=[],
            violations_pre_repair=[],
            tier="tier0",
            step_count=len(recipe.steps),
            windows=0,
            saved_min=0.0,
        )
        return ImportResult(
            status="method_not_grounded",
            source_title=raw.title,
            ingredients=recipe.ingredients,
            warnings=[
                *build_result.warnings,
                *raw.acquisition_warnings,
                "graph.py refused after normalize.py passed.",
            ],
            sources=sources,
        )

    violations = validate(build_result.graph)
    repair_calls: list[CallUsage] = []
    tier: Tier = "clean"
    repair_attempted: bool | None = None
    repair_skip_reason: str | None = None
    if violations:
        repair_outcome = _timed(
            "repair",
            lambda: repair_or_degrade(
                recipe, source_text, violations, adapter, graph_id=graph_id, source=source
            ),
        )
        build_result = repair_outcome.build_result
        repair_calls = repair_outcome.calls
        tier = repair_outcome.tier
        repair_attempted = repair_outcome.repair_attempted
        repair_skip_reason = repair_outcome.skip_reason

    graph = build_result.graph
    assert graph is not None  # both build_graph and repair_or_degrade guarantee this

    # §2.2 of docs/cooking-plan-investigation.md: repair_or_degrade's docstring claims
    # its output is "guaranteed to pass all ten invariants by construction" (true as
    # of B2), but this was never actually re-checked here, so a violation of that
    # guarantee could ship silently -- exactly how a still-invalid degraded plan
    # reached the client before B2. Never raises: CLAUDE.md's "the app must never
    # fail to show a recipe just because the graph was malformed" applies here too --
    # this is a monitoring signal, not a gate.
    final_violations = validate(graph)
    if final_violations:
        _logger.error(
            "run_import: graph_id=%s shipped a plan despite failing validate() after "
            "%s -- this should be structurally impossible; violations: %s",
            graph_id,
            "repair/degrade" if violations else "build_graph",
            [v.rule for v in final_violations],
        )

    plan = _timed("schedule", lambda: schedule(graph, burner_capacity=DEFAULT_BURNER_CAPACITY))
    _telemetry(
        extraction_calls=outcome.calls,
        extraction_escalated=outcome.escalated,
        extraction_truncations=outcome.truncations,
        repair_calls=repair_calls,
        violations_pre_repair=[v.rule for v in violations],
        tier=tier,
        step_count=len(recipe.steps),
        windows=len(plan.windows),
        saved_min=plan.saved_min,
        repair_attempted=repair_attempted,
        repair_skip_reason=repair_skip_reason,
    )
    return ImportResult(
        status="done",
        source_title=raw.title,
        ingredients=recipe.ingredients,
        graph=graph,
        plan=plan,
        stages=stage_spans(graph, plan),
        summary=summarize(graph, plan, burner_capacity=DEFAULT_BURNER_CAPACITY),
        provenance=compute_provenance(build_result),
        review_recommended=build_result.review_recommended,
        warnings=[*build_result.warnings, *raw.acquisition_warnings, *corroborate(recipe, graph)],
        sources=sources,
    )
