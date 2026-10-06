"""extract/cache.py -- `DiskResultCache` primitives and cacheability rules (A3 stage 1).

Offline, filesystem-only (pytest `tmp_path`). Fingerprint invalidation tests live
further down (stage 3).
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from abc_cook.extract import cache as cache_mod
from abc_cook.extract.cache import (
    CachedResult,
    DiskResultCache,
    is_cacheable,
    is_cacheable_source,
)
from abc_cook.schema.normalized import ImportResult

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


def _entry(title: str = "Dal", tier: str = "clean", steps: int = 3) -> CachedResult:
    result = ImportResult(status="done", source_title=title)
    return CachedResult(result=result, tier=tier, step_count=steps)  # type: ignore[arg-type]


class _Clock:
    def __init__(self) -> None:
        self.t = T0

    def __call__(self) -> datetime:
        return self.t


def _files(d: Path) -> list[Path]:
    return sorted(d.iterdir()) if d.exists() else []


def test_round_trip(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("id-1", _entry("Dal", "repaired", 7))
    got = c.get("id-1")
    assert got is not None
    assert got.result.source_title == "Dal"
    assert got.tier == "repaired"
    assert got.step_count == 7
    assert c.get("id-2") is None


def test_missing_directory_is_a_miss(tmp_path: Path) -> None:
    assert DiskResultCache(tmp_path / "nope").get("x") is None


def test_ttl_boundary(tmp_path: Path) -> None:
    clock = _Clock()
    c = DiskResultCache(tmp_path, ttl=timedelta(days=7), now=clock)
    c.put("k", _entry())
    clock.t = T0 + timedelta(days=7)  # exactly the TTL: still fresh
    assert c.get("k") is not None
    clock.t = T0 + timedelta(days=7, seconds=1)
    assert c.get("k") is None
    assert _files(tmp_path) == []  # expired file is removed, best effort


def test_default_ttl_is_seven_days() -> None:
    assert timedelta(days=7) == cache_mod.DEFAULT_TTL
    assert "placeholder" in (cache_mod.DiskResultCache.__doc__ or "")


def test_corrupt_json_is_a_miss(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("k", _entry())
    (path,) = _files(tmp_path)
    path.write_text("{not json", encoding="utf-8")
    assert c.get("k") is None


def test_invalid_result_schema_is_a_miss(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("k", _entry())
    (path,) = _files(tmp_path)
    env = json.loads(path.read_text(encoding="utf-8"))
    env["result"]["status"] = "no-such-status"
    path.write_text(json.dumps(env), encoding="utf-8")
    assert c.get("k") is None


def test_identity_mismatch_is_a_miss(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("k", _entry())
    (path,) = _files(tmp_path)
    env = json.loads(path.read_text(encoding="utf-8"))
    env["identity"] = "some-other-identity"
    path.write_text(json.dumps(env), encoding="utf-8")
    assert c.get("k") is None


def test_unknown_envelope_format_is_a_miss(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("k", _entry())
    (path,) = _files(tmp_path)
    env = json.loads(path.read_text(encoding="utf-8"))
    env["format"] = 99
    path.write_text(json.dumps(env), encoding="utf-8")
    assert c.get("k") is None


def _age(path: Path, seconds_ago: float) -> None:
    t = path.stat().st_mtime - seconds_ago
    os.utime(path, (t, t))


def test_eviction_by_count_oldest_first(tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, max_entries=2, now=_Clock())
    c.put("a", _entry("A"))
    c.put("b", _entry("B"))
    _age(c._path("a"), 100)
    _age(c._path("b"), 50)
    c.put("c", _entry("C"))
    assert c.get("a") is None
    assert c.get("b") is not None
    assert c.get("c") is not None


def test_eviction_by_bytes_oldest_first(tmp_path: Path) -> None:
    probe = DiskResultCache(tmp_path / "probe", now=_Clock())
    probe.put("a", _entry("A"))
    size = probe._path("a").stat().st_size

    c = DiskResultCache(tmp_path / "real", max_bytes=size * 2 + size // 2, now=_Clock())
    c.put("a", _entry("A"))
    c.put("b", _entry("B"))
    _age(c._path("a"), 100)
    _age(c._path("b"), 50)
    c.put("c", _entry("C"))
    assert c.get("a") is None
    assert c.get("b") is not None
    assert c.get("c") is not None


def test_failed_write_leaves_no_stray_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())

    def boom(_fd: int) -> None:
        raise OSError("disk on fire")

    monkeypatch.setattr(cache_mod.os, "fsync", boom)
    c.put("k", _entry())  # swallowed
    assert _files(tmp_path) == []
    monkeypatch.undo()
    assert c.get("k") is None


def test_put_oserror_is_swallowed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    blocker = tmp_path / "file-not-dir"
    blocker.write_text("x")
    c = DiskResultCache(blocker / "sub", now=_Clock())  # mkdir under a file -> OSError
    c.put("k", _entry())
    assert c.get("k") is None


def test_replace_failure_keeps_old_entry_and_cleans_temp(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put("k", _entry("old"))

    def boom(*_a: object) -> None:
        raise OSError("replace failed")

    monkeypatch.setattr(cache_mod.os, "replace", boom)
    c.put("k", _entry("new"))
    monkeypatch.undo()
    got = c.get("k")
    assert got is not None
    assert got.result.source_title == "old"
    assert [p.suffix for p in _files(tmp_path)] == [".json"]


def test_is_cacheable() -> None:
    done = ImportResult(status="done")
    assert is_cacheable(done, "clean")
    assert is_cacheable(done, "repaired")
    assert not is_cacheable(done, "degraded")
    assert not is_cacheable(done, "tier0")
    assert not is_cacheable(ImportResult(status="method_not_grounded"), "clean")
    assert not is_cacheable(ImportResult(status="no_recipe_found"), "tier0")
    assert not is_cacheable(ImportResult(status="failed"), "clean")


def test_is_cacheable_source() -> None:
    assert is_cacheable_source("youtube:abc")
    assert is_cacheable_source("url:example.com/dal")
    assert not is_cacheable_source("text:some pasted recipe")
    assert not is_cacheable_source("url:")
    assert not is_cacheable_source("")
