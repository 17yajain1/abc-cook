"""Everything between the extraction model's JSON and the finished plan, as one pure step.

`run_import` (a cold import) and `reprocess` (a saved recipe refreshed for free) both end
here, so a plan produced either way comes from the same code:

    resolve_title -> build_graph -> validate -> (repair | degrade) -> schedule
        -> stage_spans / summarize / compute_provenance / corroborate

The only difference between the two callers is `repair_fn`. A cold import passes one that
may call the LLM (`repair.repair_or_degrade`); `reprocess` passes a replay of the stored
`RepairProposal` (`repair.replay_repair_or_degrade`) and takes no adapter at all, so an
LLM call from a refresh is structurally impossible.

No I/O, no clock reads (the source's `imported_at` travels in `ImportOriginal`), no
randomness. Same `ImportOriginal` in, same `ImportResult` out.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from abc_cook.extract.cache import POSTPROCESS_VERSION
from abc_cook.extract.corroborate import corroborate
from abc_cook.extract.graph import build_graph
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.repair import RepairOutcome, replay_repair_or_degrade
from abc_cook.extract.title import resolve_title
from abc_cook.extract.validate import Violation, validate
from abc_cook.schedule import schedule, stage_spans, summarize
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import ImportOriginal, ImportResult, NormalizedRecipe

DEFAULT_BURNER_CAPACITY = 1
"""Imports carry no kitchen sidecar (unlike `api/routes/recipes.py`'s fixtures) --
one burner is the safe default (COOKING_GRAPH.md §4.6)."""

_logger = logging.getLogger(__name__)

Tier = Literal["tier0", "clean", "repaired", "degraded"]

RepairFn = Callable[..., RepairOutcome]
"""`(recipe, source_text, violations, *, graph_id, source) -> RepairOutcome`. Called only
when `validate()` found a violation; must return a graph that passes `validate()`."""


@dataclass(frozen=True)
class PostprocessOutput:
    """What `postprocess` produced, plus the facts a cold import reports as telemetry."""

    result: ImportResult
    tier: Tier
    recipe: NormalizedRecipe
    """The extraction output after title resolution (what `build_graph` actually saw)."""
    violations_pre_repair: list[Violation]
    repair: RepairOutcome | None
    stage_s: dict[str, float] = field(default_factory=dict)
    """Wall-clock seconds for `build_graph`, `repair` (absent when none fired), `schedule`."""


def postprocess(original: ImportOriginal, *, repair_fn: RepairFn) -> PostprocessOutput:
    """Build the graph, plan and rollups for `original`.

    Args:
        original: The post-processing inputs (`ImportOriginal`). Its `repair` field is
            ignored here; `repair_fn` decides how a violation is repaired.
        repair_fn: Called with `(recipe, source_text, violations, graph_id=..., source=...)`
            when the first graph fails `validate()`. Never called on a clean graph.

    Returns:
        A `PostprocessOutput`. `result.status` is `done` with the graph, plan, stages,
        summary, provenance, `original` (with the proposal that was actually applied)
        and `postprocess_version`, or `method_not_grounded` if `build_graph` refused
        (defensive: `normalize.py`'s Tier 0 gate should have stopped that already).
    """
    stage_s: dict[str, float] = {}

    def _timed[T](stage: str, fn: Callable[[], T]) -> T:
        t0 = time.monotonic()
        try:
            return fn()
        finally:
            stage_s[stage] = time.monotonic() - t0

    # P1 #5 Commit 3: resolve `graph.title` once, here, before `build_graph` -- never in
    # graph.py, which only ever copies `recipe.title` through. The model's own claim is
    # accepted if it's grounded in the raw title or the linked blog's `name`; otherwise
    # this replaces it with a deterministic cleanup of the raw title. `source_title` is
    # deliberately never read from `recipe.title`, resolved or not -- it is always the
    # raw title, verbatim (title.py).
    recipe = original.recipe
    resolved_title = resolve_title(
        recipe.title,
        original.raw_title,
        original.blog_name,
        source_text=original.source.value if original.source.kind == "text" else None,
    )
    if resolved_title != recipe.title:
        recipe = recipe.model_copy(update={"title": resolved_title})

    graph_id = original.graph_id
    source: SourceRef = original.source
    build_result = _timed(
        "build_graph",
        lambda: build_graph(recipe, original.source_text, graph_id=graph_id, source=source),
    )
    if build_result.graph is None:
        # Defensive only -- normalize.py's Tier 0 gate (bool(recipe.steps)) should
        # already have stopped this; graph.py's own docstring says never rely on a
        # caller remembering that (§10.C).
        return PostprocessOutput(
            result=ImportResult(
                status="method_not_grounded",
                source_title=original.raw_title,
                ingredients=recipe.ingredients,
                warnings=[
                    *build_result.warnings,
                    *original.acquisition_warnings,
                    "graph.py refused after normalize.py passed.",
                ],
                sources=original.sources,
            ),
            tier="tier0",
            recipe=recipe,
            violations_pre_repair=[],
            repair=None,
            stage_s=stage_s,
        )

    violations = validate(build_result.graph)
    tier: Tier = "clean"
    repair_outcome: RepairOutcome | None = None
    if violations:
        repair_outcome = _timed(
            "repair",
            lambda: repair_fn(
                recipe, original.source_text, violations, graph_id=graph_id, source=source
            ),
        )
        build_result = repair_outcome.build_result
        tier = repair_outcome.tier

    graph = build_result.graph
    assert graph is not None  # both build_graph and repair_fn guarantee this

    # §2.2 of docs/cooking-plan-investigation.md: repair_or_degrade's docstring claims its
    # output is "guaranteed to pass all ten invariants by construction" (true as of B2),
    # but this was never actually re-checked here, so a violation of that guarantee could
    # ship silently -- exactly how a still-invalid degraded plan reached the client before
    # B2. Never raises: CLAUDE.md's "the app must never fail to show a recipe just because
    # the graph was malformed" applies here too -- this is a monitoring signal, not a gate.
    final_violations = validate(graph)
    if final_violations:
        _logger.error(
            "postprocess: graph_id=%s shipped a plan despite failing validate() after "
            "%s -- this should be structurally impossible; violations: %s",
            graph_id,
            "repair/degrade" if violations else "build_graph",
            [v.rule for v in final_violations],
        )

    plan = _timed("schedule", lambda: schedule(graph, burner_capacity=DEFAULT_BURNER_CAPACITY))
    applied = repair_outcome.proposal if repair_outcome is not None else None
    result = ImportResult(
        status="done",
        source_title=original.raw_title,
        ingredients=recipe.ingredients,
        graph=graph,
        plan=plan,
        stages=stage_spans(graph, plan),
        summary=summarize(graph, plan, burner_capacity=DEFAULT_BURNER_CAPACITY),
        provenance=compute_provenance(build_result),
        review_recommended=build_result.review_recommended,
        warnings=[
            *build_result.warnings,
            *original.acquisition_warnings,
            *corroborate(recipe, graph),
        ],
        sources=original.sources,
        original=original.model_copy(update={"repair": applied}),
        postprocess_version=POSTPROCESS_VERSION,
    )
    return PostprocessOutput(
        result=result,
        tier=tier,
        recipe=recipe,
        violations_pre_repair=violations,
        repair=repair_outcome,
        stage_s=stage_s,
    )


def reprocess(original: ImportOriginal) -> PostprocessOutput:
    """Re-run post-processing on a saved recipe's `original`: no acquire, no LLM.

    A stored `RepairProposal` is replayed; if there is none, or it no longer fixes the
    graph under the current code, the result is the deterministic linear degrade.
    Takes no adapter, so a provider call from here is impossible by construction.

    Args:
        original: The inputs kept with the saved recipe.

    Returns:
        The same `PostprocessOutput` a cold import would produce from these inputs.
    """

    def _replay(
        recipe: NormalizedRecipe,
        source_text: str,
        violations: list[Violation],
        *,
        graph_id: str,
        source: SourceRef,
    ) -> RepairOutcome:
        return replay_repair_or_degrade(
            recipe, source_text, violations, original.repair, graph_id=graph_id, source=source
        )

    return postprocess(original, repair_fn=_replay)
