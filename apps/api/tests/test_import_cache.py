"""A3 result cache wired into `run_import` and `POST /import`.

Offline: fake adapter + fake acquire, same pattern as `test_import_pipeline.py`. The four
invariants this file defends (the cache must be invisible except for speed):

1. A cold run with a cache attached is identical to a run with no cache at all.
2. A hit makes no acquire call, no LLM call, and runs no graph/validate/repair/schedule.
3. A hit returns the stored result untouched: same `graph.id`, same `source.imported_at`.
4. Only clean and repaired `done` results are ever stored, and never a `text:` source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from test_extract_repair import _broken_two_branch_recipe, _proposal, _source_text
from test_import_pipeline import _grounded_recipe, _ingredients_only_recipe, _raw

from abc_cook.api.main import create_app
from abc_cook.api.routes import import_ as import_routes
from abc_cook.extract import import_pipeline
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import NoRecipeFoundError
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.cache import CachedResult, DiskResultCache
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import
from abc_cook.extract.source_key import canonical_source_key
from abc_cook.schema.normalized import ImportResult

URL = "https://example.test/recipe/dal"
KEY = canonical_source_key("url", URL)
FROZEN = datetime(2026, 10, 1, 12, 0, tzinfo=UTC)


class _FrozenDatetime(datetime):
    """`datetime.now()` pinned, so `source.imported_at` is comparable across runs."""

    @classmethod
    def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
        return FROZEN


@pytest.fixture(autouse=True)
def _frozen_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(import_pipeline, "datetime", _FrozenDatetime)


@dataclass
class _Adapter:
    """Queued results, one per `.extract()` call; counts calls."""

    results: list[ExtractResult]
    calls: int = 0

    def extract(self, **_kwargs: Any) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


@dataclass
class _Acquire:
    raw: RawAcquisition
    calls: int = 0

    def __call__(self, url: str) -> RawAcquisition:
        self.calls += 1
        return self.raw.model_copy(update={"source_url": url})


@dataclass
class _SpyCache:
    """Records every call; stores nothing unless `store=True`."""

    store: bool = False
    gets: list[str] = field(default_factory=list)
    puts: list[str] = field(default_factory=list)
    _data: dict[str, CachedResult] = field(default_factory=dict)

    def get(self, identity: str) -> CachedResult | None:
        self.gets.append(identity)
        return self._data.get(identity)

    def put(self, identity: str, entry: CachedResult) -> None:
        self.puts.append(identity)
        if self.store:
            self._data[identity] = entry


def _scenario(name: str) -> tuple[RawAcquisition, list[ExtractResult]]:
    """(raw, queued adapter results) for each tier."""
    raw = _raw(source_url=URL)
    if name == "clean":
        return raw, [ExtractResult(recipe=_grounded_recipe())]
    if name == "tier0":
        return raw, [ExtractResult(recipe=_ingredients_only_recipe())]
    broken = _broken_two_branch_recipe().model_copy(update={"title": "Dal Makhni"})
    raw = _raw(source_url=URL, description=_source_text())
    if name == "repaired":
        fix = _proposal(
            [
                (["Onion"], "chopped onion", True),
                (["Butter"], "melted butter", False),
                (["chopped onion", "melted butter", "Salt"], None, True),
            ]
        )
        return raw, [ExtractResult(recipe=broken), ExtractResult(recipe=fix)]
    if name == "degraded":
        same = _proposal([(["Onion"], None, True), (["Butter"], None, False), ([], None, True)])
        return raw, [ExtractResult(recipe=broken), ExtractResult(recipe=same)]
    raise AssertionError(name)


def _run(
    name: str,
    *,
    cache: Any = None,
    fresh: bool = False,
    graph_id: str = "g_1",
    source_key: str | None = None,
    telemetry: list[ImportTelemetry] | None = None,
) -> tuple[ImportResult, _Adapter, _Acquire]:
    raw, results = _scenario(name)
    adapter, acquire = _Adapter(results), _Acquire(raw)
    result = run_import(
        URL,
        adapter,  # type: ignore[arg-type]
        graph_id=graph_id,
        acquire_fn=acquire,
        on_telemetry=(telemetry.append if telemetry is not None else None),
        cache=cache,
        fresh=fresh,
        source_key=source_key,
    )
    return result, adapter, acquire


# --- invariant 1: cache-miss equivalence ----------------------------------------------


@pytest.mark.parametrize("scenario", ["clean", "repaired", "degraded", "tier0"])
def test_cold_run_with_an_empty_cache_equals_a_run_without_one(scenario: str) -> None:
    plain, plain_adapter, _ = _run(scenario)
    cached, cached_adapter, _ = _run(scenario, cache=_SpyCache())
    assert cached.model_dump() == plain.model_dump()
    assert cached_adapter.calls == plain_adapter.calls


def test_scenarios_really_reach_their_tiers() -> None:
    seen: dict[str, str] = {}
    for scenario in ("clean", "repaired", "degraded", "tier0"):
        box: list[ImportTelemetry] = []
        _run(scenario, telemetry=box)
        seen[scenario] = box[0].tier
    assert seen == {
        "clean": "clean",
        "repaired": "repaired",
        "degraded": "degraded",
        "tier0": "tier0",
    }


def test_cold_telemetry_never_reports_a_cache_hit() -> None:
    box: list[ImportTelemetry] = []
    _run("clean", cache=_SpyCache(), telemetry=box)
    assert box[0].cache_hit is False
    assert "cache" not in box[0].stage_s


# --- invariants 2 + 3: a hit does no work and changes nothing --------------------------


@pytest.mark.parametrize("scenario", ["clean", "repaired"])
def test_hit_does_no_work_and_returns_the_stored_result_byte_for_byte(
    scenario: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = DiskResultCache(tmp_path)
    cold, _, _ = _run(scenario, cache=cache, graph_id="g_first")
    assert cold.graph is not None

    def boom(*_a: object, **_k: object) -> None:
        raise AssertionError("pipeline work ran on a cache hit")

    for name in ("build_graph", "schedule", "repair_or_degrade", "normalize", "validate"):
        monkeypatch.setattr(import_pipeline, name, boom)

    statuses: list[str] = []
    previews: list[object] = []
    box: list[ImportTelemetry] = []
    raw, results = _scenario(scenario)
    adapter, acquire = _Adapter(results), _Acquire(raw)
    hit = run_import(
        URL,
        adapter,  # type: ignore[arg-type]
        graph_id="g_second_job",  # a different job id: the stored graph id must win
        acquire_fn=acquire,
        on_status=statuses.append,
        on_preview=previews.append,
        on_telemetry=box.append,
        cache=cache,
    )

    assert acquire.calls == 0
    assert adapter.calls == 0
    assert statuses == []
    assert previews == []
    assert hit.model_dump_json() == cold.model_dump_json()
    assert hit.graph is not None
    assert hit.graph.id == "g_first"
    assert hit.graph.source.imported_at == FROZEN
    (t,) = box
    assert t.cache_hit is True
    assert t.tier == scenario
    assert t.extraction_calls == []
    assert t.repair_calls == []
    assert set(t.stage_s) == {"cache"}
    assert t.ttp_s == t.ttr_s


def test_hit_keeps_the_original_import_time_even_when_the_clock_has_moved(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = DiskResultCache(tmp_path)
    cold, _, _ = _run("clean", cache=cache)

    class _Later(_FrozenDatetime):
        @classmethod
        def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
            return FROZEN + timedelta(days=3)

    monkeypatch.setattr(import_pipeline, "datetime", _Later)
    hit, _, _ = _run("clean", cache=cache, graph_id="g_other")
    assert hit.graph is not None
    assert cold.graph is not None
    assert hit.graph.source.imported_at == cold.graph.source.imported_at == FROZEN


def test_changing_the_extraction_effort_misses(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path)
    raw, results = _scenario("clean")
    run_import(
        URL,
        _Adapter(results),
        graph_id="g",
        acquire_fn=_Acquire(raw),
        cache=cache,  # type: ignore[arg-type]
    )
    adapter = _Adapter(_scenario("clean")[1])
    run_import(
        URL,
        adapter,  # type: ignore[arg-type]
        graph_id="g",
        acquire_fn=_Acquire(raw),
        cache=cache,
        extraction_effort="medium",
    )
    assert adapter.calls == 1  # a different effort is a different identity


def test_equivalent_url_spellings_share_one_entry(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path)
    raw, results = _scenario("clean")
    run_import(
        "https://WWW.Example.test/recipe/dal/?utm_source=x",
        _Adapter(results),  # type: ignore[arg-type]
        graph_id="g",
        acquire_fn=_Acquire(raw),
        cache=cache,
    )
    adapter, acquire = _Adapter([]), _Acquire(raw)
    hit = run_import(
        "https://example.test/recipe/dal",
        adapter,  # type: ignore[arg-type]
        graph_id="g2",
        acquire_fn=acquire,
        cache=cache,
    )
    assert hit.status == "done"
    assert acquire.calls == 0


# --- invariant 4: what is (not) stored -------------------------------------------------


def test_clean_and_repaired_results_are_stored() -> None:
    for scenario in ("clean", "repaired"):
        spy = _SpyCache(store=True)
        _run(scenario, cache=spy)
        assert len(spy.puts) == 1, scenario


@pytest.mark.parametrize("scenario", ["degraded", "tier0"])
def test_degraded_and_tier0_results_are_never_stored(scenario: str) -> None:
    spy = _SpyCache(store=True)
    _run(scenario, cache=spy)
    assert spy.puts == []
    assert len(spy.gets) == 1  # still looked up: only the put is gated on the result


def test_method_not_grounded_after_normalize_is_never_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The defensive `build_graph() is None` path."""
    from abc_cook.extract.graph import GraphBuildResult

    monkeypatch.setattr(
        import_pipeline,
        "build_graph",
        lambda *a, **k: GraphBuildResult(graph=None, warnings=["refused"]),
    )
    spy = _SpyCache(store=True)
    result, _, _ = _run("clean", cache=spy)
    assert result.status == "method_not_grounded"
    assert spy.puts == []


