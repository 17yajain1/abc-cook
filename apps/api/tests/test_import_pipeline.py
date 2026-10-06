"""extract/import_pipeline.py -- `source_title` decoupling (P1 #5 Commit 3).

`ImportResult.source_title` must always be `raw.title` verbatim, independent of
whatever `NormalizedRecipe.title` ends up as (the model's own claim, resolved or
fallback-cleaned by `title.py`). Three sites set it: `normalize.py`'s `_tier0_result`
(the Tier 0 path), and two in `import_pipeline.py` itself (the defensive
`build_graph() is None` path, and the ordinary success path). All three are covered
here, offline, with a fake `LLMAdapter` -- same pattern as `test_api_import.py`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import pytest

from abc_cook.extract import import_pipeline
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import NoRecipeFoundError
from abc_cook.extract.adapters.base import CallUsage, ExtractResult
from abc_cook.extract.graph import GraphBuildResult
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import
from abc_cook.extract.title import clean_title
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep


@dataclass
class _FakeAdapter:
    """Returns queued `ExtractResult`s in order, one per `.extract()` call -- same
    shape as `test_api_import.py`'s/`test_extract_normalize.py`'s fakes."""

    results: list[ExtractResult]
    calls: int = 0

    def extract(
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type,
        effort: str | None = None,
    ) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


def _raw(**overrides: object) -> RawAcquisition:
    defaults: dict[str, object] = {
        "source_url": "https://youtu.be/test",
        "title": "Best Ever Dal Makhni Recipe | Restaurant Style At Home",
        "description": "1 onion. Heat oil, add onion, cook until golden. Serve hot.",
    }
    defaults.update(overrides)
    return RawAcquisition(**defaults)  # type: ignore[arg-type]


def _fake_acquire(raw: RawAcquisition) -> Callable[[str], RawAcquisition]:
    return lambda url: raw.model_copy(update={"source_url": url})


def _grounded_recipe(**overrides: object) -> NormalizedRecipe:
    """A single-step recipe -- trivially valid, no repair call fires."""
    defaults: dict[str, object] = {
        "title": "Dal Makhni",  # grounded in the raw title above
        "method_grounded": True,
        "ingredients": [NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None)],
        "steps": [
            NormalizedStep(
                text="Heat oil, add onion, cook until golden, serve hot.",
                attention="hands_on",
                duration_stated=False,
                consumes_ingredients=["Onion"],
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    }
    defaults.update(overrides)
    return NormalizedRecipe(**defaults)  # type: ignore[arg-type]


def _ingredients_only_recipe(**overrides: object) -> NormalizedRecipe:
    """Method not grounded (no steps) -- the Tier 0 path."""
    defaults: dict[str, object] = {
        "title": "Invented Unrelated Name",  # deliberately NOT the raw title's words
        "method_grounded": True,  # the model's own claim -- normalize.py must not trust it
        "ingredients": [NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None)],
        "steps": [],
    }
    defaults.update(overrides)
    return NormalizedRecipe(**defaults)  # type: ignore[arg-type]


def test_tier0_path_source_title_is_raw_title_not_recipe_title() -> None:
    """Site 1 (`normalize.py::_tier0_result`): the model returned a recipe (so
    `_tier0_result` is called WITH a recipe, not None) but with no steps, and its
    `title` claim is unrelated to the raw title -- `source_title` must still be the
    raw title, never that claim."""
    raw = _raw()
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_ingredients_only_recipe())])

    result = run_import(raw.source_url, adapter, graph_id="g_test", acquire_fn=_fake_acquire(raw))

    assert result.status == "method_not_grounded"
    assert result.source_title == raw.title
    assert result.source_title != "Invented Unrelated Name"


def test_defensive_build_graph_none_path_source_title_is_raw_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Site 2 (`import_pipeline.py`'s defensive path): unreachable through normal
    role-resolution (a recipe with all-optional steps is forced back to required --
    `test_all_steps_optional_keeps_them_all_required`), so `build_graph` is
    monkeypatched to return `graph=None` directly, to exercise this exact branch."""
    raw = _raw()
    recipe = _grounded_recipe(title="Invented Unrelated Name")
    adapter = _FakeAdapter(results=[ExtractResult(recipe=recipe)])
    monkeypatch.setattr(
        import_pipeline,
        "build_graph",
        lambda *a, **kw: GraphBuildResult(graph=None, warnings=["forced for the test"]),
    )

    result = run_import(raw.source_url, adapter, graph_id="g_test", acquire_fn=_fake_acquire(raw))

    assert result.status == "method_not_grounded"
    assert result.graph is None
    assert result.source_title == raw.title
    assert result.source_title != "Invented Unrelated Name"


def test_success_path_source_title_is_raw_title_while_graph_title_is_resolved() -> None:
    """Site 3 (`import_pipeline.py`'s success path): `source_title` is the raw
    title; `graph.title` is the SEPARATELY resolved one (`title.py`) -- here the
    model's claim is grounded, so it's accepted verbatim, and the two legitimately
    differ from each other."""
    raw = _raw()
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe(title="Dal Makhni"))])

    result = run_import(raw.source_url, adapter, graph_id="g_test", acquire_fn=_fake_acquire(raw))

    assert result.status == "done"
    assert result.graph is not None
    assert result.source_title == raw.title
    assert result.graph.title == "Dal Makhni"
    assert result.source_title != result.graph.title


