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

import logging
import re
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.extract.acquire import MetadataCallback, RawAcquisition, SourceMetadata
from abc_cook.extract.acquire.blog import NoRecipeFoundError
from abc_cook.extract.adapters.base import CallUsage, ExtractResult
from abc_cook.extract.cache import DiskResultCache
from abc_cook.extract.normalize import EXTRACTION_EFFORT_CEILING
from abc_cook.extract.pricing import call_cost_inr
from abc_cook.schema.api import ImportJobResponse, ImportStartResponse
from abc_cook.schema.normalized import (
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
    RepairProposal,
    StepRepair,
)

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


def _fake_acquire(url: str, **_kwargs: object) -> RawAcquisition:
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
    def _acquire_with_all_legs(url: str, **_kwargs: object) -> RawAcquisition:
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

    def _acquire_with_warning(url: str, **_kwargs: object) -> RawAcquisition:
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
    def _acquire_with_warning(url: str, **_kwargs: object) -> RawAcquisition:
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

    def _boom(url: str, **_kwargs: object) -> RawAcquisition:
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
    assert "network is down" not in job.error  # never the raw exception text


def test_unknown_job_is_404() -> None:
    client = TestClient(create_app())
    response = client.get("/import/not-a-real-job-id")
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Real end-to-end: real acquisition, real LLM. Excluded from the default run.
# ---------------------------------------------------------------------------


def _blog_acquire(url: str, **_kwargs: object) -> RawAcquisition:
    recipe = {
        "@type": "Recipe",
        "name": "Test Recipe",
        "recipeIngredient": ["1 onion"],
        "recipeInstructions": ["Heat oil, add onion, cook until golden, serve hot."],
    }
    return _raw(source_url=url, description=None, blog_recipe=recipe)


def test_job_keeps_the_source_preview_through_to_done() -> None:
    """A2: the job record carries `preview` once acquire produced one, and every later
    write (including the terminal one) keeps it."""
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _blog_acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://kitchen.example/r"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "done"
    assert job.preview is not None
    assert job.preview.title == "Test Recipe"
    assert job.preview.ingredients == ["1 onion"]


def test_video_job_without_a_linked_page_has_no_preview() -> None:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _fake_acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(
        results=[ExtractResult(recipe=_grounded_recipe())]
    )
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.preview is None


def test_page_without_a_recipe_ends_as_no_recipe_found() -> None:
    def acquire_fn(url: str, **_kwargs: object) -> RawAcquisition:
        raise NoRecipeFoundError("no Recipe JSON-LD")

    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: acquire_fn
    app.dependency_overrides[import_routes.get_adapter] = lambda: _FakeAdapter(results=[])
    client = TestClient(app)

    job_id = client.post("/import", json={"url": "https://kitchen.example/post"}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())

    assert job.status == "no_recipe_found"
    assert job.error is None
    assert job.preview is None


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


# ---------------------------------------------------------------------------
# PR-S1: truthful failures, the effort ceiling, and what the client may be told.
# ---------------------------------------------------------------------------

_UNAVAILABLE_SENTENCE = "We couldn't reach our recipe reader. Try again in a minute."
_INCOMPLETE_SENTENCE = "We couldn't finish reading this recipe."
_LAST_RESORT_SENTENCE = "Something went wrong while reading this recipe. Please try again."
_SECRET = "sk-test-SECRET"


def _client_with(
    adapter: object, acquire: object = _fake_acquire, cache: object = None
) -> TestClient:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    app.dependency_overrides[import_routes.get_result_cache] = lambda: cache
    return TestClient(app)


def _post_and_poll(client: TestClient, **body: object) -> ImportJobResponse:
    job_id = client.post("/import", json={"url": "https://youtu.be/test", **body}).json()["job_id"]
    return ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())


def test_provider_auth_failure_is_unavailable_not_cached(tmp_path: Path) -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, error="AuthenticationError (HTTP 401)", error_kind="infra")
        ]
    )
    cache = DiskResultCache(tmp_path)
    job = _post_and_poll(_client_with(adapter, cache=cache))

    assert job.status == "failed"
    assert job.result is not None
    assert job.result.status == "failed"
    assert job.result.failure == "unavailable"
    assert job.error == _UNAVAILABLE_SENTENCE
    assert adapter.calls == 1
    assert list(tmp_path.rglob("*.json")) == []  # a failure is never cached
    assert _SECRET not in job.model_dump_json()


