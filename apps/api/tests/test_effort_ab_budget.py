"""scripts/effort_ab.py runner safety: spend cap with in-flight reservations, priority order.

Offline: threads and fakes only. The script is imported by path (it lives in scripts/).
"""

from __future__ import annotations

import importlib.util
import sys
import threading
import time
from pathlib import Path
from types import ModuleType

import pytest

from abc_cook.extract.acquire import RawAcquisition

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "effort_ab.py"


@pytest.fixture(scope="module")
def ab() -> ModuleType:
    spec = importlib.util.spec_from_file_location("effort_ab_under_test", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["effort_ab_under_test"] = module
    spec.loader.exec_module(module)
    return module


def _raw(name: str) -> RawAcquisition:
    return RawAcquisition(source_url=f"https://example.test/{name}", title=name)


# --- Budget ------------------------------------------------------------------------


def test_reserve_is_3_5_by_default(ab: ModuleType) -> None:
    assert ab.RESERVE_INR == 3.5
    assert ab.Budget(cap_inr=10).reserve_inr == 3.5


def test_in_flight_reservations_count_against_the_cap(ab: ModuleType) -> None:
    budget = ab.Budget(cap_inr=10.0)
    assert budget.acquire()  # reserved 3.5
    assert budget.acquire()  # reserved 7.0
    assert budget.spent + budget.reserved == 7.0
    results: list[bool] = []
    third = threading.Thread(target=lambda: results.append(budget.acquire()))
    third.start()
    time.sleep(0.1)
    assert third.is_alive()  # 7.0 + 3.5 > 10: waits instead of overshooting
    budget.release(2.0)  # one finishes cheaper than its reserve
    third.join(timeout=2)
    assert results == [True]  # 2.0 spent + 3.5 reserved + 3.5 <= 10
    budget.release(2.0)
    budget.release(2.0)
    assert budget.reserved == 0
    assert budget.spent == pytest.approx(6.0)


def test_a_run_that_cannot_fit_even_alone_is_skipped_not_waited_on(ab: ModuleType) -> None:
    budget = ab.Budget(cap_inr=10.0, spent=7.0)
    assert budget.acquire() is False  # 7.0 + 3.5 > 10 and nothing in flight


def test_unpriced_or_failed_runs_are_charged_the_full_reserve(ab: ModuleType) -> None:
    budget = ab.Budget(cap_inr=10.0)
    assert budget.acquire()
    budget.release(None)
    assert budget.spent == 3.5
    assert budget.unpriced == 1
    assert budget.reserved == 0


def test_concurrent_workers_never_exceed_the_cap_when_runs_cost_at_most_the_reserve(
    ab: ModuleType,
) -> None:
    budget = ab.Budget(cap_inr=12.0)
    peak = 0.0
    peak_lock = threading.Lock()
    ran = 0

    def worker() -> None:
        nonlocal peak, ran
        if not budget.acquire():
            return
        with peak_lock:
            peak = max(peak, budget.spent + budget.reserved)
            ran += 1
        time.sleep(0.02)
        budget.release(3.2)  # the most expensive measured run

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert peak <= 12.0
    assert budget.spent <= 12.0
    assert budget.reserved == 0
    assert ran == 3  # 3 x 3.2 = 9.6 spent; a 4th would need 9.6 + 3.5 > 12


# --- ordering ----------------------------------------------------------------------


def _loaded(*names: str) -> list[tuple[str, RawAcquisition]]:
    return [(n, _raw(n)) for n in names]


def test_priority_tokens_pull_matching_inputs_to_the_front_in_token_order(
    ab: ModuleType,
) -> None:
    names = ["gnocchi", "kibbeh", "tiramisu", "burger", "cake", "tartiflette"]
    ordered = ab.order_inputs(_loaded(*names), names, ["burger", "tartiflette", "tiramisu"])
    assert [n for n, _ in ordered] == [
        "burger",
        "tartiflette",
        "tiramisu",
        "gnocchi",
        "kibbeh",
        "cake",
    ]


def test_priority_matches_the_spec_as_well_as_the_name(ab: ModuleType) -> None:
    specs = ["https://a.test/x", "https://b.test/burger-video"]
    ordered = ab.order_inputs(_loaded("a", "b"), specs, ["burger"])
    assert [n for n, _ in ordered] == ["b", "a"]


def test_no_priority_keeps_given_order(ab: ModuleType) -> None:
    ordered = ab.order_inputs(_loaded("c", "a", "b"), ["c", "a", "b"], [])
    assert [n for n, _ in ordered] == ["c", "a", "b"]


def test_jobs_are_input_major_so_the_cap_removes_whole_low_priority_inputs(
    ab: ModuleType,
) -> None:
    ordered = _loaded("burger", "tartiflette")
    jobs = ab.plan_jobs(ordered, ["medium", "low"], n=1)
    assert [(n, arm) for n, _, arm, _ in jobs] == [
        ("burger", "medium"),
        ("burger", "low"),
        ("tartiflette", "medium"),
        ("tartiflette", "low"),
    ]
