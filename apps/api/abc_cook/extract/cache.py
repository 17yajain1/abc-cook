"""A3 source cache: a finished `ImportResult`, keyed by source + a pipeline fingerprint.

A repeat import of the same source returns the stored result in well under a second
instead of re-running acquire -> extract -> graph -> repair -> schedule. The cache is
a pure optimisation: it is OFF unless `ABC_COOK_RESULT_CACHE_DIR` is configured
(`api/routes/import_.py`), a miss runs today's pipeline unchanged, and no failure in
here ever fails an import -- every cache error degrades to a miss.

What is stored, and why the key is wide: the value is the *final* plan (graph +
schedule + warnings), so the key has to change whenever anything that shaped that plan
changes -- not just the extraction prompt and model. See `PipelineFingerprint`.
The TTL is an arbitrary placeholder (see `DiskResultCache`), not a measured value.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import os
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Literal, Protocol

import pydantic

from abc_cook.schema.normalized import ImportResult

_logger = logging.getLogger(__name__)

CacheTier = Literal["clean", "repaired"]
"""The only tiers a result can be cached at. Degraded/Tier 0 are never stored."""

ENVELOPE_FORMAT = 1
"""Version of the on-disk envelope (not of the pipeline -- that is the fingerprint)."""


@dataclass(frozen=True)
class CachedResult:
    """What a cache stores for one import.

    `tier` and `step_count` are carried so telemetry on a hit can report what the
    original cold run produced, rather than inventing values.
    """

    result: ImportResult
    tier: CacheTier
    step_count: int


class ResultCache(Protocol):
    """The storage boundary for finished imports (M5 can back this with Supabase).

    Implementations must never raise from `get`/`put`: a broken cache is a miss, not a
    failed import.
    """

    def get(self, identity: str) -> CachedResult | None:
        """The entry stored under `identity`, or None (missing, stale or unreadable)."""
        ...

    def put(self, identity: str, entry: CachedResult) -> None:
        """Store `entry` under `identity`, best effort."""
        ...


def is_cacheable(result: ImportResult, tier: str) -> bool:
    """True only for a finished plan that is clean or repaired -- never degraded.

    Excludes degraded, `method_not_grounded`, `no_recipe_found`, failed, and any other
    status or tier.
    """
    return result.status == "done" and tier in ("clean", "repaired")


def is_cacheable_source(source_key: str) -> bool:
    """False for pasted text (`text:`) and for an empty URL key -- those never cache.

    Pasted text is the user's own content (nothing to re-fetch, and the key would be
    the text itself); an empty `url:` key can't identify anything.
    """
    return not source_key.startswith("text:") and source_key not in ("", "url:")


DEFAULT_TTL = timedelta(days=7)
DEFAULT_MAX_ENTRIES = 500
DEFAULT_MAX_BYTES = 200 * 1024 * 1024


class DiskResultCache:
    """`ResultCache` backed by one JSON file per entry in a directory.

    Writes are atomic (temp file in the same directory + `os.replace`), so a reader
    never sees a half-written entry. Eviction is oldest-first by mtime until both
    `max_entries` and `max_bytes` hold.

    `ttl` defaults to 7 days. **That number is an arbitrary placeholder, not a measured
    value** -- nothing has been measured about how fast recipe sources drift. It only
    bounds staleness from source changes the pipeline fingerprint cannot see.
    """

    def __init__(
        self,
        directory: Path,
        *,
        ttl: timedelta = DEFAULT_TTL,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        max_bytes: int = DEFAULT_MAX_BYTES,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        """Configure the cache. The directory is created lazily on first `put`."""
        self._dir = directory
        self._ttl = ttl
        self._max_entries = max_entries
        self._max_bytes = max_bytes
        self._now = now

    def _path(self, identity: str) -> Path:
        return self._dir / f"{hashlib.sha256(identity.encode('utf-8')).hexdigest()}.json"

    def get(self, identity: str) -> CachedResult | None:
        """See `ResultCache.get`. Never raises."""
        path = self._path(identity)
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
            if envelope.get("format") != ENVELOPE_FORMAT or envelope.get("identity") != identity:
                return None
            tier = envelope["tier"]
            if tier not in ("clean", "repaired"):
                return None
            stored_at = datetime.fromisoformat(envelope["stored_at"])
            if self._now() - stored_at > self._ttl:
                with contextlib.suppress(OSError):
                    path.unlink()
                return None
            result = ImportResult.model_validate(envelope["result"])
            return CachedResult(result=result, tier=tier, step_count=int(envelope["step_count"]))
        except FileNotFoundError:
            return None
        except (OSError, ValueError, KeyError, TypeError, AttributeError, pydantic.ValidationError):
            _logger.warning("result cache: unreadable entry %s treated as a miss", path.name)
            return None

    def put(self, identity: str, entry: CachedResult) -> None:
        """See `ResultCache.put`. Any `OSError` is logged and swallowed."""
        tmp_name: str | None = None
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            envelope = {
                "format": ENVELOPE_FORMAT,
                "identity": identity,
                "stored_at": self._now().isoformat(),
                "tier": entry.tier,
                "step_count": entry.step_count,
                "result": entry.result.model_dump(mode="json"),
            }
            payload = json.dumps(envelope, ensure_ascii=False)
            with tempfile.NamedTemporaryFile(
                "w", encoding="utf-8", dir=self._dir, suffix=".tmp", delete=False
            ) as tmp:
                tmp_name = tmp.name
                tmp.write(payload)
                tmp.flush()
                os.fsync(tmp.fileno())
            os.replace(tmp_name, self._path(identity))
            tmp_name = None
            self._evict()
        except OSError as exc:
            _logger.warning("result cache: put failed (%s); continuing without it", exc)
        finally:
            if tmp_name is not None:
                with contextlib.suppress(OSError):
                    os.unlink(tmp_name)

    def _evict(self) -> None:
        """Delete oldest entries (by mtime) until count and size caps both hold."""
        entries: list[tuple[float, int, str]] = []
        with os.scandir(self._dir) as it:
            for e in it:
                if e.name.endswith(".json") and e.is_file():
                    st = e.stat()
                    entries.append((st.st_mtime_ns, st.st_size, e.path))
        entries.sort()
        count = len(entries)
        total = sum(size for _, size, _ in entries)
        for _, size, path in entries:
            if count <= self._max_entries and total <= self._max_bytes:
                break
            with contextlib.suppress(OSError):
                os.unlink(path)
            count -= 1
            total -= size
