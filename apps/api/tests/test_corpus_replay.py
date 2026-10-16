"""Offline replay of the widened golden corpus (kadhi-pakora, croissant, pumpkin-pancakes).

Each recipe is a real import, frozen as `fixtures/import/<slug>.original.json` (the
`ImportOriginal`). It is replayed through `postprocess.reprocess()`, the production refresh
path, which takes no adapter and makes no LLM or network call.

Two kinds of check:

* **Snapshot.** The replay must equal `<slug>.replay-expected.json`: node labels and edges, each
  node's duration with its provenance, windows with their assigned order, totals and sittings.
  The snapshot is regenerated ONLY by the documented command (there is no auto-update flag):

      PYTHONPATH=apps/api python apps/api/scripts/regen_corpus_expected.py

  A diff is a product decision, not a test fix. Surface it, review `git diff` of the snapshot,
  and only then regenerate (same rule as `test_schedule.py`).
* **Named assertions.** They pin only advice that is right. A recipe's `known_issues` in its
  snapshot name the flagged items (ids from `docs/plans/followup-golden-corpus.md`); no named
  assertion here may pin one of those, so a future fix that changes them is an expected snapshot
  diff and not a broken assertion.
"""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from abc_cook.extract.postprocess import reprocess
from abc_cook.extract.validate import validate

_ROOT = Path(__file__).resolve().parents[3]
_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "regen_corpus_expected.py"
_FOLLOWUPS = _ROOT / "docs" / "plans" / "followup-golden-corpus.md"
_REGEN = "PYTHONPATH=apps/api python apps/api/scripts/regen_corpus_expected.py"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("regen_corpus_expected_under_test", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


regen = _load_script()
SLUGS: list[str] = regen.SLUGS


def _expected(slug: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads(regen.expected_path(slug).read_text(encoding="utf-8"))
    return data


def _snapshot(slug: str) -> dict[str, Any]:
    # Round-trip through JSON so int/float and tuple-vs-list differences cannot matter.
    snap: dict[str, Any] = json.loads(
        json.dumps(regen.build_snapshot(slug, _expected(slug)["known_issues"]), ensure_ascii=False)
    )
    return snap


@pytest.mark.parametrize("slug", SLUGS)
def test_replay_matches_frozen_snapshot(slug: str) -> None:
    expected, actual = _expected(slug), _snapshot(slug)
    assert actual == expected, (
        f"{slug}: the offline replay no longer equals {slug}.replay-expected.json. "
        "This is a product decision, not a test fix: a changed label, edge, duration, window or "
        "total changes the advice a cook sees. Check whether the change is intended (is it a fix "
        f"for one of the known_issues {expected['known_issues']}?), review the diff, and only "
        f"then regenerate with `{_REGEN}`."
    )


@pytest.mark.parametrize("slug", SLUGS)
def test_replay_graph_is_valid_and_deterministic(slug: str) -> None:
    original = regen.load_original(slug)
    first, second = reprocess(original).result, reprocess(original).result
    assert first.graph is not None
    assert first.plan is not None
    assert validate(first.graph) == []
    assert "degraded" not in first.warnings
    assert first.graph.model_dump(mode="json") == second.graph.model_dump(mode="json")
    assert first.plan.model_dump(mode="json") == second.plan.model_dump(mode="json")


@pytest.mark.parametrize("slug", SLUGS)
def test_known_issue_ids_exist_in_followups(slug: str) -> None:
    followups = _FOLLOWUPS.read_text(encoding="utf-8")
    for issue in _expected(slug)["known_issues"]:
        assert re.search(rf"\b{re.escape(issue)}\b", followups), (
            f"{slug}: known issue {issue} is not in {_FOLLOWUPS.name}"
        )


# --- Named assertions: advice that is right. None pins a flagged item. ---------------------


def _node(snap: dict[str, Any], label: str) -> dict[str, Any]:
    (found,) = [n for n in snap["nodes"] if n["label"] == label]
    node: dict[str, Any] = found
    return node


def test_kadhi_base_is_a_chain_then_the_kadhi_cooks() -> None:
    snap = _snapshot("kadhi-pakora")
    assert _node(snap, "Temper spices")["depends_on"] == ["Mix kadi"]
    assert "Temper spices" in _node(snap, "Cook kadi")["depends_on"]


def test_kadhi_par_fried_pakoras_rest_before_the_second_fry() -> None:
    snap = _snapshot("kadhi-pakora")
    rest, finish = _node(snap, "Rest pakoras"), _node(snap, "Finish fry")
    assert rest["attention"] == "unattended"
    assert "Rest pakoras" in finish["depends_on"]
    assert finish["start_min"] >= rest["start_min"] + rest["duration_min"]


def test_kadhi_serve_is_the_last_step_and_needs_the_pakoras_and_the_tempering() -> None:
    snap = _snapshot("kadhi-pakora")
    serve = _node(snap, "Serve")
    assert {"Add pakoras", "Make tempering"} <= set(serve["depends_on"])
    assert all("Serve" not in n["depends_on"] for n in snap["nodes"])
    assert serve["start_min"] == max(n["start_min"] for n in snap["nodes"])


def test_croissant_three_long_waits_are_stated_and_unattended() -> None:
    snap = _snapshot("croissant")
    for label in ("Rest dough", "Chill", "Proof again"):
        node = _node(snap, label)
        assert (node["duration_min"], node["duration_max"]) == (60, 60), label
        assert node["duration_source"] == "extracted", label
        assert node["attention"] == "unattended", label
    assert snap["long_waits"] == 3


def test_croissant_has_no_meanwhile_window_and_saves_nothing() -> None:
    snap = _snapshot("croissant")
    assert snap["windows"] == []
    assert snap["totals"]["saved_min"] == 0


def test_croissant_knead_and_bake_durations_are_stated() -> None:
    snap = _snapshot("croissant")
    knead, bake = _node(snap, "Knead dough"), _node(snap, "Bake")
    assert (knead["duration_min"], knead["duration_source"]) == (6, "extracted")
    assert (bake["duration_min"], bake["duration_max"]) == (20, 25)
    assert (bake["attention"], bake["station"], bake["duration_source"]) == (
        "unattended",
        "oven",
        "extracted",
    )
    assert bake["start_min"] == max(n["start_min"] for n in snap["nodes"])


def test_pumpkin_repair_proposal_is_replayed_without_a_call() -> None:
    assert _snapshot("pumpkin-pancakes")["repair_applied"] is True


def test_pumpkin_cooking_waits_for_the_batter_and_is_the_only_burner_step() -> None:
    snap = _snapshot("pumpkin-pancakes")
    burner = [n["label"] for n in snap["nodes"] if n["station"] == "burner"]
    assert burner == ["Cook pancakes"]
    assert _node(snap, "Cook pancakes")["depends_on"] == ["Make batter"]


def test_pumpkin_starts_with_mixing_and_claims_no_parallelism() -> None:
    snap = _snapshot("pumpkin-pancakes")
    first = _node(snap, "Mix pumpkin")
    assert (first["start_min"], first["depends_on"]) == (0, [])
    assert snap["windows"] == []
    assert snap["totals"]["saved_min"] == 0
