"""A8 offline: pasted recipe text -> same normalize path, no acquisition.

Covers the text acquisition module, title grounding against the pasted text, the
`SourceRef(kind="text")` provenance, and the `POST /import {text}` route (including the
422s). Fakes only: no network, no LLM.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.text import (
    MAX_CHARS,
    MIN_CHARS,
    PastedTextError,
    clean_text,
    derive_title,
    from_pasted_text,
)
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import
from abc_cook.extract.title import resolve_title
from abc_cook.schema.api import ImportJobResponse
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

PASTED = (
    "Dal Makhni\r\n\r\n\r\n\r\nIngredients: 1 cup black lentils, 1 onion.\r\n"
    "Method: Heat oil, add onion, cook until golden, serve hot."
)


@dataclass
class _FakeAdapter:
    results: list[ExtractResult]
    calls: int = 0
    last_source_text: str = ""

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
        self.last_source_text = source_text
        result = self.results[self.calls]
        self.calls += 1
        return result


def _recipe(title: str = "Dal Makhni") -> NormalizedRecipe:
    return NormalizedRecipe(
        title=title,
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None)],
        steps=[
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
    )


# --- text acquisition --------------------------------------------------------------


def test_clean_text_normalises_newlines_and_collapses_blank_runs() -> None:
    assert clean_text("  a\r\n\r\n\r\n\r\nb\rc  ") == "a\n\nb\nc"


def test_derive_title_is_the_first_nonblank_line_only() -> None:
    assert derive_title("\n\n  Dal Makhni  \nIngredients: ...") == "Dal Makhni"
    long = "word " * 40
    title = derive_title(long)
    assert len(title) <= 80
    assert long.startswith(title)  # only ever a substring of what was pasted
    assert derive_title("   \n  ") == "Pasted recipe"


def test_from_pasted_text_builds_a_description_leg_text_source() -> None:
    raw = from_pasted_text(PASTED)
    assert raw.source_kind == "text"
    assert raw.source_url == ""
    assert raw.title == "Dal Makhni"
    assert raw.description is not None
    assert "\r" not in raw.description
    assert raw.blog_recipe is None
    assert raw.transcript is None


def test_user_supplied_title_wins_over_the_first_line() -> None:
    assert from_pasted_text(PASTED, "  Grandma's Dal ").title == "Grandma's Dal"


def test_too_short_and_too_long_are_refused_with_a_user_safe_message() -> None:
    with pytest.raises(PastedTextError, match="too short"):
        from_pasted_text("x" * (MIN_CHARS - 1))
    with pytest.raises(PastedTextError, match="too long"):
        from_pasted_text("x" * (MAX_CHARS + 1))
    assert from_pasted_text("x" * MIN_CHARS).description  # boundary is inclusive


# --- title grounding ---------------------------------------------------------------


def test_title_claim_is_grounded_in_the_pasted_text_not_just_its_first_line() -> None:
    first_line = "Ingredients"
    text = "Ingredients\n1 cup lentils\nMake the Dal Makhni by simmering overnight."
    # Without the source text the claim is ungrounded in the one-word "title".
    assert resolve_title("Dal Makhni", first_line) == "Ingredients"
    assert resolve_title("Dal Makhni", first_line, source_text=text) == "Dal Makhni"


def test_invented_claim_is_still_rejected_with_source_text() -> None:
    text = "Ingredients\n1 cup lentils\nSimmer overnight."
    assert resolve_title("Butter Chicken", "Ingredients", source_text=text) == "Ingredients"


# --- pipeline provenance -----------------------------------------------------------


def test_text_import_records_text_provenance_and_skips_acquisition() -> None:
    raw = from_pasted_text(PASTED)
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_recipe())])
    seen: list[ImportTelemetry] = []

    result = run_import(
        "",
        adapter,
        graph_id="g_text",
        acquire_fn=lambda url: raw,
        on_telemetry=seen.append,
    )

    assert result.status == "done"
    assert result.graph is not None
    assert result.graph.source.kind == "text"
    assert result.graph.source.value == raw.description
    assert result.graph.title == "Dal Makhni"
    assert result.sources == ["description"]  # same provenance leg as any caption/description
    assert seen[0].source_kind == "text"
    assert "Dal Makhni" in adapter.last_source_text  # the model saw the pasted text
    assert adapter.calls == 1


# --- route -------------------------------------------------------------------------


def _client(adapter: _FakeAdapter) -> TestClient:
    def _boom(url: str) -> RawAcquisition:
        raise AssertionError("acquire must not run for pasted text")

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _boom
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    return TestClient(app)


def test_post_text_runs_the_same_pipeline_without_acquire() -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_recipe())])
    client = _client(adapter)

    job_id = client.post("/import", json={"text": PASTED}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "done"
    assert job.preview is None  # nothing to preview: the user already has the text
    assert job.result is not None
    assert job.result.graph is not None
    assert job.result.graph.source.kind == "text"


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ({}, "exactly one"),
        ({"url": "https://a.example/x", "text": PASTED}, "exactly one"),
        ({"text": "short"}, "too short"),
        ({"text": "x" * (MAX_CHARS + 1)}, "too long"),
    ],
)
def test_bad_bodies_are_422_before_any_job_or_llm_call(body: dict[str, str], fragment: str) -> None:
    adapter = _FakeAdapter(results=[])
    client = _client(adapter)

    response = client.post("/import", json=body)

    assert response.status_code == 422
    assert fragment in response.text
    assert adapter.calls == 0


def test_url_requests_are_unchanged() -> None:
    raw = RawAcquisition(
        source_url="https://youtu.be/t", title="Dal Makhni", description="1 onion."
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_recipe())])
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: lambda url: raw
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/t"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "done"
    assert job.result is not None
    assert job.result.graph is not None
    assert job.result.graph.source.kind == "url"
    assert job.result.graph.source.value == "https://youtu.be/t"
