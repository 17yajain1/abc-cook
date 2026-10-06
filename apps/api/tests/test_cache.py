"""extract/cache.py -- `DiskResultCache` primitives and cacheability rules (A3 stage 1).

Offline, filesystem-only (pytest `tmp_path`). Fingerprint invalidation tests live
further down (stage 3).
"""

from __future__ import annotations

import dataclasses
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract import cache as cache_mod
from abc_cook.extract.cache import (
    CachedResult,
    DiskResultCache,
    PipelineFingerprint,
    cache_identity,
    current_fingerprint,
    is_cacheable,
    is_cacheable_source,
)
from abc_cook.extract.repair import RepairProposal
from abc_cook.extract.source_key import canonical_source_key
from abc_cook.schema.normalized import ImportResult, NormalizedRecipe

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


# --- Fingerprint / identity (A3 stage 3) -----------------------------------------------


class _AlteredRecipe(NormalizedRecipe):
    extra_field: int = 0


class _AlteredResult(ImportResult):
    extra_field: int = 0


class _AlteredProposal(RepairProposal):
    extra_field: int = 0


_BASE = current_fingerprint("low")

_ONE_CHANGE: dict[str, dict[str, Any]] = {
    "extraction_effort": {"extraction_effort": "medium"},
    "extraction_effort_none": {"extraction_effort": None},
    "extraction_model": {"extraction_model": "gpt-5-nano"},
    "extraction_prompt": {"extraction_prompt": "a different extraction prompt"},
    "extraction_schema": {"extraction_output_type": _AlteredRecipe},
    "repair_model": {"repair_model": "claude-other"},
    "repair_effort": {"repair_effort": "high"},
    "repair_prompt": {"repair_prompt": "a different repair prompt"},
    "repair_schema": {"repair_output_type": _AlteredProposal},
    "max_tokens": {"max_tokens": 16_001},
    "escalated_max_tokens": {"escalated_max_tokens": 32_001},
    "repair_max_tokens": {"repair_max_tokens": 8_001},
    "postprocess_version": {"postprocess_version": 2},
    "burner_capacity": {"burner_capacity": 2},
    "result_schema": {"result_type": _AlteredResult},
}


def _fp(**overrides: Any) -> PipelineFingerprint:
    return current_fingerprint(**{"extraction_effort": "low", **overrides})


def _identity(**overrides: Any) -> str:
    return cache_identity("youtube:abc", _fp(**overrides))


def test_identity_is_stable_for_identical_inputs() -> None:
    assert _identity() == _identity()
    assert json.loads(_identity())["source_key"] == "youtube:abc"


def test_fingerprint_defaults_read_the_live_pipeline_constants() -> None:
    from abc_cook.extract import normalize, repair
    from abc_cook.extract.import_pipeline import DEFAULT_BURNER_CAPACITY

    assert _BASE.extraction_model == normalize.DEFAULT_MODEL
    assert _BASE.repair_model == repair.REPAIR_MODEL
    assert _BASE.repair_effort == repair.REPAIR_EFFORT
    assert _BASE.max_tokens == normalize.MAX_TOKENS
    assert _BASE.escalated_max_tokens == normalize.ESCALATED_MAX_TOKENS
    assert _BASE.repair_max_tokens == repair.MAX_TOKENS
    assert _BASE.postprocess_version == cache_mod.POSTPROCESS_VERSION
    assert _BASE.burner_capacity == DEFAULT_BURNER_CAPACITY


def test_source_key_is_part_of_the_identity() -> None:
    assert cache_identity("youtube:abc", _BASE) != cache_identity("youtube:abd", _BASE)


@pytest.mark.parametrize("name", list(_ONE_CHANGE))
def test_changing_one_fingerprint_field_is_a_miss(name: str, tmp_path: Path) -> None:
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put(_identity(), _entry())
    assert c.get(_identity()) is not None
    changed = _identity(**_ONE_CHANGE[name])
    assert changed != _identity()
    assert c.get(changed) is None


def test_every_fingerprint_field_has_an_invalidation_case() -> None:
    covered = {
        "extraction_model",
        "extraction_effort",
        "extraction_prompt_sha256",
        "repair_model",
        "repair_effort",
        "repair_prompt_sha256",
        "max_tokens",
        "escalated_max_tokens",
        "repair_max_tokens",
        "postprocess_version",
        "burner_capacity",
        "result_schema_sha256",
    }
    assert {f.name for f in dataclasses.fields(PipelineFingerprint)} == covered
    # Each change above must move exactly the field(s) it targets.
    moved = set()
    for overrides in _ONE_CHANGE.values():
        fp = _fp(**overrides)
        moved |= {k for k, v in dataclasses.asdict(fp).items() if v != dataclasses.asdict(_BASE)[k]}
    assert moved == covered


def test_identity_with_a_lone_surrogate_source_key_is_encodable(tmp_path: Path) -> None:
    key = canonical_source_key("text", "a\U0001f35b" * 30)  # 32-unit slice splits the pair
    identity = cache_identity(key, _BASE)
    identity.encode("utf-8")  # must not raise
    c = DiskResultCache(tmp_path, now=_Clock())
    c.put(identity, _entry())
    assert c.get(identity) is not None
