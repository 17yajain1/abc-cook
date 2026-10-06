"""scripts/import_bench.py COLD/HIT columns (A3). Offline: fakes only, script loaded by path."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from test_extract_repair import _broken_two_branch_recipe, _proposal, _source_text
from test_import_pipeline import _grounded_recipe, _raw

from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.cache import DiskResultCache

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_bench.py"
URL = "https://example.test/recipe/dal"


@pytest.fixture(scope="module")
def bench() -> ModuleType:
    spec = importlib.util.spec_from_file_location("import_bench_under_test", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["import_bench_under_test"] = module
    spec.loader.exec_module(module)
    return module


class _Adapter:
    def __init__(self, results: list[ExtractResult]) -> None:
        self.results = results
        self.calls = 0

    def extract(self, **_kwargs: Any) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


def test_cold_is_a_miss_hit_is_a_hit_and_the_table_shows_both_columns(
    bench: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    raw = _raw(source_url=URL)
    adapter = _Adapter([ExtractResult(recipe=_grounded_recipe())])  # one call only
    row = bench.bench_url(
        URL,
        0,
        adapter,
        DiskResultCache(tmp_path),
        lambda u: raw.model_copy(update={"source_url": u}),
    )

    assert adapter.calls == 1  # the HIT run made no LLM call
    assert row["tier"] == "clean"
    assert row["hit"] == "HIT"
    assert row["hit_ttp_s"] is not None
    assert row["stage_s"]["extract"] >= 0.0  # COLD numbers come from the cold run
    assert "cache" not in row["stage_s"]

    bench._print_table([row])
    header, line = capsys.readouterr().out.splitlines()
    assert "COLD_TTP" in header
    assert "HIT_TTP" in header
    assert header.split()[-1] == "hit"
    assert line.split()[-1] == "HIT"


def test_a_result_the_cache_refuses_is_not_rerun_and_shows_na(
    bench: ModuleType, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    broken = _broken_two_branch_recipe().model_copy(update={"title": "Dal Makhni"})
    same = _proposal([(["Onion"], None, True), (["Butter"], None, False), ([], None, True)])
    raw = _raw(source_url=URL, description=_source_text())
    adapter = _Adapter([ExtractResult(recipe=broken), ExtractResult(recipe=same)])

    row = bench.bench_url(
        URL,
        0,
        adapter,
        DiskResultCache(tmp_path),
        lambda u: raw.model_copy(update={"source_url": u}),
    )

    assert row["tier"] == "degraded"
    assert row["hit"] == "n/a (degraded)"
    assert row["hit_ttp_s"] is None  # never a cold number dressed up as a HIT
    assert adapter.calls == 2  # extraction + repair, and no second import

    bench._print_table([row])
    assert re.search(r"-\s+n/a \(degraded\)\s*$", capsys.readouterr().out.splitlines()[-1])


def test_cold_run_is_always_fresh_even_when_the_cache_already_has_the_entry(
    bench: ModuleType, tmp_path: Path
) -> None:
    raw = _raw(source_url=URL)
    cache = DiskResultCache(tmp_path)
    acquire = lambda u: raw.model_copy(update={"source_url": u})  # noqa: E731
    bench.bench_url(URL, 0, _Adapter([ExtractResult(recipe=_grounded_recipe())]), cache, acquire)

    second = _Adapter([ExtractResult(recipe=_grounded_recipe())])
    row = bench.bench_url(URL, 1, second, cache, acquire)
    assert second.calls == 1  # COLD ignored the existing entry
    assert row["hit"] == "HIT"
