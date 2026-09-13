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

from collections.abc import Callable
from datetime import UTC, datetime

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.pipeline import acquire as default_acquire
from abc_cook.extract.adapters.base import LLMAdapter
from abc_cook.extract.corroborate import corroborate
from abc_cook.extract.graph import build_graph
from abc_cook.extract.normalize import normalize, render_source_text
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.repair import repair_or_degrade
from abc_cook.extract.validate import validate
from abc_cook.schedule import schedule, stage_spans
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import ImportResult, ImportStatus

DEFAULT_BURNER_CAPACITY = 1
"""Imports carry no kitchen sidecar (unlike `api/routes/recipes.py`'s fixtures) --
one burner is the safe default (COOKING_GRAPH.md §4.6)."""


def run_import(
    url: str,
    adapter: LLMAdapter,
    *,
    graph_id: str,
    acquire_fn: Callable[[str], RawAcquisition] = default_acquire,
    on_status: Callable[[ImportStatus], None] | None = None,
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

    Returns:
        An `ImportResult`. Always one of the three tiers (§4.2): Tier 0 refusal,
        Tier 1 linear degrade, or a clean/Tier-1.5 scheduled plan -- never a raise for
        an ordinary extraction failure. Only a genuinely unexpected error (a bug, a
        network exception `acquire_fn` doesn't catch) propagates to the caller.
    """

    def _status(status: ImportStatus) -> None:
        if on_status is not None:
            on_status(status)

    _status("acquiring")
    raw = acquire_fn(url)

    _status("extracting")
    outcome = normalize(raw, adapter)
    if outcome.tier0_result is not None:
        return outcome.tier0_result
    recipe = outcome.recipe
    assert recipe is not None  # NormalizeOutcome: exactly one of recipe/tier0_result is set

    _status("validating")
    source_text = render_source_text(raw)
    source = SourceRef(kind="url", value=url, imported_at=datetime.now(UTC))

    build_result = build_graph(recipe, source_text, graph_id=graph_id, source=source)
    if build_result.graph is None:
        # Defensive only -- normalize.py's Tier 0 gate (bool(recipe.steps)) should
        # already have stopped this above; graph.py's own docstring says never rely
        # on a caller remembering that (§10.C).
        return ImportResult(
            status="method_not_grounded",
            source_title=recipe.title,
            ingredients=recipe.ingredients,
            warnings=[*build_result.warnings, "graph.py refused after normalize.py passed."],
        )

    violations = validate(build_result.graph)
    if violations:
        repair_outcome = repair_or_degrade(
            recipe, source_text, violations, adapter, graph_id=graph_id, source=source
        )
        build_result = repair_outcome.build_result

    graph = build_result.graph
    assert graph is not None  # both build_graph and repair_or_degrade guarantee this

    plan = schedule(graph, burner_capacity=DEFAULT_BURNER_CAPACITY)
    return ImportResult(
        status="done",
        source_title=recipe.title,
        ingredients=recipe.ingredients,
        graph=graph,
        plan=plan,
        stages=stage_spans(graph, plan),
        provenance=compute_provenance(build_result),
        review_recommended=build_result.review_recommended,
        warnings=[*build_result.warnings, *corroborate(recipe, graph)],
    )
