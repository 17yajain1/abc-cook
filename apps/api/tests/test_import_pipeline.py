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
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.graph import GraphBuildResult
from abc_cook.extract.import_pipeline import run_import
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