def test_success_path_ungrounded_model_title_falls_back_to_cleaned_raw_title() -> None:
    """Same success path, but the model's claim is NOT grounded -- `graph.title`
    must fall back to `clean_title(raw.title)`, never the invented claim, while
    `source_title` is unaffected either way."""
    raw = _raw()
    adapter = _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe(title="Spicy Butter Chicken"))]
    )

    result = run_import(raw.source_url, adapter, graph_id="g_test", acquire_fn=_fake_acquire(raw))

    assert result.status == "done"
    assert result.graph is not None
    assert result.source_title == raw.title
    assert result.graph.title == clean_title(raw.title)
    assert result.graph.title != "Spicy Butter Chicken"


def _usage(*, output_tokens: int, reasoning_tokens: int | None) -> CallUsage:
    return CallUsage(
        model="gpt-5-mini",
        input_tokens=100,
        output_tokens=output_tokens,
        cache_read_input_tokens=None,
        cache_creation_input_tokens=None,
        stop_reason="stop",
        latency_ms=1000.0,
        max_tokens_requested=16000,
        reasoning_tokens=reasoning_tokens,
    )


def test_telemetry_reports_stage_timings_ttr_ttp_and_tokens() -> None:
    """A0: per-stage seconds, TTR/TTP, source kind and reasoning tokens ride on
    `ImportTelemetry` (never on `ImportResult`)."""
    raw = _raw()
    adapter = _FakeAdapter(
        results=[
            ExtractResult(
                recipe=_grounded_recipe(),
                usage=_usage(output_tokens=900, reasoning_tokens=700),
            )
        ]
    )
    seen: list[ImportTelemetry] = []

    run_import(
        raw.source_url,
        adapter,
        graph_id="g_test",
        acquire_fn=_fake_acquire(raw),
        on_telemetry=seen.append,
    )

    (t,) = seen
    assert t.source_kind == "youtube"
    assert t.tier == "clean"
    assert not t.degraded
    # No repair fired -> that stage never ran and is absent, not 0.0.
    assert set(t.stage_s) == {"acquire", "extract", "build_graph", "schedule"}
    assert all(v >= 0.0 for v in t.stage_s.values())
    assert t.ttp_s >= sum(t.stage_s.values()) - 1e-6
    assert t.ttr_s == t.ttp_s  # no progressive preview yet (A2)
    assert t.output_tokens == 900
    assert t.reasoning_tokens == 700


def test_telemetry_reasoning_tokens_none_when_provider_reports_none() -> None:
    raw = _raw()
    adapter = _FakeAdapter(
        results=[
            ExtractResult(
                recipe=_grounded_recipe(),
                usage=_usage(output_tokens=900, reasoning_tokens=None),
            )
        ]
    )
    seen: list[ImportTelemetry] = []

    run_import(
        raw.source_url,
        adapter,
        graph_id="g_test",
        acquire_fn=_fake_acquire(raw),
        on_telemetry=seen.append,
    )

    assert seen[0].reasoning_tokens is None


def _blog_raw() -> RawAcquisition:
    recipe = {
        "@type": "Recipe",
        "name": "Dal Makhni",
        "recipeIngredient": ["1 onion"],
        "recipeInstructions": ["Heat oil, add onion, cook until golden, serve hot."],
    }
    return _raw(description=None, blog_recipe=recipe)


def test_preview_is_emitted_once_and_later_statuses_become_plan_building() -> None:
    """A2: a source with a readable preview reports `plan_building` instead of
    `extracting`/`validating`, and `on_preview` fires before the first of them."""
    raw = _blog_raw()
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    events: list[str] = []

    result = run_import(
        raw.source_url,
        adapter,
        graph_id="g_test",
        acquire_fn=_fake_acquire(raw),
        on_status=lambda status: events.append(f"status:{status}"),
        on_preview=lambda preview: events.append(f"preview:{preview.title}"),
    )

    assert events == [
        "status:acquiring",
        "preview:Dal Makhni",
        "status:plan_building",
        "status:plan_building",
    ]
    assert result.status == "done"


def test_no_preview_for_a_video_without_a_linked_recipe_page() -> None:
    raw = _raw()  # description only
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    events: list[str] = []

    run_import(
        raw.source_url,
        adapter,
        graph_id="g_test",
        acquire_fn=_fake_acquire(raw),
        on_status=events.append,
        on_preview=lambda preview: events.append("preview"),
    )

    assert events == ["acquiring", "extracting", "validating"]


def test_no_recipe_on_page_returns_no_recipe_found_without_any_llm_call() -> None:
    def acquire_fn(url: str) -> RawAcquisition:
        raise NoRecipeFoundError("no Recipe JSON-LD")

    adapter = _FakeAdapter(results=[])  # a call would IndexError

    result = run_import(
        "https://kitchen.example/post", adapter, graph_id="g_test", acquire_fn=acquire_fn
    )

    assert result.status == "no_recipe_found"
    assert result.graph is None
    assert result.plan is None
    assert adapter.calls == 0
