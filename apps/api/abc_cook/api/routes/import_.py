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

import logging
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from abc_cook.extract.acquire import MetadataCallback, RawAcquisition, SourceMetadata
from abc_cook.extract.acquire.pipeline import acquire as default_acquire
from abc_cook.extract.acquire.text import PastedTextError, from_pasted_text
from abc_cook.extract.adapters.base import LLMAdapter
from abc_cook.extract.adapters.drafting import DraftingAdapter
from abc_cook.extract.adapters.routing import build_default_adapter
from abc_cook.extract.cache import DiskResultCache, ResultCache
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import
from abc_cook.extract.source_key import SourceKey, make_source_key
from abc_cook.schema.api import (
    AcquiredSource,
    ImportJobResponse,
    ImportStartResponse,
    StreamedDraft,
)
from abc_cook.schema.normalized import ImportResult, ImportStatus, SourcePreview

router = APIRouter(tags=["import"])
_logger = logging.getLogger(__name__)

_FAILURE_SENTENCES: dict[str, str] = {
    "unavailable": "We couldn't reach our recipe reader. Try again in a minute.",
    "incomplete": "We couldn't finish reading this recipe.",
}
"""What an older web build shows for a `failed` job (`JobState.error`); a current build
reads `result.failure` and writes its own copy."""

_LAST_RESORT_SENTENCE = "Something went wrong while reading this recipe. Please try again."
"""The unexpected-exception case. Never `str(exc)`: that can carry a URL, a path or a key."""


class ImportRequest(BaseModel):
    """`POST /import` body: exactly one of `url` or `text`."""

    url: str | None = Field(
        default=None, description="Recipe source URL, e.g. a YouTube link or a recipe page."
    )
    text: str | None = Field(
        default=None,
        description="The recipe itself, pasted (A8). Skips acquisition entirely.",
    )
    title: str | None = Field(default=None, description="Optional title for pasted `text`.")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> ImportRequest:
        """Reject a body with both or neither of `url` / `text`."""
        if (self.url is None) == (self.text is None):
            raise ValueError("Send exactly one of `url` or `text`.")
        return self


@dataclass
class JobState:
    """One job's current record. Replaced wholesale on every status change."""

    status: ImportStatus
    result: ImportResult | None = None
    error: str | None = None
    preview: SourcePreview | None = None
    acquired: AcquiredSource | None = None
    draft: StreamedDraft | None = None


class AcquireFn(Protocol):
    """The acquisition dependency: `(url, /, *, on_metadata=None) -> RawAcquisition`."""

    def __call__(
        self, url: str, /, *, on_metadata: MetadataCallback | None = None
    ) -> RawAcquisition:
        """Acquire `url`; call `on_metadata` as soon as the source's display fields are known."""
        ...


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
    """FastAPI dependency: the LLM provider adapter. Overridden in tests with a fake.

    M2.11: `build_default_adapter()` routes extraction to GPT-5-mini and repair to
    Sonnet by model id (`adapters/routing.py`) -- one adapter object, two providers.
    """
    return build_default_adapter()


RESULT_CACHE_ENV = "ABC_COOK_RESULT_CACHE_DIR"


def get_result_cache() -> ResultCache | None:
    """FastAPI dependency: the A3 result cache, or None when it is not configured.

    Off unless `ABC_COOK_RESULT_CACHE_DIR` is set, so tests and the A4 runner stay
    cache-free by default; `.env.example` enables it for local dev. Overridden in tests.
    """
    directory = os.environ.get(RESULT_CACHE_ENV)
    return DiskResultCache(Path(directory)) if directory else None


def get_acquire() -> AcquireFn:
    """FastAPI dependency: the acquisition function. Overridden in tests with a fake."""
    return default_acquire


def _log_import_cost(job_id: str, telemetry: ImportTelemetry) -> None:
    """One INFO line per job with its measured cost and tokens (extraction plus repair).

    `telemetry.total_calls` is `[*extraction_calls, *repair_calls]`, so a repair that fired is
    included in every figure. Counts and model ids only: no URL, no key.
    """
    cost = telemetry.cost_inr
    reasoning = telemetry.reasoning_tokens
    calls = telemetry.total_calls
    _logger.info(
        "import cost: graph_id=%s tier=%s cache_hit=%s cost_inr=%s input_tokens=%d "
        "output_tokens=%d reasoning_tokens=%s calls=[%s]",
        job_id,
        telemetry.tier,
        telemetry.cache_hit,
        "unpriced" if cost is None else f"{cost:.2f}",
        sum(c.input_tokens for c in calls),
        telemetry.output_tokens,
        "unreported" if reasoning is None else reasoning,
        " ".join(f"{c.model}:{c.input_tokens}/{c.output_tokens}" for c in calls),
    )