def test_no_recipe_found_is_never_stored() -> None:
    def refuse(_url: str) -> RawAcquisition:
        raise NoRecipeFoundError("no recipe on this page")

    spy = _SpyCache(store=True)
    result = run_import(
        URL,
        _Adapter([]),
        graph_id="g",
        acquire_fn=refuse,
        cache=spy,  # type: ignore[arg-type]
    )
    assert result.status == "no_recipe_found"
    assert spy.puts == []


def test_an_exception_is_never_stored_and_still_propagates() -> None:
    def explode(_url: str) -> RawAcquisition:
        raise RuntimeError("network down")

    spy = _SpyCache(store=True)
    with pytest.raises(RuntimeError, match="network down"):
        run_import(URL, _Adapter([]), graph_id="g", acquire_fn=explode, cache=spy)  # type: ignore[arg-type]
    assert spy.puts == []


def test_text_source_key_never_touches_the_cache() -> None:
    spy = _SpyCache(store=True)
    raw = _raw(source_url="", source_kind="text")
    run_import(
        "",
        _Adapter([ExtractResult(recipe=_grounded_recipe())]),  # type: ignore[arg-type]
        graph_id="g",
        acquire_fn=_Acquire(raw),
        cache=spy,
        source_key=canonical_source_key("text", raw.description or ""),
    )
    assert spy.gets == []
    assert spy.puts == []


