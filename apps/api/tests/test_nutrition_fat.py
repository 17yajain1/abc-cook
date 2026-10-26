"""Fat lines by method: deep fry vs shallow/plain, the linked-step walk and the amounts (2A)."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from nutrition_helpers import food, line, table

from abc_cook.nutrition.calc import compute_nutrition
from abc_cook.nutrition.fat import (
    FatLinks,
    classify_fat,
    fried_ingredient_ids,
    link_nodes,
)
from abc_cook.nutrition.resolution import LineResolution
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Node
from abc_cook.schema.nutrition import RecipeNutrition

NOW = datetime(2026, 10, 26, tzinfo=UTC)
T = table(
    food("1", "Chicken, raw", group="Poultry Products", veg="non_veg", kcal=200, protein=20),
    food(
        "2",
        "Oil, vegetable",
        group="Fats and Oils",
        kcal=884,
        fat=100,
        portions=[("tbsp", "", 14.0)],
    ),
    food(
        "3",
        "Butter, salted",
        group="Dairy and Egg Products",
        kcal=717,
        fat=81,
        portions=[("tbsp", "", 14.0)],
    ),
    food("4", "Flour, wheat", group="Cereal Grains and Pasta", kcal=360),
    food("5", "Yogurt, plain", group="Dairy and Egg Products", kcal=60),
    food("6", "Potatoes, raw", kcal=77),
)
CHICKEN, OIL, BUTTER, FLOUR, CURD, POTATO = "1", "2", "3", "4", "5", "6"


def node(
    node_id: str,
    consumes: list[str],
    produces: str | None = None,
    instruction: str = "Do the step.",
) -> Node:
    return Node(
        id=node_id,
        stage="cook",
        label="Step",
        instruction=instruction,
        kind="active",
        attention="hands_on",
        duration_min=1,
        duration_typical=1,
        duration_max=1,
        station="burner",
        consumes=consumes,
        produces=produces,
        interruptible=False,
    )


def _run(
    lines: list[Ingredient],
    food_ids: list[str],
    nodes: list[Node] | None = None,
    servings: int = 4,
) -> RecipeNutrition:
    resolutions = [LineResolution(f"fdc:{fid}", "alias") for fid in food_ids]
    return compute_nutrition(
        lines, servings, True, [], resolutions, computed_at=NOW, table=T, nodes=nodes
    )


# --- classification ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("line_text", "steps", "method", "uncertain"),
    [
        # rule 1: deep in the line or a linked step
        ("2 cups oil for deep frying", [], "deep_fry", False),
        ("Set oil for deep-frying", [], "deep_fry", False),
        ("oil for deep fry", [], "deep_fry", False),
        ("oil", ["Heat the oil and deep fry the pooris."], "deep_fry", False),
        # rule 2: shallow words in the line
        ("oil for shallow frying", [], "shallow_or_plain", False),
        ("2 tbsp oil for pan-frying", [], "shallow_or_plain", False),
        ("oil for greasing", [], "shallow_or_plain", False),
        ("oil for roasting", [], "shallow_or_plain", False),
        # rule 3: "for frying", decided by method words first
        ("oil or ghee for frying", ["Cook on each side until golden."], "shallow_or_plain", False),
        ("oil for frying", ["Flip and cook on the tawa."], "shallow_or_plain", False),
        ("oil for frying", ["Slide into the oil."], "deep_fry", False),
        ("oil for frying", ["Fry in batches."], "deep_fry", False),
        ("oil for frying", ["Fry the pakoras in hot oil."], "deep_fry", False),
        ("oil for frying", ["Fry until golden brown in the hot oil."], "deep_fry", False),
        ("oil to fry", ["Fry until golden brown."], "shallow_or_plain", True),  # golden alone
        # both kinds of method word: shallow, uncertain
        (
            "oil for frying",
            ["Drop in hot oil.", "Flip and cook each side."],
            "shallow_or_plain",
            True,
        ),
        # method words beat the vessel
        (
            "oil for frying",
            ["Heat oil in a pan, drop pakoras in batches."],
            "deep_fry",
            False,
        ),
        # vessels only when there is no method word
        ("oil for frying", ["Heat the oil in a kadai."], "deep_fry", False),
        ("oil for frying", ["Heat the oil in a pan."], "shallow_or_plain", False),
        ("oil for frying", ["Heat a pan.", "Use a kadhai."], "shallow_or_plain", True),
        # nothing at all: shallow, uncertain
        ("oil for frying", [], "shallow_or_plain", True),
        # rule 4: everything else
        ("2 tbsp oil", [], "shallow_or_plain", False),
        ("oil as needed", ["Heat the oil, add cumin."], "shallow_or_plain", False),
        ("ghee for tadka", ["Temper the dal."], "shallow_or_plain", False),
    ],
)
def test_classify_fat(line_text: str, steps: list[str], method: str, uncertain: bool) -> None:
    result = classify_fat(line_text, steps)
    assert (result.method, result.uncertain) == (method, uncertain)


def test_a_deep_frying_pan_is_not_a_shallow_vessel() -> None:
    assert classify_fat("oil for frying", ["Heat oil in a deep pan."]).method == "shallow_or_plain"
    # "pan" after "deep" is no vessel, so with no method word either the line is uncertain
    assert classify_fat("oil for frying", ["Heat oil in a deep pan."]).uncertain


def test_a_deep_cue_only_in_a_step_is_recorded_as_such() -> None:
    from_step = classify_fat("2 tbsp oil", ["You can also deep fry these."])
    assert (from_step.method, from_step.deep_cue_from_steps_only) == ("deep_fry", True)
    from_line = classify_fat("oil for deep frying", [])
    assert from_line.deep_cue_from_steps_only is False


# --- the linked-step walk ------------------------------------------------------------------------


def test_walk_stops_at_the_first_node_that_also_consumes_a_non_fat_food() -> None:
    nodes = [
        node("heat", ["ing_oil"], "comp_hot_oil", "Heat the oil."),
        node("fry", ["comp_hot_oil", "comp_coated"], "comp_fried", "Fry the chicken."),
        node("coat", ["ing_chicken", "ing_flour"], "comp_coated"),
        node("sauce", ["comp_fried", "ing_sauce"], "comp_final", "Toss in the sauce."),
    ]
    links = link_nodes("ing_oil", {"ing_oil"}, nodes)
    assert [n.id for n in links.linked] == ["heat", "fry"]
    assert [n.id for n in links.fry_nodes] == ["fry"]


def test_walk_does_not_depend_on_node_order() -> None:
    nodes = [
        node("fry", ["comp_hot_oil", "comp_coated"], "comp_fried"),
        node("coat", ["ing_chicken"], "comp_coated"),
        node("heat", ["ing_oil"], "comp_hot_oil"),
    ]
    links = link_nodes("ing_oil", {"ing_oil"}, nodes)
    assert [n.id for n in links.fry_nodes] == ["fry"]


def test_a_node_using_the_oil_and_food_directly_is_the_fry_node() -> None:
    nodes = [node("cook", ["ing_oil", "ing_cumin"], "comp_base"), node("later", ["comp_base"])]
    links = link_nodes("ing_oil", {"ing_oil"}, nodes)
    assert [n.id for n in links.linked] == ["cook"]
    assert links.fry_nodes == links.linked


def test_a_fat_no_node_uses_has_no_links() -> None:
    assert link_nodes("ing_oil", {"ing_oil"}, [node("x", ["ing_flour"])]) == FatLinks((), ())


def test_fried_ids_follow_components_back_and_skip_the_oil() -> None:
    nodes = [
        node("heat", ["ing_oil"], "comp_hot_oil"),
        node("fry", ["comp_hot_oil", "comp_coated"], "comp_fried"),
        node("coat", ["ing_chicken", "ing_flour", "comp_marinade"], "comp_coated"),
        node("marinate", ["ing_curd"], "comp_marinade"),
    ]
    links = link_nodes("ing_oil", {"ing_oil"}, nodes)
    ids = fried_ingredient_ids(links.fry_nodes, nodes, {"ing_oil"})
    assert sorted(ids) == ["ing_chicken", "ing_curd", "ing_flour"]


# --- amounts, through compute_nutrition ----------------------------------------------------------


def _chicken_65_nodes() -> list[Node]:
    return [
        node("marinate", ["ing_curd"], "comp_marinade"),
        node("coat", ["ing_chicken", "ing_flour", "comp_marinade"], "comp_coated"),
        node("heat", ["ing_oil"], "comp_hot_oil", "Heat oil for frying in a kadai."),
        node(
            "fry",
            ["comp_hot_oil", "comp_coated"],
            "comp_fried",
            "Drop the chicken into the hot oil and fry in batches until golden.",
        ),
        node(
            "sauce",
            ["comp_fried", "ing_sauce"],
            "comp_final",
            "Flip each side on the tawa and toss in the sauce.",
        ),
    ]


def _chicken_65_lines(oil: Ingredient) -> list[Ingredient]:
    return [
        line("chicken", "500", "g", ing_id="ing_chicken"),
        line("flour", "100", "g", ing_id="ing_flour"),
        line("curd", "200", "g", ing_id="ing_curd"),
        oil,
    ]


def test_deep_fry_is_ten_percent_of_the_fried_mass_not_the_stated_amount() -> None:
    oil = line("oil for frying", "2", "cups", ing_id="ing_oil")
    result = _run(_chicken_65_lines(oil), [CHICKEN, FLOUR, CURD, OIL], _chicken_65_nodes())
    row = result.rows[3]
    assert row.fat_method == "deep_fry"
    assert row.fat_rule == "deep_fry_10pct"
    # chicken + flour + curd: not the oil, not the sauce step
    assert row.fried_grams == pytest.approx(800.0)
    assert row.grams == pytest.approx(80.0)
    assert row.grams_basis == "estimated"
    assert {"frying", "absorbed_estimate"} <= set(row.flags)
    assert "default_fat" not in row.flags
    assert "fry_method_uncertain" not in row.flags


def test_the_walk_never_goes_past_the_fry_node_into_the_sauce_step() -> None:
    # the sauce step says "flip each side on the tawa": if it were walked, the line would be
    # read as shallow + uncertain
    oil = line("oil for frying", "2", "cups", ing_id="ing_oil")
    result = _run(_chicken_65_lines(oil), [CHICKEN, FLOUR, CURD, OIL], _chicken_65_nodes())
    assert result.rows[3].fat_method == "deep_fry"


def test_two_fry_nodes_reaching_the_same_food_count_it_once() -> None:
    nodes = [
        node("heat", ["ing_oil"], "comp_hot_oil"),
        node("fry1", ["comp_hot_oil", "ing_chicken"], "comp_b1", "Drop half in the hot oil."),
        node("fry2", ["comp_hot_oil", "ing_chicken"], "comp_b2", "Drop the rest in the hot oil."),
    ]
    lines = [
        line("chicken", "500", "g", ing_id="ing_chicken"),
        line("oil for frying", None, None, ing_id="ing_oil"),
    ]
    result = _run(lines, [CHICKEN, OIL], nodes)
    assert result.rows[1].fried_grams == pytest.approx(500.0)
    assert result.rows[1].grams == pytest.approx(50.0)


def test_a_deep_fry_line_with_no_amount_gets_the_same_estimate() -> None:
    nodes = [node("fry", ["ing_oil", "ing_potato"], None, "Deep fry the potato.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil for deep frying", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert (row.fat_rule, row.grams) == ("deep_fry_10pct", pytest.approx(30.0))


def test_deep_fry_with_no_graph_falls_back_to_one_tbsp_per_serving() -> None:
    lines = [line("potato", "300", "g"), line("oil for deep frying", "2", "cups")]
    row = _run(lines, [POTATO, OIL], None).rows[1]
    assert row.fat_rule == "deep_fry_fallback"
    assert row.grams == pytest.approx(14.0 * 4)
    assert {"frying", "deep_fry_fallback"} <= set(row.flags)
    assert "absorbed_estimate" not in row.flags
    assert row.grams_basis == "estimated"


def test_deep_fry_falls_back_when_the_fried_mass_is_zero() -> None:
    nodes = [node("fry", ["ing_oil", "ing_potato"], None, "Deep fry the potato.")]
    lines = [
        line("potato", None, None, ing_id="ing_potato"),
        line("oil for deep frying", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert row.fat_rule == "deep_fry_fallback"


def test_optional_food_is_not_part_of_the_fried_mass() -> None:
    nodes = [node("fry", ["ing_oil", "ing_potato", "ing_chicken"], None, "Deep fry everything.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("chicken (optional)", "500", "g", ing_id="ing_chicken"),
        line("oil for deep frying", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, CHICKEN, OIL], nodes).rows[2]
    assert row.fried_grams == pytest.approx(300.0)


def test_oil_or_ghee_for_frying_with_each_side_is_shallow_and_gets_half_a_tbsp() -> None:
    nodes = [node("cook", ["ing_oil", "ing_potato"], None, "Cook on each side until golden.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil or ghee for frying", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert (row.fat_method, row.fat_rule) == ("shallow_or_plain", "default_half_tbsp")
    assert row.grams == pytest.approx(0.5 * 14.0 * 4)
    assert {"default_fat", "frying"} <= set(row.flags)
    assert "fry_method_uncertain" not in row.flags


def test_a_deep_cue_only_in_a_step_with_a_small_stated_amount_is_flagged_uncertain() -> None:
    nodes = [node("cook", ["ing_oil", "ing_potato"], None, "Cook in oil. You can also deep fry.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil", "2", "tbsp", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert row.fat_method == "deep_fry"
    assert "fry_method_uncertain" in row.flags
    assert row.grams == pytest.approx(30.0)  # 10% of 300 g, not the stated 2 tbsp


def test_a_deep_cue_only_in_a_step_with_a_large_stated_amount_is_not_flagged() -> None:
    nodes = [node("cook", ["ing_oil", "ing_potato"], None, "Cook in oil. You can also deep fry.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil", "1", "cup", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert row.fat_method == "deep_fry"
    assert "fry_method_uncertain" not in row.flags


def test_method_word_beats_the_vessel_for_oil_for_frying() -> None:
    nodes = [
        node("cook", ["ing_oil", "ing_potato"], None, "Heat oil in a pan, drop pakoras in batches.")
    ]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil for frying", ing_id="ing_oil"),
    ]
    assert _run(lines, [POTATO, OIL], nodes).rows[1].fat_method == "deep_fry"


def test_a_deep_fry_line_never_counts_as_the_stated_fat_beside_a_missing_one() -> None:
    nodes = [node("fry", ["ing_oil", "ing_potato"], None, "Deep fry the potato.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil for deep frying", "2", "cups", ing_id="ing_oil"),
        line("butter", ing_id="ing_butter"),
    ]
    result = _run(lines, [POTATO, OIL, BUTTER], nodes)
    butter = result.rows[2]
    assert butter.fat_rule == "default_half_tbsp"
    assert butter.grams == pytest.approx(0.5 * 14.0 * 4)
    assert "fat_default_beside_stated_fat" not in butter.flags


def test_a_missing_fat_beside_a_stated_fat_takes_one_tsp_per_serving() -> None:
    lines = [line("butter", "2", "tbsp"), line("oil")]
    result = _run(lines, [BUTTER, OIL])
    assert result.rows[1].fat_rule == "default_1tsp_beside_stated"
    assert result.rows[1].grams == pytest.approx(5.0 * (14.0 / 15.0) * 4)


def test_an_optional_fat_with_an_amount_does_not_count_as_the_stated_fat() -> None:
    lines = [line("butter (optional)", "2", "tbsp"), line("oil")]
    result = _run(lines, [BUTTER, OIL])
    assert result.rows[1].fat_rule == "default_half_tbsp"


def test_a_range_midpoint_counts_as_the_stated_fat_beside_a_missing_one() -> None:
    lines = [line("butter", "2-3", "tbsp"), line("oil")]
    result = _run(lines, [BUTTER, OIL])
    assert "range_midpoint" in result.rows[0].flags
    assert result.rows[1].fat_rule == "default_1tsp_beside_stated"


def test_a_tadka_fat_with_an_amount_uses_the_stated_amount() -> None:
    nodes = [node("tadka", ["ing_oil", "ing_potato"], None, "Heat the oil, add cumin, temper.")]
    lines = [
        line("potato", "300", "g", ing_id="ing_potato"),
        line("oil", "2", "tbsp", ing_id="ing_oil"),
    ]
    row = _run(lines, [POTATO, OIL], nodes).rows[1]
    assert (row.fat_method, row.fat_rule) == ("shallow_or_plain", "stated")
    assert row.grams == pytest.approx(28.0)
    assert row.grams_basis == "table"


def test_no_cue_for_frying_is_shallow_and_flagged_uncertain() -> None:
    row = _run([line("oil for frying")], [OIL]).rows[0]
    assert (row.fat_method, row.fat_rule) == ("shallow_or_plain", "default_half_tbsp")
    assert {"frying", "fry_method_uncertain", "default_fat"} <= set(row.flags)


def test_a_non_fat_line_has_no_fat_fields() -> None:
    row = _run([line("potato", "300", "g")], [POTATO]).rows[0]
    assert (row.fat_method, row.fat_rule, row.fried_grams) == (None, None, None)