def _run_job(
    job_id: str,
    url: str,
    adapter: LLMAdapter,
    acquire_fn: AcquireFn,
    store: JobStore,
    cache: ResultCache | None = None,
    fresh: bool = False,
    source_key: SourceKey | None = None,
) -> None:
    """The background task body: run the pipeline, then write the terminal state.

    Never lets an exception escape into `BackgroundTasks` -- an unhandled error here
    would otherwise leave the job stuck at its last in-flight status forever, with no
    way for a poller to learn anything went wrong. `failed` exists in the design
    doc's status enum for exactly this.
    """
    preview: SourcePreview | None = None
    acquired: AcquiredSource | None = None
    draft: StreamedDraft | None = None
    current: ImportStatus = "acquiring"

    def on_status(status: ImportStatus) -> None:
        nonlocal current
        current = status
        store.put(job_id, JobState(status=status, preview=preview, acquired=acquired, draft=draft))

    def on_draft(value: StreamedDraft) -> None:
        # The extraction call is streaming: publish what it has said so far under the
        # current status. Every later write keeps it, like `preview`.
        nonlocal draft
        draft = value
        store.put(job_id, JobState(status=current, preview=preview, acquired=acquired, draft=draft))

    def on_metadata(meta: SourceMetadata) -> None:
        # yt-dlp has answered but captions and link probing have not run: publish the
        # display fields now, still `acquiring`, so the poller can show the description.
        nonlocal acquired
        acquired = AcquiredSource(
            title=meta.title, channel=meta.channel, description=meta.description
        )
        store.put(job_id, JobState(status="acquiring", acquired=acquired))

    def recording_acquire(source_url: str) -> RawAcquisition:
        # Records the display fields and hands the result back unchanged; every later
        # `store.put` carries them, like `preview`. Pasted text is the user's own, so skipped.
        # The assignment below is the fallback for an acquire that never calls `on_metadata`
        # (a recipe page, a fake).
        nonlocal acquired
        raw = acquire_fn(source_url, on_metadata=on_metadata)
        if raw.source_kind != "text":
            acquired = AcquiredSource(
                title=raw.title, channel=raw.channel, description=raw.description
            )
        return raw

    def on_preview(value: SourcePreview) -> None:
        # Fires between `acquiring` and `plan_building`; the next `on_status` write
        # carries it, and every later write keeps it -- so even a failed job can
        # still show the source's own recipe.
        nonlocal preview
        preview = value

    try:
        result = run_import(
            url,
            DraftingAdapter(adapter, on_draft, graph_id=job_id),
            graph_id=job_id,
            acquire_fn=recording_acquire,
            on_status=on_status,
            on_preview=on_preview,
            on_telemetry=lambda telemetry: _log_import_cost(job_id, telemetry),
            cache=cache,
            fresh=fresh,
            source_key=source_key,
        )
    except Exception:  # last-resort boundary, see docstring
        _logger.exception("import job %s failed unexpectedly", job_id)
        store.put(
            job_id,
            JobState(
                status="failed",
                error=_LAST_RESORT_SENTENCE,
                preview=preview,
                acquired=acquired,
                draft=draft,
            ),
        )
        return
    error = _FAILURE_SENTENCES.get(result.failure or "") if result.status == "failed" else None
    store.put(
        job_id,
        JobState(
            status=result.status,
            result=result,
            error=error,
            preview=preview,
            acquired=acquired,
            draft=draft,
        ),
    )


@router.post("/import", status_code=202)
async def start_import(
    request: ImportRequest,
    background_tasks: BackgroundTasks,
    store: JobStore = Depends(get_job_store),
    adapter: LLMAdapter = Depends(get_adapter),
    acquire_fn: AcquireFn = Depends(get_acquire),
    cache: ResultCache | None = Depends(get_result_cache),
    fresh: bool = Query(False, description="Skip the result-cache lookup (it is still stored)."),
) -> ImportStartResponse:
    """Start an import job. Returns immediately; poll `GET /import/{job_id}`.

    Returns:
        The new job's id.
    """
    if request.text is not None:
        # Pasted text (A8): validated here so a bad paste is an immediate 422, and handed
        # to the same pipeline with acquisition replaced by the already-built raw.
        try:
            pasted = from_pasted_text(request.text, request.title)
        except PastedTextError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        source = pasted.source_url
        acquire_fn = lambda _url, **_kwargs: pasted  # noqa: E731
        # A `text:` key makes `run_import` bypass the cache for both get and put, rather
        # than relying on `source_url` being empty.
        source_key = make_source_key("text", pasted.description or "")
    else:
        assert request.url is not None  # `_exactly_one_source`
        source = request.url
        source_key = None
    job_id = uuid.uuid4().hex
    store.put(job_id, JobState(status="acquiring"))
    background_tasks.add_task(
        _run_job, job_id, source, adapter, acquire_fn, store, cache, fresh, source_key
    )
    return ImportStartResponse(job_id=job_id)


@router.get("/import/{job_id}")
async def get_import(job_id: str, store: JobStore = Depends(get_job_store)) -> ImportJobResponse:
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
    return ImportJobResponse(
        job_id=job_id,
        status=job.status,
        result=job.result,
        error=job.error,
        preview=job.preview,
        acquired=job.acquired,
        draft=job.draft,
    )