def test_reasoning_exhausted_truncation_is_incomplete() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(
                recipe=None,
                truncated=True,
                error="max_tokens",
                error_kind="truncated",
                raw_text="",
            )
        ]
    )
    job = _post_and_poll(_client_with(adapter))

    assert job.status == "failed"
    assert job.result is not None
    assert job.result.failure == "incomplete"
    assert job.error == _INCOMPLETE_SENTENCE
    assert adapter.calls == 1


def test_healthy_failure_free_jobs_have_no_failure_field() -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    job = _post_and_poll(_client_with(adapter))
    assert job.status == "done"
    assert job.result is not None
    assert job.result.failure is None


def test_last_resort_error_is_a_fixed_sentence_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    def boom(url: str, **_kwargs: object) -> RawAcquisition:
        raise RuntimeError(f"network is down {_SECRET}")

    with caplog.at_level(logging.ERROR, logger=import_routes.__name__):
        job = _post_and_poll(_client_with(_FakeAdapter(results=[]), acquire=boom))

    assert job.status == "failed"
    assert job.result is None
    assert job.error == _LAST_RESORT_SENTENCE
    assert _SECRET not in job.model_dump_json()
    assert any("network is down" in (r.exc_text or "") for r in caplog.records)


@dataclass
class _RecordingAdapter:
    """Scripted per output type; records the effort of every call."""

    script: list[ExtractResult]
    repair_results: list[ExtractResult]
    seen: list[tuple[str, str | None]]

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
        self.seen.append((output_type.__name__, effort))
        queue = self.repair_results if output_type.__name__ == "RepairProposal" else self.script
        return queue.pop(0)


def _broken_recipe() -> NormalizedRecipe:
    """Fails exactly one repairable rule (`ingredients_consumed`): Salt is never used."""

    def step(text: str, consumes: list[str], *, independent: bool = False) -> NormalizedStep:
        return NormalizedStep(
            text=text,
            attention="hands_on",
            duration_stated=True,
            duration_min=2,
            duration_typical_min=3,
            duration_max=5,
            consumes_ingredients=consumes,
            depends_on_previous=not independent,
            station="counter",
            interruptible=True,
            freshness="none",
        )

    return NormalizedRecipe(
        title="Test",
        method_grounded=True,
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None),
            NormalizedIngredient(name="Butter", qty="1", unit="tbsp", prep_note=None),
            NormalizedIngredient(name="Salt", qty="1", unit="tsp", prep_note=None),
        ],
        steps=[
            step("Chop the onion.", ["Onion"]),
            step("Melt the butter in a pan.", ["Butter"], independent=True),
            step("Serve hot.", []),
        ],
    )


def test_route_never_sends_an_effort_above_the_ceiling() -> None:
    """Clean, unparseable-retry, escalation and repair paths, all through `POST /import`."""
    unparseable = ExtractResult(recipe=None, error="bad", error_kind="unparseable", raw_text="{")
    truncated = ExtractResult(
        recipe=None, truncated=True, error="max_tokens", raw_text='{"steps":[{"text":"a"}'
    )
    repair_fail = ExtractResult(recipe=None, error="bad", error_kind="unparseable", raw_text="{")
    scenarios: list[tuple[list[ExtractResult], list[ExtractResult], str]] = [
        ([ExtractResult(recipe=_grounded_recipe())], [], "clean"),
        ([unparseable, ExtractResult(recipe=_grounded_recipe())], [], "retry"),
        ([truncated, ExtractResult(recipe=_grounded_recipe())], [], "escalation"),
        ([ExtractResult(recipe=_broken_recipe())], [repair_fail, repair_fail], "repair"),
    ]
    order = ("minimal", "low", "medium", "high", "xhigh", "max")
    ceiling = order.index(EXTRACTION_EFFORT_CEILING)
    for script, repair_results, label in scenarios:
        seen: list[tuple[str, str | None]] = []
        adapter = _RecordingAdapter(script=list(script), repair_results=repair_results, seen=seen)

        def acquire(url: str, **_kwargs: object) -> RawAcquisition:
            return _raw(
                source_url=url,
                description="Chop the onion. Melt the butter in a pan. Serve hot.",
            )

        # The body tries to set an effort; unknown fields are ignored, never forwarded.
        job = _post_and_poll(
            _client_with(adapter, acquire=acquire), extraction_effort="max", effort="max"
        )
        assert job.status == "done", label
        extraction = [effort for name, effort in seen if name == "NormalizedRecipe"]
        assert extraction, label
        for effort in extraction:
            assert effort is not None, label  # None would mean the provider default (medium)
            assert order.index(effort) <= ceiling, (label, effort)
        if label == "repair":
            assert [name for name, _ in seen].count("RepairProposal") >= 1


