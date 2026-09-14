"""`POST /import` (starts a job) + `GET /import/{job_id}` (polls it). Design doc §4.5.

Named `import_.py`, not `import.py` -- `import` is a Python keyword and cannot be a
module name.

`JobStore` is a narrow Protocol, not the concrete dict, so this route does not
hardcode the in-memory store as the only possible backing (design doc §4.5: "design
the boundary ... implement the dict" -- M5's real persistence swaps the
implementation without touching this file). `get_job_store`/`get_adapter`/
`get_acquire` are plain FastAPI dependencies for the same reason `AnthropicAdapter`
is never imported by `extract/import_pipeline.py` directly: tests override them with
fakes via `app.dependency_overrides`, so the default test run never touches the
network or an LLM (docs/M2.9-youtube-import-design.md §8.2).
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.pipeline import acquire as default_acquire
from abc_cook.extract.adapters.anthropic import AnthropicAdapter
from abc_cook.extract.adapters.base import LLMAdapter
from abc_cook.extract.import_pipeline import run_import
from abc_cook.schema.api import ImportJobResponse, ImportStartResponse
from abc_cook.schema.normalized import ImportResult, ImportStatus

router = APIRouter(tags=["import"])


class ImportRequest(BaseModel):
    """`POST /import` body."""

    url: str = Field(description="Recipe source URL, e.g. a YouTube link.")


@dataclass
class JobState:
    """One job's current record. Replaced wholesale on every status change."""

    status: ImportStatus
    result: ImportResult | None = None
    error: str | None = None


class JobStore(Protocol):
    """The persistence boundary for import jobs (design doc §4.5).

    M2.9: an in-process dict, cleared on restart -- deliberately not the M5
    persistence design (see design doc §4.5's explicit warning not to grow this
    toward it).
    """

    def get(self, job_id: str) -> JobState | None:
        """Look up a job by id, or None if it doesn't exist (or was cleared)."""
        ...

    def put(self, job_id: str, state: JobState) -> None:
        """Record (or replace) a job's current state."""
        ...


class InMemoryJobStore:
    """The M2.9 `JobStore`: a plain dict guarded by nothing beyond the GIL.

    Sufficient for a single-process dev/MVP deployment (design doc §4.5); not a
    multi-worker-safe store.
    """

    def __init__(self) -> None:
        """Start with no jobs."""
        self._jobs: dict[str, JobState] = {}

    def get(self, job_id: str) -> JobState | None:
        """See `JobStore.get`."""
        return self._jobs.get(job_id)

    def put(self, job_id: str, state: JobState) -> None:
        """See `JobStore.put`."""
        self._jobs[job_id] = state


_default_store = InMemoryJobStore()


def get_job_store() -> JobStore:
    """FastAPI dependency: the process-wide job store. Overridden in tests."""
    return _default_store


def get_adapter() -> LLMAdapter:
    """FastAPI dependency: the LLM provider adapter. Overridden in tests with a fake."""
    return AnthropicAdapter()


def get_acquire() -> Callable[[str], RawAcquisition]:
    """FastAPI dependency: the acquisition function. Overridden in tests with a fake."""
    return default_acquire


def _run_job(
    job_id: str,
    url: str,
    adapter: LLMAdapter,
    acquire_fn: Callable[[str], RawAcquisition],
    store: JobStore,
) -> None:
    """The background task body: run the pipeline, then write the terminal state.

    Never lets an exception escape into `BackgroundTasks` -- an unhandled error here
    would otherwise leave the job stuck at its last in-flight status forever, with no
    way for a poller to learn anything went wrong. `failed` exists in the design
    doc's status enum for exactly this.
    """

    def on_status(status: ImportStatus) -> None:
        store.put(job_id, JobState(status=status))

    try:
        result = run_import(
            url, adapter, graph_id=job_id, acquire_fn=acquire_fn, on_status=on_status
        )
    except Exception as exc:  # last-resort boundary, see docstring
        store.put(job_id, JobState(status="failed", error=str(exc)))
        return
    store.put(job_id, JobState(status=result.status, result=result))


@router.post("/import", status_code=202)
async def start_import(
    request: ImportRequest,
    background_tasks: BackgroundTasks,
    store: JobStore = Depends(get_job_store),
    adapter: LLMAdapter = Depends(get_adapter),
    acquire_fn: Callable[[str], RawAcquisition] = Depends(get_acquire),
) -> ImportStartResponse:
    """Start an import job. Returns immediately; poll `GET /import/{job_id}`.

    Returns:
        The new job's id.
    """
    job_id = uuid.uuid4().hex
    store.put(job_id, JobState(status="acquiring"))
    background_tasks.add_task(_run_job, job_id, request.url, adapter, acquire_fn, store)
    return ImportStartResponse(job_id=job_id)


@router.get("/import/{job_id}")
async def get_import(
    job_id: str, store: JobStore = Depends(get_job_store)
) -> ImportJobResponse:
    """Poll one import job's status.

    Args:
        job_id: Id returned by `POST /import`.
        store: The job store (FastAPI dependency).

    Returns:
        The job's current status, and its result once terminal.

    Raises:
        HTTPException: 404 when `job_id` is unknown.
    """
    job = store.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Unknown job {job_id!r}")
    return ImportJobResponse(job_id=job_id, status=job.status, result=job.result, error=job.error)
