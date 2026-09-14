"""extract/validate.py against docs/COOKING_GRAPH.md §5.

Two kinds of test: a minimal graph that breaks exactly one invariant (per rule), and a
free regression check that every golden fixture — hand-authored, never touched by this
milestone — still passes unchanged. If a golden fails here, the invariant
implementation is wrong, not the golden (docs/M2.9-youtube-import-design.md §8.1).
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.validate import validate
from abc_cook.schema import CookingGraph, Ingredient, Node, SourceRef, Stage

FIXTURES_DIR = Path(__file__).parent / "fixtures"

GOLDEN_SLUGS = [
    "chicken-biryani",
    "homemade-donuts",
    "kadai-paneer",
    "maggi-2min",
    "strawberry-shortcake",
    "synthetic-two-windows",
]


def _base_graph() -> CookingGraph:
    """A minimal, fully valid two-node graph: chop an onion, then serve.

    serial_min (3 + 1 = 4) intentionally matches stated_total_min (4) so invariant 8
    starts satisfied; tests that need to isolate a different invariant clear it.
    """
    return CookingGraph(
        id="g_test",
        title="Test Recipe",
        servings=2,
        cuisine=None,
        source=SourceRef(kind="text", value="test", imported_at=datetime.now(UTC)),
        ingredients=[
            Ingredient(
                id="ing_onion", name="Onion", qty=1, unit="medium", prep_note=None, group=None
            ),
        ],
        stages=[
            Stage(id="prep", label="Prep", color_key="prep"),
            Stage(id="finish", label="Finish", color_key="finish"),
        ],
        nodes=[
            Node(
                id="chop_onion",
                stage="prep",
                label="Chop onion",
                instruction="Chop the onion.",
                kind="prep",
                attention="hands_on",
                duration_min=2,
                duration_typical=3,
                duration_max=5,
                station="counter",
                consumes=["ing_onion"],
                produces="comp_onion",
                interruptible=True,
            ),
            Node(
                id="serve",
                stage="finish",
                label="Serve",
                instruction="Serve.",
                kind="finish",
                attention="hands_on",
                duration_min=1,
                duration_typical=1,
                duration_max=2,
                station="none",
                depends_on=["chop_onion"],
                consumes=["comp_onion"],
                interruptible=False,
            ),
        ],
        stated_total_min=4,
    )


def _base_dict() -> dict[str, Any]:
    """The base graph as a plain dict, for targeted mutation in each test."""
    data: dict[str, Any] = json.loads(_base_graph().model_dump_json())
    return data


def test_base_graph_is_valid() -> None:
    assert validate(_base_graph()) == []


def test_depends_on_exist_violation() -> None:
    """Retargeting the only edge to a missing node also orphans chop_onion and
    strands the sink — this rule cannot be isolated from single_finish_sink/no_orphans
    in a two-node graph, so check it fires rather than that it fires alone."""
    data = _base_dict()
    data["nodes"][1]["depends_on"] = ["missing_node"]
    violations = validate(CookingGraph.model_validate(data))
    assert "depends_on_exists" in {v.rule for v in violations}


def test_acyclic_violation() -> None:
    data = _base_dict()
    data["nodes"][0]["depends_on"] = ["serve"]  # chop_onion <-> serve
    violations = validate(CookingGraph.model_validate(data))
    assert "acyclic" in {v.rule for v in violations}


def test_single_finish_sink_wrong_kind() -> None:
    data = _base_dict()
    data["nodes"][1]["kind"] = "active"  # sole sink, but not "finish"
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"single_finish_sink"}


def test_single_finish_sink_multiple_sinks() -> None:
    data = _base_dict()
    data["nodes"].append(
        {
            "id": "extra_sink",
            "stage": "finish",
            "label": "Extra",
            "instruction": "An unconnected extra step.",
            "kind": "finish",
            "attention": "hands_on",
            "duration_min": 1,
            "duration_typical": 1,
            "duration_max": 2,
            "station": "none",
            "depends_on": [],
            "consumes": [],
            "produces": None,
            "interruptible": False,
            "max_lead_min": None,
            "doneness_cue": None,
            "tip": None,
        }
    )
    violations = validate(CookingGraph.model_validate(data))
    assert "single_finish_sink" in {v.rule for v in violations}


def test_disconnected_node_is_caught_as_an_extra_sink() -> None:
    """A fully disconnected node has no dependents, so it's structurally a second
    sink too -- single_finish_sink catches it before no_orphans's reach-sink check
    even runs (that check only applies when exactly one sink exists)."""
    data = _base_dict()
    data["nodes"].append(
        {
            "id": "orphan",
            "stage": "finish",
            "label": "Orphan",
            "instruction": "Disconnected from the flow entirely.",
            "kind": "prep",
            "attention": "hands_on",
            "duration_min": 1,
            "duration_typical": 1,
            "duration_max": 2,
            "station": "none",
            "depends_on": [],
            "consumes": [],
            "produces": None,
            "interruptible": True,
            "max_lead_min": None,
            "doneness_cue": None,
            "tip": None,
        }
    )
    violations = validate(CookingGraph.model_validate(data))
    assert "single_finish_sink" in {v.rule for v in violations}


def test_no_orphans_violation_via_disconnected_cycle() -> None:
    """A 2-node cycle, disconnected from the main chain, has no zero-dependents node
    (each depends on the other) so it doesn't register as an extra sink -- it's
    unreachable from any source, isolating no_orphans (alongside acyclic, since a
    disconnected cycle is definitionally cyclic)."""
    data = _base_dict()
    data["stated_total_min"] = None
    for node_id, dep in (("extra_a", "extra_b"), ("extra_b", "extra_a")):
        data["nodes"].append(
            {
                "id": node_id,
                "stage": "prep",
                "label": node_id,
                "instruction": "Unreachable side component.",
                "kind": "prep",
                "attention": "hands_on",
                "duration_min": 1,
                "duration_typical": 1,
                "duration_max": 2,
                "station": "none",
                "depends_on": [dep],
                "consumes": [],
                "produces": None,
                "interruptible": True,
                "max_lead_min": None,
                "doneness_cue": None,
                "tip": None,
            }
        )
    violations = validate(CookingGraph.model_validate(data))
    rules = {v.rule for v in violations}
    assert "no_orphans" in rules
    assert "acyclic" in rules
    assert "single_finish_sink" not in rules


def test_ingredients_consumed_violation() -> None:
    data = _base_dict()
    data["ingredients"].append(
        {
            "id": "ing_unused",
            "name": "Coriander",
            "qty": 1,
            "unit": "bunch",
            "prep_note": None,
            "group": None,
            "optional": False,
        }
    )
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"ingredients_consumed"}


def test_optional_ingredient_need_not_be_consumed() -> None:
    data = _base_dict()
    data["ingredients"].append(
        {
            "id": "ing_optional",
            "name": "Coriander",
            "qty": 1,
            "unit": "bunch",
            "prep_note": None,
            "group": None,
            "optional": True,
        }
    )
    violations = validate(CookingGraph.model_validate(data))
    assert violations == []


def test_produces_consumed_violation() -> None:
    data = _base_dict()
    data["nodes"][0]["produces"] = "comp_unused"  # nothing consumes this id anymore
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"produces_consumed"}


def test_produces_consumed_requires_downstream_consumer() -> None:
    """A node that consumes comp_onion but isn't downstream of chop_onion doesn't
    satisfy invariant 6 -- "consumed by >= 1 node" is not enough, it must be a
    downstream one. serve is rewired to consume a different component so it no
    longer accidentally satisfies the check on chop_onion's behalf."""
    data = _base_dict()
    data["stated_total_min"] = None
    data["nodes"][1]["consumes"] = ["comp_other"]  # no longer consumes comp_onion
    data["nodes"].append(
        {
            "id": "unrelated_consumer",
            "stage": "prep",
            "label": "Unrelated consumer",
            "instruction": "Uses comp_onion without depending on chop_onion.",
            "kind": "prep",
            "attention": "hands_on",
            "duration_min": 1,
            "duration_typical": 1,
            "duration_max": 2,
            "station": "counter",
            "depends_on": [],
            "consumes": ["comp_onion"],
            "produces": "comp_other",
            "interruptible": True,
            "max_lead_min": None,
            "doneness_cue": None,
            "tip": None,
        }
    )
    data["nodes"][1]["depends_on"] = ["chop_onion", "unrelated_consumer"]
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"produces_consumed"}