# ---------------------------------------------------------------------------
# PR-S1 A5: acquisition metadata on job status.
# ---------------------------------------------------------------------------


class _RecordingStore:
    """An `InMemoryJobStore` that remembers every write, in order."""

    def __init__(self) -> None:
        self.inner = import_routes.InMemoryJobStore()
        self.writes: list[import_routes.JobState] = []

    def get(self, job_id: str) -> import_routes.JobState | None:
        return self.inner.get(job_id)

    def put(self, job_id: str, state: import_routes.JobState) -> None:
        if state.status != "acquiring" or state.acquired is not None:
            self.writes.append(state)
        self.inner.put(job_id, state)


def _store_client(store: _RecordingStore, adapter: object, acquire: object) -> TestClient:
    app = create_app()
    app.dependency_overrides[import_routes.get_job_store] = lambda: store
    app.dependency_overrides[import_routes.get_acquire] = lambda: acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    return TestClient(app)


def _yt_like_acquire(url: str, *, on_metadata: MetadataCallback | None = None) -> RawAcquisition:
    """Like `pipeline.acquire` for a video: reports metadata early, then returns the raw."""
    if on_metadata is not None:
        on_metadata(
            SourceMetadata(title="Kadhi Pakora", channel="Some Kitchen", description="Dahi, besan.")
        )
    return _raw(
        source_url=url, title="Kadhi Pakora", channel="Some Kitchen", description="Dahi, besan."
    )


def test_acquired_is_set_right_after_ytdlp_and_kept_on_every_later_status() -> None:
    store = _RecordingStore()
    client = _store_client(
        store,
        _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())]),
        _yt_like_acquire,
    )
    job_id = client.post("/import", json={"url": "https://youtu.be/test"}).json()["job_id"]

    # The first write carrying `acquired` is the early one: still `acquiring`, written from
    # the metadata callback before captions or link probing. Every later write keeps it,
    # including the terminal `done`.
    assert store.writes, "no status write was recorded"
    assert store.writes[0].status == "acquiring"
    for state in store.writes:
        assert state.acquired is not None
        assert state.acquired.title == "Kadhi Pakora"
        assert state.acquired.channel == "Some Kitchen"
        assert state.acquired.description == "Dahi, besan."
    assert [w.status for w in store.writes][:2] == ["acquiring", "extracting"]
    assert store.writes[-1].status == "done"

    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())
    assert job.acquired is not None
    assert job.acquired.title == "Kadhi Pakora"


def test_acquired_falls_back_to_the_returned_raw_when_acquire_reports_nothing_early() -> None:
    def acquire(url: str, **_kwargs: object) -> RawAcquisition:  # a recipe page / a fake
        return _raw(source_url=url, title="Kadhi Pakora", description="Dahi, besan.")

    store = _RecordingStore()
    client = _store_client(
        store, _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())]), acquire
    )
    client.post("/import", json={"url": "https://youtu.be/test"})
    assert store.writes[0].status == "extracting"
    assert all(s.acquired is not None and s.acquired.title == "Kadhi Pakora" for s in store.writes)


def test_acquired_survives_a_failed_job() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, error="AuthenticationError (HTTP 401)", error_kind="infra")
        ]
    )
    job = _post_and_poll(_client_with(adapter))
    assert job.status == "failed"
    assert job.acquired is not None
    assert job.acquired.title == "Test Recipe"


def test_acquired_survives_the_last_resort_failure() -> None:
    class _BoomAdapter:
        def extract(self, **_: object) -> ExtractResult:
            raise RuntimeError("provider exploded")

    job = _post_and_poll(_client_with(_BoomAdapter()))
    assert job.status == "failed"
    assert job.error == _LAST_RESORT_SENTENCE
    assert job.acquired is not None  # acquire had already succeeded


def test_pasted_text_has_no_acquired_block() -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    app = create_app()
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    app.dependency_overrides[import_routes.get_result_cache] = lambda: None
    client = TestClient(app)
    text = "Onion Dal\n\n1 onion\n\nHeat oil, add onion, cook until golden. Serve hot."
    job_id = client.post("/import", json={"text": text}).json()["job_id"]
    job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())
    assert job.status == "done"
    assert job.acquired is None


