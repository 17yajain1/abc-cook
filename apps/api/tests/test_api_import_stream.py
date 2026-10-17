"""The streamed draft on `GET /import/{id}` (PR-S2a). Offline.

`TestClient` runs the job's background task to completion before `.post()` returns, so these
inspect the sequence of job-state writes with a recording store instead of polling.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from stream_fakes import (
    StreamingFake,
    content_chunk,
    events,
    finish_chunk,
    recipe_text,
    scripted_adapter,
    sse,
    usage_chunk,
)

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.api.routes.import_ import InMemoryJobStore, JobState
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.cache import DiskResultCache
from abc_cook.schema.api import ImportJobResponse

_URL = "https://youtu.be/dQw4w9WgXcQ"
_UNAVAILABLE_SENTENCE = "We couldn't reach our recipe reader. Try again in a minute."


class RecordingStore(InMemoryJobStore):
    """The in-memory store plus every write, in order."""

    def __init__(self) -> None:
        super().__init__()
        self.writes: list[JobState] = []

    def put(self, job_id: str, state: JobState) -> None:
        self.writes.append(state)
        super().put(job_id, state)


def _raw_for(url: str, **overrides: object) -> RawAcquisition:
    fields: dict[str, object] = {
        "source_url": url,
        "title": "Test Recipe",
        "description": "1 onion. Heat oil, add onion, cook until golden. Serve hot.",
    }
    fields.update(overrides)
    return RawAcquisition(**fields)  # type: ignore[arg-type]


def _acquire(url: str, **_kwargs: object) -> RawAcquisition:
    return _raw_for(url)


def _blog_acquire(url: str, **_kwargs: object) -> RawAcquisition:
    recipe = {
        "@type": "Recipe",
        "name": "Test Recipe",
        "recipeIngredient": ["1 onion"],
        "recipeInstructions": ["Heat oil, add onion, cook until golden, serve hot."],
    }
    return _raw_for(url, description=None, blog_recipe=recipe)


def _client(
    adapter: Any, store: RecordingStore, acquire: Any = _acquire, cache: Any = None
) -> TestClient:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: acquire
    app.dependency_overrides[import_routes.get_adapter] = lambda: adapter
    app.dependency_overrides[import_routes.get_job_store] = lambda: store
    app.dependency_overrides[import_routes.get_result_cache] = lambda: cache
    return TestClient(app)


def _run(
    adapter: Any, *, acquire: Any = _acquire, cache: Any = None, **body: object
) -> tuple[ImportJobResponse, RecordingStore]:
    store = RecordingStore()
    client = _client(adapter, store, acquire, cache)
    payload = body or {"url": _URL}
    job_id = client.post("/import", json=payload).json()["job_id"]
    return ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json()), store


def _comparable(job: ImportJobResponse) -> str:
    """The result with the job id and the clock removed, for equivalence checks."""
    assert job.result is not None
    text = job.result.model_dump_json()
    text = text.replace(job.job_id, "JOB")
    return re.sub(r'"imported_at":"[^"]*"', '"imported_at":"T"', text)


def test_draft_write_order_ingredients_then_steps_then_done() -> None:
    fake = StreamingFake([(recipe_text("a", steps=4), "ok")])
    job, store = _run(fake)

    assert job.status == "done"
    drafts = [w for w in store.writes if w.draft is not None]
    assert drafts
    first = drafts[0]
    assert first.status == "extracting"
    assert first.draft is not None
    assert len(first.draft.ingredients) == 1  # the first ingredient, as soon as its line closes
    assert first.draft.ingredients_complete is False
    assert first.draft.steps == []
    # Step counts only grow, one step at a time, and the list is declared complete last.
    counts = [len(w.draft.steps) for w in drafts if w.draft is not None]
    assert counts == sorted(counts)
    assert counts[-1] == 4
    completes = [w.draft.steps_complete for w in drafts if w.draft is not None]
    assert completes == sorted(completes)
    assert completes[-1] is True
    # The draft rides on every later write, including `validating` and the terminal `done`.
    after_first = store.writes[store.writes.index(first) :]
    assert all(w.draft is not None for w in after_first)
    assert [w.status for w in after_first][-2:] == ["validating", "done"]
    assert job.draft is not None
    assert job.draft.steps[0].text.startswith("a step 1")


def test_a_job_before_extraction_has_no_draft() -> None:
    _, store = _run(StreamingFake([(recipe_text("a"), "ok")]))
    assert store.writes[0].status == "acquiring"
    assert store.writes[0].draft is None


def test_unparseable_retry_freezes_the_draft_from_call_one(
    caplog: pytest.LogCaptureFixture,
) -> None:
    clean_job, _ = _run(StreamingFake([(recipe_text("b"), "ok")]))
    broken = recipe_text("a")[:-12]  # cut inside the last step: no closing braces
    fake = StreamingFake([(broken, "invalid_json"), (recipe_text("b"), "ok")])
    with caplog.at_level(logging.INFO, logger="abc_cook"):
        job, store = _run(fake)

    assert job.status == "done"
    assert fake.calls == 2
    assert job.draft is not None
    assert job.draft.calls == 2
    assert job.draft.ingredients
    assert job.draft.ingredients[0].name.startswith("a ")  # call 1's wording stays
    assert all(s.text.startswith("a ") for s in job.draft.steps)
    # The validated plan is call 2's, identical to a run that never retried.
    assert _comparable(job) == _comparable(clean_job)
    costs = [r.getMessage() for r in caplog.records if r.getMessage().startswith("import cost:")]
    assert costs[-1].count("gpt-5-mini:") == 2  # both extraction calls are counted
    # `calls` moved to 2 without rewriting a row.
    rewrites = [w.draft.steps for w in store.writes if w.draft is not None and w.draft.calls == 2]
    assert rewrites
    assert all([s.text for s in steps] == [s.text for s in job.draft.steps] for steps in rewrites)


def test_escalation_keeps_the_first_calls_steps() -> None:
    partial = recipe_text("a", steps=3)
    partial = partial[: partial.rindex('{"text"')]
    fake = StreamingFake([(partial, "truncated"), (recipe_text("b", steps=3), "ok")])
    job, _ = _run(fake)

    assert job.status == "done"
    assert fake.calls == 2
    assert job.draft is not None
    assert job.draft.calls == 2
    assert len(job.draft.steps) == 2
    assert all(s.text.startswith("a ") for s in job.draft.steps)
    assert job.draft.steps_complete is False  # call 1 never finished its list


def test_a_stalled_stream_fails_as_unavailable_and_keeps_its_draft(tmp_path: Path) -> None:
    ingredients_then_silence: list[tuple[float, bytes | Exception]] = [
        (0.0, sse(content_chunk('{"ingredients":[{"name":"Onion","qty":"1","unit":null,'))),
        (0.0, sse(content_chunk('"prep_note":null}],"steps":[{"text":"Chop the onion"}'))),
        (30.0, sse(content_chunk(",{"))),  # never arrives: the watchdog closes the stream
    ]
    adapter, _ = scripted_adapter(ingredients_then_silence, stream_idle_s=0.3)
    cache = DiskResultCache(tmp_path)
    job, store = _run(adapter, cache=cache)

    assert job.status == "failed"
    assert job.result is not None
    assert job.result.failure == "unavailable"
    assert job.error == _UNAVAILABLE_SENTENCE
    assert job.draft is not None
    assert [i.name for i in job.draft.ingredients] == ["Onion"]
    assert job.draft.ingredients_complete is True
    assert [s.text for s in job.draft.steps] == ["Chop the onion"]
    assert list(tmp_path.rglob("*.json")) == []  # a failure is never cached
    assert store.writes[-1].draft is not None


def test_a_result_cache_hit_runs_no_extraction_and_has_no_draft(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path)
    first, _ = _run(StreamingFake([(recipe_text("a"), "ok")]), cache=cache)
    assert first.status == "done"
    assert first.draft is not None

    fake = StreamingFake([])
    second, store = _run(fake, cache=cache)
    assert second.status == "done"
    assert fake.calls == 0
    assert second.draft is None
    assert all(w.draft is None for w in store.writes)


def test_pasted_text_has_a_draft_and_no_acquired_source() -> None:
    fake = StreamingFake([(recipe_text("a"), "ok")])
    job, _ = _run(
        fake,
        text="Dal\n\nIngredients: 1 cup lentils, 1 onion.\nMethod: Heat oil, add onion, serve.",
    )
    assert job.status == "done"
    assert job.acquired is None
    assert job.draft is not None
    assert job.draft.steps_complete is True


def test_a_recipe_page_has_both_a_preview_and_a_draft() -> None:
    fake = StreamingFake([(recipe_text("a"), "ok")])
    job, _ = _run(fake, acquire=_blog_acquire, url="https://kitchen.example/r")
    assert job.preview is not None
    assert job.draft is not None
    assert job.draft.ingredients


def test_streaming_and_non_streaming_give_the_same_plan() -> None:
    text = recipe_text("a", steps=4)
    streamed, _ = _run(StreamingFake([(text, "ok")]))

    class Blocking(StreamingFake):
        streams_text = False

    blocking, store = _run(Blocking([(text, "ok")]))
    assert streamed.draft is not None
    assert blocking.draft is None
    assert all(w.draft is None for w in store.writes)
    assert _comparable(streamed) == _comparable(blocking)


# --- the kill switch, end to end through the real OpenAI adapter -------------------------------


def _completion(text: str) -> dict[str, Any]:
    return {
        "id": "c",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-test",
        "choices": [
            {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": text}}
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 50,
            "total_tokens": 150,
            "completion_tokens_details": {"reasoning_tokens": 10},
        },
    }


def test_switch_off_gives_no_draft_and_the_same_result(monkeypatch: pytest.MonkeyPatch) -> None:
    text = recipe_text("a", steps=3)
    pieces = [text[i : i + 40] for i in range(0, len(text), 40)]
    on_adapter, _ = scripted_adapter(
        events(*[content_chunk(p) for p in pieces], finish_chunk(), usage_chunk())
    )
    on, _ = _run(on_adapter)

    monkeypatch.setenv("ABC_COOK_STREAM_EXTRACTION", "0")
    off_adapter, recorded = scripted_adapter(json_response=_completion(text))
    off, store = _run(off_adapter)

    assert on.status == off.status == "done"
    assert on.draft is not None
    assert off.draft is None
    assert all(w.draft is None for w in store.writes)
    assert "stream" not in json.loads(recorded.requests[0].content)
    assert _comparable(on) == _comparable(off)