def test_text_acquisition_is_not_stored_even_with_a_url_shaped_key() -> None:
    """The second, independent guard: `raw.source_kind == "text"` blocks the put."""
    spy = _SpyCache(store=True)
    raw = _raw(source_url=URL, source_kind="text")
    run_import(
        URL,
        _Adapter([ExtractResult(recipe=_grounded_recipe())]),  # type: ignore[arg-type]
        graph_id="g",
        acquire_fn=_Acquire(raw),
        cache=spy,
    )
    assert spy.puts == []


# --- fresh ---------------------------------------------------------------------------


def test_fresh_skips_the_lookup_but_still_stores_and_the_next_run_hits(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path)
    _run("clean", cache=cache)

    adapter_fresh = _Adapter(_scenario("clean")[1])
    raw = _scenario("clean")[0]
    box: list[ImportTelemetry] = []
    run_import(
        URL,
        adapter_fresh,  # type: ignore[arg-type]
        graph_id="g_fresh",
        acquire_fn=_Acquire(raw),
        cache=cache,
        fresh=True,
        on_telemetry=box.append,
    )
    assert adapter_fresh.calls == 1  # ran cold despite an existing entry
    assert box[0].cache_hit is False

    after, adapter_after, _ = _run("clean", cache=cache, graph_id="g_next")
    assert adapter_after.calls == 0
    assert after.graph is not None
    assert after.graph.id == "g_fresh"  # the fresh run's entry replaced the old one


