"""extract/postprocess.py + POST /recipes/reprocess -- the free, replay-only path.

A saved recipe keeps the post-processing inputs (`ImportOriginal`); `reprocess` re-runs
everything between the model's JSON and the plan with no acquire and no LLM. These tests
pin the three properties that make that safe to ship:

* equivalence -- replaying a cold import's own `original` reproduces that import exactly;
* a stored repair proposal is replayed, and when it no longer fixes the graph the answer
  is the deterministic linear degrade, never a raise;
* an LLM call is structurally impossible (no adapter parameter; an adapter injected into
  the app that raises on any call is never touched).

Every recipe is built synthetically here, so no recipe name appears in logic.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.api.routes.import_ import get_adapter
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.cache import POSTPROCESS_VERSION
from abc_cook.extract.graph import build_graph
from abc_cook.extract.import_pipeline import run_import
from abc_cook.extract.postprocess import reprocess
from abc_cook.extract.repair import repair_or_degrade
from abc_cook.extract.validate import validate
from abc_cook.schema.api import ReprocessRequest, ReprocessResponse
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    ImportOriginal,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
    RepairProposal,
    StepRepair,
)

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"
SOURCE_TEXT = "Chop the onion. Melt the butter in a pan. Serve hot."
SOURCE = SourceRef(
    kind="url", value="https://example.test/r", imported_at=datetime(2026, 1, 2, tzinfo=UTC)
)


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": True,
        "duration_min": 2,
        "duration_typical_min": 3,
        "duration_max": 5,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _ingredient(name: str) -> NormalizedIngredient:
    return NormalizedIngredient(name=name, qty="1", unit=None, prep_note=None)


def _clean_recipe() -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test",
        method_grounded=True,
        ingredients=[_ingredient("Onion"), _ingredient("Butter")],
        steps=[
            _step(text="Chop the onion.", consumes_ingredients=["Onion"]),
            _step(text="Melt the butter in a pan.", consumes_ingredients=["Butter"]),
            _step(text="Serve hot."),
        ],
    )


def _unconsumed_ingredient_recipe() -> NormalizedRecipe:
    """Builds a graph that fails one repairable rule: 'Salt' is listed, never consumed."""
    return _clean_recipe().model_copy(
        update={"ingredients": [*_clean_recipe().ingredients, _ingredient("Salt")]}
    )


FIXING_PROPOSAL = RepairProposal(
    steps=[
        StepRepair(),
        StepRepair(),
        StepRepair(consumes_ingredients=["Salt"]),
    ]
)
"""Adds the missing 'Salt' consumption to the last step -- fixes the recipe above."""

NON_FIXING_PROPOSAL = RepairProposal(steps=[StepRepair(), StepRepair(), StepRepair()])
"""Well-formed (one entry per step) but leaves the violation in place."""


@dataclass
class _FakeAdapter:
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


@dataclass
class _ExplodingAdapter:
    touched: list[str] = field(default_factory=list)

    def extract(self, **_: object) -> ExtractResult:
        self.touched.append("extract")
        raise AssertionError("reprocess must never call the LLM")


def _raw() -> RawAcquisition:
    return RawAcquisition(
        source_url="https://example.test/r",
        title="Test Recipe",
        description=SOURCE_TEXT,
    )


def _cold_import(
    recipe: NormalizedRecipe, *adapter_results: ExtractResult
) -> tuple[ImportOriginal, object]:
    """Run the real cold pipeline offline; return its own `original` and result."""
    raw = _raw()
    adapter = _FakeAdapter(results=[ExtractResult(recipe=recipe), *adapter_results])
    result = run_import(
        raw.source_url,
        adapter,
        graph_id="g_cold",
        acquire_fn=lambda url: raw.model_copy(update={"source_url": url}),
    )
    assert result.status == "done"
    assert result.original is not None
    return result.original, result


def _hand_built_original(recipe: NormalizedRecipe, repair: RepairProposal | None) -> ImportOriginal:
    return ImportOriginal(
        recipe=recipe,
        repair=repair,
        source_text=SOURCE_TEXT,
        raw_title="Test Recipe",
        blog_name=None,
        source=SOURCE,
        graph_id="g_replay",
        acquisition_warnings=[],
        sources=["description"],
    )


# --- equivalence -----------------------------------------------------------------


def test_reprocess_reproduces_a_clean_cold_import() -> None:
    original, cold = _cold_import(_clean_recipe())
    out = reprocess(original)
    assert out.tier == "clean"
    assert out.result == cold


def test_reprocess_reproduces_a_repaired_cold_import() -> None:
    original, cold = _cold_import(
        _unconsumed_ingredient_recipe(), ExtractResult(recipe=FIXING_PROPOSAL)
    )
    assert original.repair == FIXING_PROPOSAL  # the applied proposal is kept on the original
    out = reprocess(original)
    assert out.tier == "repaired"
    assert out.result == cold


@pytest.mark.parametrize(
    "repair_results",
    [
        [ExtractResult(recipe=NON_FIXING_PROPOSAL)],
        [ExtractResult(recipe=None, error="boom"), ExtractResult(recipe=None, error="boom")],
    ],
    ids=["proposal-does-not-fix", "repair-call-fails"],
)
def test_reprocess_reproduces_a_degraded_cold_import(repair_results: list[ExtractResult]) -> None:
    original, cold = _cold_import(_unconsumed_ingredient_recipe(), *repair_results)
    assert original.repair is None  # a proposal that did not fix the graph is never kept
    assert "degraded" in cold.warnings  # type: ignore[attr-defined]
    out = reprocess(original)
    assert out.tier == "degraded"
    assert out.result == cold


def test_reprocess_reproduces_the_captured_pipeline_replay_input() -> None:
    recipe = NormalizedRecipe.model_validate_json(
        (FIXTURES_DIR / "pizza-dough.normalized.json").read_text(encoding="utf-8")
    )
    raw = RawAcquisition.model_validate_json(
        (FIXTURES_DIR / "pizza-dough.raw.json").read_text(encoding="utf-8")
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=recipe)])
    cold = run_import(
        raw.source_url, adapter, graph_id="g_cap", acquire_fn=lambda url: raw
    )
    assert cold.status == "done"
    assert cold.original is not None
    assert reprocess(cold.original).result == cold


# --- stored repair ---------------------------------------------------------------


def test_stored_repair_is_applied_and_matches_the_cold_repaired_graph() -> None:
    recipe = _unconsumed_ingredient_recipe()
    original = _hand_built_original(recipe, FIXING_PROPOSAL)

    out = reprocess(original)

    assert out.tier == "repaired"
    graph = out.result.graph
    assert graph is not None
    assert validate(graph) == []

    violations = validate(
        build_graph(recipe, SOURCE_TEXT, graph_id="g_replay", source=SOURCE).graph  # type: ignore[arg-type]
    )
    cold = repair_or_degrade(
        recipe,
        SOURCE_TEXT,
        violations,
        _FakeAdapter(results=[ExtractResult(recipe=FIXING_PROPOSAL)]),
        graph_id="g_replay",
        source=SOURCE,
    )
    assert cold.build_result.graph == graph


def test_stored_repair_that_no_longer_fixes_it_degrades_without_raising() -> None:
    original = _hand_built_original(_unconsumed_ingredient_recipe(), NON_FIXING_PROPOSAL)

    out = reprocess(original)

    assert out.tier == "degraded"
    assert "degraded" in out.result.warnings
    assert out.result.graph is not None
    assert validate(out.result.graph) == []


def test_violations_with_no_stored_proposal_degrade() -> None:
    out = reprocess(_hand_built_original(_unconsumed_ingredient_recipe(), None))
    assert out.tier == "degraded"
    assert "degraded" in out.result.warnings


def test_a_wrong_length_stored_proposal_degrades() -> None:
    short = RepairProposal(steps=[StepRepair()])
    out = reprocess(_hand_built_original(_unconsumed_ingredient_recipe(), short))
    assert out.tier == "degraded"


# --- no LLM ----------------------------------------------------------------------


def test_reprocess_takes_no_adapter() -> None:
    assert list(inspect.signature(reprocess).parameters) == ["original"]


@pytest.fixture
def exploding_client() -> Iterator[tuple[TestClient, _ExplodingAdapter]]:
    app = create_app()
    adapter = _ExplodingAdapter()
    app.dependency_overrides[get_adapter] = lambda: adapter
    with TestClient(app) as client:
        yield client, adapter


@pytest.mark.parametrize(
    ("recipe", "repair", "tier_degraded"),
    [
        (_clean_recipe(), None, False),
        (_unconsumed_ingredient_recipe(), FIXING_PROPOSAL, False),
        (_unconsumed_ingredient_recipe(), NON_FIXING_PROPOSAL, True),
    ],
    ids=["clean", "repaired", "degraded"],
)
def test_route_never_touches_the_adapter(
    exploding_client: tuple[TestClient, _ExplodingAdapter],
    recipe: NormalizedRecipe,
    repair: RepairProposal | None,
    tier_degraded: bool,
) -> None:
    client, adapter = exploding_client
    body = ReprocessRequest(original=_hand_built_original(recipe, repair)).model_dump_json()

    response = client.post(
        "/recipes/reprocess", content=body, headers={"content-type": "application/json"}
    )

    assert response.status_code == 200
    parsed = ReprocessResponse.model_validate(response.json())
    assert parsed.import_meta.degraded is tier_degraded
    assert adapter.touched == []


# --- route limits ----------------------------------------------------------------


def _post(client: TestClient, content: bytes | Callable[[], Iterator[bytes]]) -> object:
    payload = content() if callable(content) else content
    return client.post(
        "/recipes/reprocess", content=payload, headers={"content-type": "application/json"}
    )


def test_valid_body_returns_200_with_the_current_postprocess_version() -> None:
    body = ReprocessRequest(original=_hand_built_original(_clean_recipe(), None))
    with TestClient(create_app()) as client:
        response = _post(client, body.model_dump_json().encode())
    assert response.status_code == 200  # type: ignore[attr-defined]
    parsed = ReprocessResponse.model_validate(response.json())  # type: ignore[attr-defined]
    assert parsed.postprocess_version == POSTPROCESS_VERSION
    assert parsed.payload.graph.id == "g_replay"  # graph_id survives a refresh
    assert parsed.payload.graph.source == SOURCE  # so does imported_at


def test_oversize_body_is_413() -> None:
    with TestClient(create_app()) as client:
        response = _post(client, b" " * (512 * 1024 + 1))
    assert response.status_code == 413  # type: ignore[attr-defined]


def test_oversize_body_without_content_length_is_413() -> None:
    def chunks() -> Iterator[bytes]:
        for _ in range(65):
            yield b" " * 8192

    with TestClient(create_app()) as client:
        response = client.post(
            "/recipes/reprocess",
            content=chunks(),
            headers={"content-type": "application/json"},
        )
    assert response.status_code == 413


def test_malformed_body_is_422() -> None:
    with TestClient(create_app()) as client:
        not_json = _post(client, b"{nope")
        wrong_shape = _post(client, b'{"original": {"recipe": 3}}')
    assert not_json.status_code == 422  # type: ignore[attr-defined]
    assert wrong_shape.status_code == 422  # type: ignore[attr-defined]


@pytest.mark.parametrize("which", ["steps", "ingredients", "source_text"])
def test_field_caps_are_422(which: str) -> None:
    original = _hand_built_original(_clean_recipe(), None)
    if which == "steps":
        original = original.model_copy(
            update={"recipe": original.recipe.model_copy(update={"steps": [_step()] * 201})}
        )
    elif which == "ingredients":
        many = [_ingredient("x")] * 301
        original = original.model_copy(
            update={"recipe": original.recipe.model_copy(update={"ingredients": many})}
        )
    else:
        original = original.model_copy(update={"source_text": "x" * 100_001})
    body = ReprocessRequest(original=original).model_dump_json().encode()
    assert len(body) < 512 * 1024  # the field cap, not the byte cap, is what rejects it
    with TestClient(create_app()) as client:
        response = _post(client, body)
    assert response.status_code == 422  # type: ignore[attr-defined]