def test_duration_ordering_violation() -> None:
    data = _base_dict()
    data["stated_total_min"] = None  # avoid also tripping invariant 8
    data["nodes"][1]["duration_typical"] = 10  # now > duration_max (2)
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"duration_ordering"}


def test_duration_non_positive_violation() -> None:
    data = _base_dict()
    data["stated_total_min"] = None
    data["nodes"][0]["duration_min"] = 0
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"duration_ordering"}


def test_stated_total_violation() -> None:
    data = _base_dict()
    data["stated_total_min"] = 100  # serial is 4; drift is way past 40%
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"stated_total_min"}


def test_unattended_kind_violation() -> None:
    data = _base_dict()
    data["nodes"][0]["attention"] = "unattended"
    data["nodes"][0]["kind"] = "active"  # not passive/prep
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"unattended_kind"}


def test_unattended_prep_kind_is_fine() -> None:
    data = _base_dict()
    data["nodes"][0]["attention"] = "unattended"  # kind stays "prep" -- allowed
    violations = validate(CookingGraph.model_validate(data))
    assert violations == []


def test_stage_refs_violation() -> None:
    data = _base_dict()
    data["nodes"][0]["stage"] = "nonexistent_stage"
    violations = validate(CookingGraph.model_validate(data))
    assert {v.rule for v in violations} == {"stage_refs"}


@pytest.mark.parametrize("slug", GOLDEN_SLUGS)
def test_golden_fixtures_pass_validation(slug: str) -> None:
    """Every hand-authored golden graph must already satisfy every §5 invariant."""
    data = json.loads((FIXTURES_DIR / f"{slug}.graph.json").read_text(encoding="utf-8"))
    graph = CookingGraph.model_validate(data)
    violations = validate(graph)
    assert violations == [], f"{slug}: {violations}"
