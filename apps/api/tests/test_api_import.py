"""`POST /import` + `GET /import/{job_id}` -- the M2.9 Step 11 job/poll wiring.

Offline by default: `get_adapter`/`get_acquire` are overridden with fakes via
`app.dependency_overrides`, same pattern as the fake `LLMAdapter` in
test_extract_normalize.py/test_extract_repair.py. `TestClient` runs a request's
`BackgroundTasks` to completion before `.post()` returns (Starlette sends the
response, then awaits the background task, within the same call), so these tests
observe the job's terminal state with no polling loop or sleep needed.

The real end-to-end path (real acquisition, real LLM) is a single
`@pytest.mark.llm`/`@pytest.mark.network` test at the bottom, excluded from the
default run (`make test` -> `-m "not llm and not network"`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.schema.api import ImportJobResponse, ImportStartResponse
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

_JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")


@dataclass
class _FakeAdapter:
    """Returns queued `ExtractResult`s in order, one per `.extract()` call."""

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
        "title": "Test Recipe",
        "description": "1 onion. Heat oil, add onion, cook until golden. Serve hot.",
    }
    defaults.update(overrides)
    return RawAcquisition(**defaults)  # type: ignore[arg-type]


def _fake_acquire(url: str) -> RawAcquisition:
    """Stands in for `acquire_fn`: same signature, ignores `url`, returns a fixed raw."""
    return _raw(source_url=url)


def _grounded_recipe() -> NormalizedRecipe:
    """A single-step recipe -- trivially valid: the lone node is both source and
    sink, so every §5 invariant passes on the first attempt and no repair call fires."""
    return NormalizedRecipe(
        title="Test Recipe",
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


def _ingredients_only_recipe() -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test Recipe",
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None)],
        steps=[],
    )


def test_start_import_returns_a_job_id() -> None:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _fake_acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    response = client.post("/import", json={"url": "https://youtu.be/test"})
    assert response.status_code == 202

    started = ImportStartResponse.model_validate(response.json())
    assert _JOB_ID_RE.match(started.job_id)


def test_clean_recipe_reaches_done_with_a_scheduled_plan() -> None:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _fake_acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    response = client.get(f"/import/{job_id}")
    assert response.status_code == 200

    job = ImportJobResponse.model_validate(response.json())
    assert job.status == "done"
    assert job.error is None
    assert job.result is not None
    assert job.result.graph is not None
    assert job.result.plan is not None
    assert job.result.plan.graph_id == job_id  # graph_id == job_id, per import_pipeline.run_import
    assert job.result.stages


def test_ingredients_only_recipe_stops_at_tier_0() -> None:
    """No method text -> `method_not_grounded`, no graph, no plan, no LLM repair call."""
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _fake_acquire
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_ingredients_only_recipe())])
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "method_not_grounded"
    assert job.result is not None
    assert job.result.graph is None
    assert job.result.plan is None
    assert len(job.result.ingredients) == 1  # the shopping list survives Tier 0
    assert adapter.calls == 1  # normalize only -- Tier 0 never reaches repair.py


# ---------------------------------------------------------------------------
# M2.10: ImportResult.sources and acquisition_warnings, on both tiers.
# ---------------------------------------------------------------------------


def test_done_result_reports_all_three_sources_when_all_present() -> None:
    def _acquire_with_all_legs(url: str) -> RawAcquisition:
        return _raw(
            source_url=url,
            blog_recipe={"@type": "Recipe", "recipeIngredient": ["1 onion"]},
            transcript="heat oil, add onion, cook until golden, serve hot",
            transcript_kind="auto",
            transcript_lang="en",
        )

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _acquire_with_all_legs
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "done"
    assert job.result is not None
    assert job.result.sources == ["description", "blog", "transcript"]


def test_tier0_result_reports_only_the_legs_that_were_present() -> None:
    """No blog, no transcript -- `sources` must not claim legs that weren't there."""
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _fake_acquire  # description only
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_ingredients_only_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "method_not_grounded"
    assert job.result is not None
    assert job.result.sources == ["description"]


def test_tier0_result_carries_acquisition_warnings() -> None:
    """A transcript truncation warning from acquisition must survive into the Tier 0
    result too, not just the `done` path -- a human reviewing a refusal should still
    see it."""

    def _acquire_with_warning(url: str) -> RawAcquisition:
        return _raw(source_url=url, acquisition_warnings=["Transcript truncated to 24000 chars."])

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _acquire_with_warning
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_ingredients_only_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.result is not None
    assert "Transcript truncated to 24000 chars." in job.result.warnings


def test_done_result_carries_acquisition_warnings_alongside_corroboration() -> None:
    def _acquire_with_warning(url: str) -> RawAcquisition:
        return _raw(source_url=url, acquisition_warnings=["Transcript truncated to 24000 chars."])

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _acquire_with_warning
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "done"
    assert job.result is not None
    assert "Transcript truncated to 24000 chars." in job.result.warnings


def test_acquire_failure_reports_as_a_failed_job() -> None:
    """An unexpected exception must never leave a job stuck mid-flight (design doc
    §4.5's `failed` status exists for exactly this)."""

    def _boom(url: str) -> RawAcquisition:
        raise RuntimeError("network is down")

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _boom
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(results=[])
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "failed"
    assert job.result is None
    assert job.error is not None
    assert "network is down" in job.error


def test_unknown_job_is_404() -> None:
    client = TestClient(create_app())
    response = client.get("/import/not-a-real-job-id")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Real end-to-end: real acquisition, real LLM. Excluded from the default run.
# ---------------------------------------------------------------------------

FULL_METHOD_URL = "https://youtu.be/o3k55z-tv9I"  # Pakoda Kadhi, bucket A (test_acquire.py)


@pytest.mark.llm
@pytest.mark.network
def test_real_import_reaches_a_terminal_status() -> None:
    """No fakes: real yt-dlp fetch, real Haiku extraction call, real scheduler run.

    Whatever tier it lands on, the job must reach a terminal status with a usable
    result -- print the outcome so it can be reported, don't just assert "done"."""
    client = TestClient(create_app())
    job_id = client.post("/import", json={"url": FULL_METHOD_URL}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status in ("done", "method_not_grounded")
    assert job.result is not None
    print(f"\nimport status: {job.status}")
    print(f"warnings: {job.result.warnings}")
    if job.result.plan is not None:
        print(f"plan total_min: {job.result.plan.total_min}")