def test_fresh_does_not_call_get() -> None:
    spy = _SpyCache(store=True)
    _run("clean", cache=spy, fresh=True)
    assert spy.gets == []
    assert len(spy.puts) == 1


# --- a broken cache never breaks an import ---------------------------------------------


def test_cache_that_raises_is_treated_as_a_miss() -> None:
    class _Broken:
        def get(self, identity: str) -> CachedResult | None:
            raise RuntimeError("get exploded")

        def put(self, identity: str, entry: CachedResult) -> None:
            raise RuntimeError("put exploded")

    plain, _, _ = _run("clean")
    result, _, _ = _run("clean", cache=_Broken())
    assert result.model_dump() == plain.model_dump()


# --- route ---------------------------------------------------------------------------


def _client(cache: Any, results: list[ExtractResult], raw: RawAcquisition) -> TestClient:
    app = create_app()
    app.dependency_overrides[import_routes.get_acquire] = lambda: _Acquire(raw)
    app.dependency_overrides[import_routes.get_adapter] = lambda: _Adapter(results)
    app.dependency_overrides[import_routes.get_result_cache] = lambda: cache
    return TestClient(app)


def test_route_passes_fresh_through() -> None:
    spy = _SpyCache(store=True)
    raw = _raw(source_url=URL)
    client = _client(spy, [ExtractResult(recipe=_grounded_recipe())], raw)
    assert client.post("/import?fresh=1", json={"url": URL}).status_code == 202
    assert spy.gets == []
    assert len(spy.puts) == 1

    client = _client(spy, [ExtractResult(recipe=_grounded_recipe())], raw)
    assert client.post("/import", json={"url": URL}).status_code == 202
    assert len(spy.gets) == 1  # no `fresh`: the lookup happens


def test_route_serves_a_repeat_import_from_the_cache(tmp_path: Path) -> None:
    cache = DiskResultCache(tmp_path)
    raw = _raw(source_url=URL)
    first = _client(cache, [ExtractResult(recipe=_grounded_recipe())], raw)
    job1 = first.post("/import", json={"url": URL}).json()["job_id"]
    body1 = first.get(f"/import/{job1}").json()

    second = _client(cache, [], raw)  # no queued LLM results: any call would IndexError
    job2 = second.post("/import", json={"url": URL}).json()["job_id"]
    body2 = second.get(f"/import/{job2}").json()
    assert body2["status"] == "done"
    assert body2["result"] == body1["result"]
    assert body2["result"]["graph"]["id"] == job1  # the stored graph id, not job2


def test_route_text_body_never_touches_the_cache() -> None:
    spy = _SpyCache(store=True)
    text = (
        "Dal Makhni\n\nIngredients: 1 onion.\n\nMethod: Heat oil, add onion, cook until "
        "golden. Serve hot."
    )
    app = create_app()
    app.dependency_overrides[import_routes.get_adapter] = lambda: _Adapter(
        [ExtractResult(recipe=_grounded_recipe())]
    )
    app.dependency_overrides[import_routes.get_result_cache] = lambda: spy
    client = TestClient(app)
    response = client.post("/import", json={"text": text})
    assert response.status_code == 202
    job = client.get(f"/import/{response.json()['job_id']}").json()
    assert job["status"] == "done"
    assert spy.gets == []
    assert spy.puts == []


def test_cache_is_off_unless_the_env_var_is_set(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv(import_routes.RESULT_CACHE_ENV, raising=False)
    assert import_routes.get_result_cache() is None
    monkeypatch.setenv(import_routes.RESULT_CACHE_ENV, "")
    assert import_routes.get_result_cache() is None
    monkeypatch.setenv(import_routes.RESULT_CACHE_ENV, str(tmp_path))
    assert isinstance(import_routes.get_result_cache(), DiskResultCache)
