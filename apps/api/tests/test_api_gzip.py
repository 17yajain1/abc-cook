"""Poll responses are gzip-compressed when the client asks (PR-S2a amendment A4)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.api.routes.import_ import InMemoryJobStore, JobState
from abc_cook.extract.draft import DraftScanner
from abc_cook.schema.api import DraftStep, StreamedDraft
from abc_cook.schema.normalized import ImportOriginal

_FIXTURES = Path(__file__).parent / "fixtures" / "import"


def _kadhi_draft() -> StreamedDraft:
    original = ImportOriginal.model_validate_json(
        (_FIXTURES / "kadhi-pakora.original.json").read_text(encoding="utf-8")
    )
    scanner = DraftScanner()
    scanner.feed(original.recipe.model_dump_json())
    return StreamedDraft(
        ingredients=scanner.ingredients,
        steps=[DraftStep(text=t) for t in scanner.steps],
        steps_complete=scanner.steps_complete,
    )


def _client() -> TestClient:
    store = InMemoryJobStore()
    store.put("job1", JobState(status="extracting", draft=_kadhi_draft()))
    store.put("job2", JobState(status="acquiring"))
    app = create_app()
    app.dependency_overrides[import_routes.get_job_store] = lambda: store
    return TestClient(app)


def test_a_draft_bearing_poll_is_gzipped_and_decodes_to_the_same_json() -> None:
    client = _client()
    packed = client.get("/import/job1", headers={"Accept-Encoding": "gzip"})
    plain = client.get("/import/job1", headers={"Accept-Encoding": "identity"})

    assert packed.headers["content-encoding"] == "gzip"
    assert "content-encoding" not in plain.headers
    assert packed.json() == plain.json()
    assert packed.json()["draft"]["steps_complete"] is True
    assert len(packed.json()["draft"]["steps"]) == 11


def test_a_small_response_is_not_compressed() -> None:
    client = _client()
    response = client.get("/import/job2", headers={"Accept-Encoding": "gzip"})
    assert len(response.content) < 1000
    assert "content-encoding" not in response.headers
    assert response.json()["status"] == "acquiring"