def test_a_job_before_acquire_finishes_has_no_acquired_block() -> None:
    state = import_routes.JobState(status="acquiring")
    assert state.acquired is None
    response = ImportJobResponse(job_id="j", status=state.status, acquired=state.acquired)
    assert response.acquired is None


# ---------------------------------------------------------------------------
# PR-S1.5: the per-job cost and token log line, and the logging config that lets it out.
# ---------------------------------------------------------------------------


def _usage(model: str, tokens_in: int, tokens_out: int, reasoning: int | None = None) -> CallUsage:
    return CallUsage(
        model=model,
        input_tokens=tokens_in,
        output_tokens=tokens_out,
        cache_read_input_tokens=None,
        cache_creation_input_tokens=None,
        stop_reason="end_turn",
        latency_ms=1.0,
        max_tokens_requested=1000,
        reasoning_tokens=reasoning,
    )


def _cost_line(caplog: pytest.LogCaptureFixture) -> str:
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("import cost:")]
    assert len(lines) == 1, lines
    return lines[0]


def _run_and_capture_cost(
    caplog: pytest.LogCaptureFixture, results: list[ExtractResult], raw: RawAcquisition
) -> str:
    def acquire(url: str, **_kwargs: object) -> RawAcquisition:
        return raw

    client = _client_with(_FakeAdapter(results=results), acquire=acquire)
    with caplog.at_level(logging.INFO, logger=import_routes.__name__):
        _post_and_poll(client)
    return _cost_line(caplog)


def test_cost_line_reports_a_priced_extraction_only_import(
    caplog: pytest.LogCaptureFixture,
) -> None:
    usage = _usage("gpt-5-mini", 1000, 2000, reasoning=1500)
    line = _run_and_capture_cost(
        caplog, [ExtractResult(recipe=_grounded_recipe(), usage=usage)], _raw()
    )
    expected = call_cost_inr(usage)
    assert expected is not None
    assert f"cost_inr={expected:.2f}" in line
    assert "input_tokens=1000 output_tokens=2000 reasoning_tokens=1500" in line
    assert "calls=[gpt-5-mini:1000/2000]" in line


def test_cost_line_says_unpriced_for_an_unknown_model(caplog: pytest.LogCaptureFixture) -> None:
    usage = _usage("some-new-model", 10, 20)
    line = _run_and_capture_cost(
        caplog, [ExtractResult(recipe=_grounded_recipe(), usage=usage)], _raw()
    )
    assert "cost_inr=unpriced" in line
    assert "reasoning_tokens=unreported" in line


def test_cost_line_includes_the_repair_call(caplog: pytest.LogCaptureFixture) -> None:
    extraction = _usage("gpt-5-mini", 1000, 2000, reasoning=1500)
    repair = _usage("claude-sonnet-5", 300, 40)
    unconsumed_salt = _grounded_recipe().model_copy(
        update={
            "ingredients": [
                NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None),
                NormalizedIngredient(name="Salt", qty="1", unit="tsp", prep_note=None),
            ]
        }
    )
    proposal = RepairProposal(
        steps=[
            StepRepair(
                consumes_ingredients=["Onion", "Salt"],
                produces_component=None,
                depends_on_previous=True,
            )
        ]
    )
    raw = _raw(description="1 onion, salt. Heat oil, add onion, cook until golden. Serve hot.")
    line = _run_and_capture_cost(
        caplog,
        [
            ExtractResult(recipe=unconsumed_salt, usage=extraction),
            ExtractResult(recipe=proposal, usage=repair),
        ],
        raw,
    )

    total = call_cost_inr(extraction)
    repair_cost = call_cost_inr(repair)
    assert total is not None
    assert repair_cost is not None
    assert f"cost_inr={total + repair_cost:.2f}" in line
    assert "input_tokens=1300 output_tokens=2040" in line
    assert "calls=[gpt-5-mini:1000/2000 claude-sonnet-5:300/40]" in line


def test_abc_cook_info_logs_reach_a_handler_exactly_once() -> None:
    create_app()
    logger = logging.getLogger("abc_cook")
    assert logger.getEffectiveLevel() <= logging.INFO
    assert logger.handlers
    # One stream handler on `abc_cook`, created once however many apps are built.
    create_app()
    assert len(logger.handlers) == 1
    # No second copy through root's handlers beyond pytest's own capture handlers.
    root_stream_handlers = [
        h
        for h in logging.getLogger().handlers
        if isinstance(h, logging.StreamHandler) and type(h).__module__ == "logging"
    ]
    assert root_stream_handlers == []
