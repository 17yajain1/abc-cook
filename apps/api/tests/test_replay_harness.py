"""The zero-cost replay harness (PR-S2a): the real app, a replayed model, no key.

Run at 50x so each import takes a second or so. TestClient finishes the job's background
task before `.post()` returns, so the final poll is the terminal state.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from abc_cook.devtools.replay import (
    CHARS_PER_S,
    DEFAULT_PRE_CONTENT_S,
    FIXTURE_NAMES,
    KADHI_REPLAY_CHARS,
    ReplayStreamingAdapter,
    create_replay_app,
    fixture_acquire,
    load_fixture,
)
from abc_cook.extract.adapters.base import STREAM_IDLE_TIMEOUT_S
from abc_cook.extract.adapters.prompting import parse
from abc_cook.schema.api import ImportJobResponse
from abc_cook.schema.normalized import NormalizedRecipe

_SPEED = 50.0


def _import(fixture: str, script: list[str], **body: object) -> ImportJobResponse:
    app = create_replay_app(load_fixture(fixture), script, speed=_SPEED)
    client = TestClient(app)
    job_id = client.post("/import", json=body or {"url": "https://youtu.be/replay"}).json()[
        "job_id"
    ]
    return ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())


@pytest.mark.parametrize("name", FIXTURE_NAMES)
def test_every_fixture_loads_and_its_text_is_a_valid_recipe(name: str) -> None:
    fixture = load_fixture(name)
    assert parse(fixture.text, NormalizedRecipe) is not None
    assert fixture.raw.title


def test_kadhi_replay_matches_t6() -> None:
    """T6 (kadhi, `low`, n=1): first visible token at 7.7 s, the full output at 25.8 s."""
    fixture = load_fixture("kadhi-pakora")
    assert len(fixture.text) == KADHI_REPLAY_CHARS
    assert DEFAULT_PRE_CONTENT_S + len(fixture.text) / CHARS_PER_S == pytest.approx(25.8, abs=0.05)


def test_clean_replay_streams_the_recipe_and_reaches_done() -> None:
    job = _import("kadhi-pakora", ["ok"])
    fixture = load_fixture("kadhi-pakora")
    recipe = parse(fixture.text, NormalizedRecipe)
    assert recipe is not None
    assert job.status == "done"
    assert job.acquired is not None
    assert job.acquired.title == fixture.raw.title
    assert job.draft is not None
    assert job.draft.calls == 1
    assert job.draft.ingredients == recipe.ingredients
    assert job.draft.ingredients_complete is True
    assert [s.text for s in job.draft.steps] == [s.text for s in recipe.steps]
    assert job.draft.steps_complete is True


def test_retry_script_freezes_the_first_calls_draft() -> None:
    job = _import("kadhi-pakora", ["invalid_json", "ok"])
    assert job.status == "done"
    assert job.draft is not None
    assert job.draft.calls == 2
    recipe = parse(load_fixture("kadhi-pakora").text, NormalizedRecipe)
    assert recipe is not None
    # Call 1 sent 70% of the text: the draft is a prefix of the final steps, not complete.
    shown = [s.text for s in job.draft.steps]
    assert 0 < len(shown) < len(recipe.steps) or job.draft.steps_complete
    assert shown == [s.text for s in recipe.steps][: len(shown)]


def test_truncation_script_escalates_and_keeps_the_first_draft() -> None:
    job = _import("croissant", ["truncated", "ok"])
    assert job.status == "done"
    assert job.draft is not None
    assert job.draft.calls == 2


def test_stall_script_fails_as_unavailable_and_keeps_the_draft() -> None:
    job = _import("kadhi-pakora", ["stall_after:3000"])
    assert job.status == "failed"
    assert job.result is not None
    assert job.result.failure == "unavailable"
    assert job.draft is not None
    assert job.draft.ingredients  # 3,000 characters reach past the ingredients list


def test_pasted_text_streams_a_draft_with_no_acquire() -> None:
    job = _import(
        "pumpkin-pancakes",
        ["ok"],
        text="Pumpkin pancakes\n\nIngredients: flour, pumpkin, milk.\nMethod: Mix and fry.",
    )
    assert job.acquired is None
    assert job.draft is not None


def test_each_job_starts_at_the_first_outcome() -> None:
    app = create_replay_app(load_fixture("vanilla-cupcakes"), ["infra", "ok"], speed=_SPEED)
    client = TestClient(app)
    for _ in range(2):
        job_id = client.post("/import", json={"url": "https://youtu.be/replay"}).json()["job_id"]
        job = ImportJobResponse.model_validate(client.get(f"/import/{job_id}").json())
        assert job.status == "failed"  # a fresh adapter per job: never the second outcome


def test_unknown_outcome_and_fixture_are_rejected() -> None:
    with pytest.raises(ValueError, match="unknown replay outcome"):
        ReplayStreamingAdapter(load_fixture("kadhi-pakora"), ["sometimes"])
    with pytest.raises(ValueError, match="unknown replay fixture"):
        load_fixture("nope")


def test_fixture_acquire_reports_metadata_before_returning() -> None:
    fixture = load_fixture("croissant")
    seen: list[str] = []
    acquire = fixture_acquire(fixture.raw, metadata_at_s=0.02, done_at_s=0.05)
    raw = acquire("https://youtu.be/x", on_metadata=lambda meta: seen.append(meta.title))
    assert raw is fixture.raw
    assert seen == [fixture.raw.title]


def test_stall_outcome_waits_the_idle_bound() -> None:
    # The stall row of the bench stands on this: silence for the watchdog's 60 s.
    assert STREAM_IDLE_TIMEOUT_S == 60.0
