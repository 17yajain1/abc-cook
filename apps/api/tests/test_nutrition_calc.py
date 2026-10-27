"""`compute_nutrition`: totals, defaults, fat flags, exclusions and every confidence branch."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from nutrition_helpers import food, line, table

from abc_cook.extract.graph import SERVINGS_DEFAULTED_WARNING
from abc_cook.nutrition.calc import compute_nutrition, servings_basis_source, servings_from_yield
from abc_cook.nutrition.resolution import FoodSource, LineResolution
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.nutrition import RecipeNutrition

NOW = datetime(2026, 10, 26, tzinfo=UTC)
T = table(
    food(
        "1",
        "Rice, white, raw",
        group="Cereal Grains and Pasta",
        kcal=360,
        protein=7,
        carbs=79,
        fat=0.6,
    ),
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
        portions=[("tbsp", "", 14.2)],
    ),
    food(
        "4", "Chicken, raw", group="Poultry Products", veg="non_veg", kcal=200, protein=20, fat=12
    ),
    food("5", "Salt, table", group="Spices and Herbs", kcal=0),
    food("6", "Sugars, granulated", group="Sweets", veg="unknown", kcal=387, carbs=100),
    food("7", "Onions, raw", kcal=40, portions=[("medium", "", 110.0)]),
    food("8", "Pepper, black", group="Spices and Herbs", kcal=251, carbs=64),
    food("9", "Nuts, cashew nuts, raw", group="Nut and Seed Products", kcal=553, fat=44),
    food("10", "Cream, fluid, heavy whipping", group="Dairy and Egg Products", kcal=340, fat=36),
)


def _run(
    lines: list[Ingredient],
    food_ids: list[str | None],
    *,
    servings: int = 4,
    stated: bool = True,
    warnings: list[str] | None = None,
    llm_grams: dict[int, float] | None = None,
    reviewed: bool = True,
    source: FoodSource = "alias",
    yield_text: str | None = None,
) -> RecipeNutrition:
    # v3: the guard demotes `calculated` for an unreviewed pick, so these helpers default to
    # reviewed aliases; the guard tests pass reviewed=False or another source.
    resolutions = [
        LineResolution(
            f"fdc:{fid}" if fid else None,
            source if fid else None,
            (llm_grams or {}).get(i),
            None,
            reviewed,
        )
        for i, fid in enumerate(food_ids)
    ]
    return compute_nutrition(
        lines,
        servings,
        stated,
        warnings or [],
        resolutions,
        computed_at=NOW,
        table=T,
        yield_text=yield_text,
    )


def test_per_serving_is_total_over_servings() -> None:
    result = _run([line("rice", "200", "g"), line("oil", "2", "tbsp")], ["1", "2"], servings=2)
    rice_kcal = 200 * 3.6
    oil_kcal = 28 * 8.84
    assert result.total.kcal == pytest.approx(rice_kcal + oil_kcal)
    assert result.per_serving.kcal == pytest.approx((rice_kcal + oil_kcal) / 2)
    assert result.servings_basis == 2
    assert result.total.carbs_g == pytest.approx(200 * 0.79)
    assert result.rows[0].grams_basis == "stated"
    assert result.rows[1].grams_basis == "table"
    assert result.sources


def test_missing_oil_defaults_to_half_a_tbsp_per_serving_and_is_estimated() -> None:
    # v1 took a flat 1 tbsp per serving; v2 (NUTRITION_VERSION 2) takes half a tbsp, and a
    # "for frying" line with no method cue at all is also flagged uncertain.
    result = _run([line("oil for frying")], ["2"], servings=4)
    row = result.rows[0]
    assert row.grams == pytest.approx(4 * 0.5 * 14.0)
    assert row.grams_basis == "estimated"
    assert "default_fat" in row.flags
    assert "frying" in row.flags
    assert "fry_method_uncertain" in row.flags
    assert "fat_default_beside_stated_fat" not in row.flags
    assert (row.fat_method, row.fat_rule) == ("shallow_or_plain", "default_half_tbsp")
    assert result.per_serving.kcal == pytest.approx(0.5 * 14.0 * 8.84)


def test_default_fat_beside_a_stated_fat_is_flagged() -> None:
    result = _run([line("butter", "2", "tbsp"), line("oil")], ["3", "2"])
    oil = result.rows[1]
    assert "default_fat" in oil.flags
    assert "fat_default_beside_stated_fat" in oil.flags
    assert "default_fat" not in result.rows[0].flags
    assert oil.fat_rule == "default_1tsp_beside_stated"
    assert oil.grams == pytest.approx(5.0 * (14.0 / 15.0) * 4)  # 1 tsp per serving, 4 servings
    assert result.rows[0].fat_rule == "stated"


def test_other_missing_amounts_are_zero_grams_and_missing() -> None:
    result = _run([line("onion")], ["7"])
    # a bare "onion" has no number at all
    assert result.rows[0].grams is None
    assert result.rows[0].grams_basis == "missing"
    assert result.total.kcal == 0


def test_salt_to_taste_is_zero_kcal_and_left_out_of_confidence() -> None:
    lines = [line("rice", "300", "g"), line("salt", "to taste")]
    result = _run(lines, ["1", "5"])
    salt = result.rows[1]
    assert salt.excluded_reason == "to_taste"
    assert salt.nutrients is None
    assert result.confidence == "calculated"
    peppery = _run([line("rice", "300", "g"), line("black pepper", "to taste")], ["1", "8"])
    assert peppery.rows[1].excluded_reason == "to_taste"
    assert peppery.total.kcal == pytest.approx(300 * 3.6)
    # bell pepper is a vegetable, not seasoning
    veg = _run([line("red pepper", "to taste")], ["8"])
    assert veg.rows[0].excluded_reason is None


def test_optional_lines_are_excluded_and_counted() -> None:
    lines = [line("rice", "100", "g"), line("cashews (optional)", "20", "g")]
    result = _run(lines, ["1", "9"])
    assert result.rows[1].excluded_reason == "optional"
    assert result.rows[1].nutrients is None
    assert result.total.kcal == pytest.approx(360)
    assert sum(1 for r in result.rows if r.excluded_reason == "optional") == 1


def test_llm_grams_are_used_only_when_the_resolver_cannot_convert() -> None:
    lines = [line("curry leaves", "2", "sprigs"), line("rice", "100", "g")]
    result = _run(lines, ["7", "1"], llm_grams={0: 8.0, 1: 999.0})
    assert result.rows[0].grams == 8.0
    assert result.rows[0].grams_basis == "estimated"
    assert result.rows[1].grams == 100.0  # converted deterministically; the estimate is ignored
    assert result.rows[1].grams_basis == "stated"


def test_unmatched_line_has_no_kcal_and_basis_unmatched() -> None:
    result = _run([line("garam masala", "1", "tsp"), line("rice", "100", "g")], [None, "1"])
    assert result.rows[0].grams_basis == "unmatched"
    assert result.rows[0].food is None
    assert result.rows[0].nutrients is None


# --- confidence -----------------------------------------------------------------------------


def test_calculated_when_stated_and_table_lines_carry_the_calories() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium"), line("oil", "1", "tbsp")]
    result = _run(lines, ["1", "7", "2"])
    assert result.confidence == "calculated"
    assert result.servings_basis_source == "stated"


def test_assumed_servings_cap_calculated_at_estimated() -> None:
    lines = [line("rice", "300", "g"), line("oil", "1", "tbsp")]
    assert _run(lines, ["1", "2"], stated=False).confidence == "estimated"
    assert _run(lines, ["1", "2"], stated=False).servings_basis_source == "assumed"
    legacy = _run(lines, ["1", "2"], warnings=[SERVINGS_DEFAULTED_WARNING])
    assert legacy.confidence == "estimated"
    assert legacy.servings_basis_source == "assumed"


def test_estimated_when_a_top_line_is_defaulted_but_not_over_the_rough_limit() -> None:
    lines = [line("rice", "1000", "g"), line("oil")]
    result = _run(lines, ["1", "2"], servings=2)
    # default oil: 2 tbsp = 28 g = 247 kcal of 3847: well under 25%
    assert result.confidence == "estimated"


def test_rough_when_over_a_quarter_of_the_calories_are_estimated() -> None:
    result = _run([line("rice", "100", "g"), line("oil")], ["1", "2"], servings=4)
    # default oil 56 g = 495 kcal vs rice 360: more than 25% estimated
    assert result.confidence == "rough"


def test_rough_when_a_meat_line_has_no_amount() -> None:
    result = _run([line("rice", "300", "g"), line("chicken")], ["1", "4"])
    assert result.confidence == "rough"


@pytest.mark.parametrize(
    ("name", "food_id"),
    [("cashews", "9"), ("heavy cream", "10"), ("sugar", "6")],
)
def test_rough_when_a_nuts_cream_or_sugar_line_has_no_amount(name: str, food_id: str) -> None:
    assert _run([line("rice", "300", "g"), line(name)], ["1", food_id]).confidence == "rough"


def test_rough_when_a_high_impact_line_is_unmatched() -> None:
    assert (
        _run([line("rice", "300", "g"), line("ghee", "2", "tbsp")], ["1", None]).confidence
        == "rough"
    )
    assert (
        _run([line("rice", "300", "g"), line("mutton", "500", "g")], ["1", None]).confidence
        == "rough"
    )


def test_the_v2_label_is_rough_when_over_a_fifth_of_the_lines_are_unmatched() -> None:
    # v3: the official label measures unmatched in grams (this is `confidence_v2` now)
    lines = [
        line("rice", "300", "g"),
        line("a", "1", "tsp"),
        line("b", "1", "tsp"),
        line("c", "1", "tsp"),
    ]
    # 1 of 4 unmatched is 25%
    assert _run(lines, ["1", "7", "7", None]).confidence_v2 == "rough"
    # 1 of 6 is 17%: not rough on this rule
    six = [*lines, line("d", "1", "tsp"), line("e", "1", "tsp")]
    assert _run(six, ["1", "7", "7", None, "7", "7"]).confidence_v2 != "rough"


def test_a_recipe_with_no_calories_is_never_calculated() -> None:
    assert _run([line("salt", "1", "tsp")], ["5"]).confidence == "estimated"


def test_top_five_lines_must_not_be_estimated_for_calculated() -> None:
    lines = [
        line("rice", "1000", "g"),
        line("onion", "2", "medium"),
        line("oil", "2", "tbsp"),
        line("cashews", "1-2", "tbsp"),
    ]
    result = _run(lines, ["1", "7", "2", "9"])
    assert result.rows[3].grams_basis == "estimated"
    assert result.confidence != "calculated"


def test_a_default_density_top_line_is_not_calculated() -> None:
    # B3.6: food 9 has no cup portion, so "1 cup" runs at 1.0 g/ml and is a guess
    lines = [line("rice", "1000", "g"), line("cashews", "1", "cup")]
    result = _run(lines, ["1", "9"])
    assert result.rows[1].grams_basis == "estimated"
    assert "default_density" in result.rows[1].flags
    assert result.confidence != "calculated"


def test_drivers_are_the_top_three_lines_by_kcal() -> None:
    lines = [
        line("rice", "300", "g"),
        line("oil", "2", "tbsp"),
        line("butter", "1", "tbsp"),
        line("onion", "1", "medium"),
    ]
    result = _run(lines, ["1", "2", "3", "7"])
    assert [d.ingredient_id for d in result.drivers] == [
        lines[0].id,
        lines[1].id,
        lines[2].id,
    ]
    assert result.drivers[0].text.endswith("kcal")


def test_servings_basis_source_helper() -> None:
    assert servings_basis_source(True, []) == "stated"
    assert servings_basis_source(False, []) == "assumed"
    assert servings_basis_source(True, [SERVINGS_DEFAULTED_WARNING]) == "assumed"


def test_diet_is_derived_and_records_the_foods_version() -> None:
    result = _run([line("rice", "100", "g"), line("chicken", "100", "g")], ["1", "4"])
    assert result.diet == "non_veg"
    assert result.diet_foods_version == "test-1"


# --- v2: optional extras, whole-recipe totals; v3: the official label is the old shadow --------


def test_optional_extras_are_reported_per_serving_and_not_counted() -> None:
    lines = [line("rice", "100", "g"), line("cashews (optional)", "40", "g")]
    result = _run(lines, ["1", "9"], servings=2)
    assert result.total.kcal == pytest.approx(360)  # unchanged: the optional line is out
    assert result.rows[1].est_kcal == 0
    assert result.optional_extras_kcal_per_serving == pytest.approx(40 * 5.53 / 2)
    assert result.optional_extras_unmatched == []


def test_optional_extras_use_the_same_defaults_as_counted_lines() -> None:
    lines = [line("rice", "100", "g"), line("ghee (optional)")]
    result = _run(lines, ["1", "3"], servings=2)
    # butter, no amount: half a tbsp per serving (14.2 g/tbsp), 717 kcal/100 g
    assert result.optional_extras_kcal_per_serving == pytest.approx(0.5 * 14.2 * 2 * 7.17 / 2)
    assert result.rows[1].fat_rule == "default_half_tbsp"
    assert result.total.kcal == pytest.approx(360)


def test_optional_extras_are_none_without_optional_lines_or_when_none_compute() -> None:
    assert _run([line("rice", "100", "g")], ["1"]).optional_extras_kcal_per_serving is None
    only_unmatched = _run(
        [line("rice", "100", "g"), line("mystery (optional)", "1", "tsp")], ["1", None]
    )
    assert only_unmatched.optional_extras_kcal_per_serving is None
    assert only_unmatched.optional_extras_unmatched == ["1 tsp mystery (optional)"]


def test_a_partial_extras_sum_lists_what_it_left_out() -> None:
    lines = [
        line("rice", "100", "g"),
        line("cashews (optional)", "40", "g"),
        line("mystery (optional)", "1", "tsp"),
    ]
    result = _run(lines, ["1", "9", None])
    assert result.optional_extras_kcal_per_serving == pytest.approx(40 * 5.53 / 4)  # 4 servings
    assert result.optional_extras_unmatched == ["1 tsp mystery (optional)"]


def test_total_is_the_whole_recipe_and_per_serving_times_servings_basis() -> None:
    result = _run([line("rice", "300", "g"), line("onion", "2", "medium")], ["1", "7"], servings=3)
    for name in ("kcal", "protein_g", "carbs_g", "fat_g", "fibre_g"):
        assert getattr(result.total, name) == pytest.approx(
            getattr(result.per_serving, name) * result.servings_basis
        )
    assert result.total.kcal == pytest.approx(300 * 3.6 + 220 * 0.4)


def test_the_official_label_and_the_v2_label_are_both_reported() -> None:
    result = _run([line("rice", "300", "g"), line("onion", "2", "medium")], ["1", "7"])
    assert result.confidence == "calculated"
    assert result.confidence_v2 == "calculated"
    assert result.guard_demoted is False


def test_a_range_midpoint_does_not_make_a_recipe_rough_under_the_official_label() -> None:
    # rice 100 g = 360 kcal; cashews "20-30 g" is a range midpoint (estimated): well over 25%
    # of the calories but not a defaulted amount
    lines = [line("rice", "100", "g"), line("cashews", "20-30", "g")]
    result = _run(lines, ["1", "9"])
    cashew_share = (25 * 5.53) / (360 + 25 * 5.53)
    assert cashew_share > 0.25
    assert result.confidence_v2 == "rough"
    assert result.confidence != "rough"


def test_the_estimated_limit_is_35_percent_and_a_default_still_counts() -> None:
    # a defaulted oil amount is not a range midpoint, so it still counts as estimated
    rough = _run([line("rice", "100", "g"), line("oil")], ["1", "2"], servings=4)
    assert rough.confidence_v2 == "rough"
    assert rough.confidence == "rough"  # 247 of 607 kcal = 41% > 35%
    ok = _run([line("rice", "150", "g"), line("oil")], ["1", "2"], servings=4)
    # 247 of 787 kcal = 31%: over the v2 25%, under the official 35%
    assert ok.confidence_v2 == "rough"
    assert ok.confidence == "estimated"


def test_the_unmatched_rule_is_by_grams_not_lines() -> None:
    # 1 of 4 lines unmatched (25% of lines) but 1 tsp is 5 g of 305 g
    lines = [
        line("rice", "300", "g"),
        line("a", "1", "tsp"),
        line("b", "1", "tsp"),
        line("c", "1", "tsp"),
    ]
    result = _run(lines, ["1", "7", "7", None])
    assert result.confidence_v2 == "rough"
    assert result.confidence != "rough"
    # a big unmatched line is rough under both
    big = _run([line("rice", "100", "g"), line("c", "400", "g")], ["1", None])
    assert big.confidence == "rough"


def test_count_only_unmatched_lines_have_no_grams_and_do_not_move_the_share() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium"), line("garam masala", "2")]
    result = _run(lines, ["1", "7", None])
    assert result.rows[2].grams is None
    assert result.confidence != "rough"


def test_the_official_label_keeps_the_assumed_servings_cap() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    assert _run(lines, ["1", "7"], stated=False).confidence == "estimated"


def test_the_official_label_keeps_the_high_impact_rules() -> None:
    assert _run([line("rice", "300", "g"), line("chicken")], ["1", "4"]).confidence == "rough"


# --- v3: the unreviewed-pick guard, servings from yield text ----------------------------------


def test_the_guard_demotes_calculated_when_a_top_line_is_an_unreviewed_alias() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    result = _run(lines, ["1", "7"], reviewed=False)
    assert result.confidence == "estimated"
    assert result.guard_demoted is True
    assert result.confidence_v2 == "calculated"  # the v2 label is kept for comparison
    assert [r.food_reviewed for r in result.rows] == [False, False]


@pytest.mark.parametrize("source", ["cache", "llm"])
def test_the_guard_demotes_calculated_for_an_unreviewed_cache_or_model_pick(
    source: FoodSource,
) -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    result = _run(lines, ["1", "7"], reviewed=False, source=source)
    assert result.confidence == "estimated"
    assert result.guard_demoted is True
    assert result.rows[0].food_source == source


def test_an_exact_name_match_is_not_a_pick_and_a_reviewed_pick_passes_the_guard() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    assert _run(lines, ["1", "7"], reviewed=False, source="exact").confidence == "calculated"
    assert _run(lines, ["1", "7"], reviewed=True, source="llm").confidence == "calculated"


def test_the_guard_only_looks_at_the_top_five_lines_by_kcal() -> None:
    reviewed = LineResolution("fdc:7", "alias", None, None, True)
    unreviewed_salt = LineResolution("fdc:5", "alias", None, None, False)  # 0 kcal
    rice = LineResolution("fdc:1", "alias", None, None, True)
    # three lines: the unreviewed 0-kcal salt is inside the top five
    three = [line("rice", "300", "g"), line("onion", "1", "medium"), line("salt", "1", "pinch")]
    result = compute_nutrition(
        three, 4, True, [], [rice, reviewed, unreviewed_salt], computed_at=NOW, table=T
    )
    assert result.guard_demoted is True
    # six lines: the same salt is the sixth by kcal, so it is not checked
    six = [line("rice", "300", "g"), *(line(f"onion {i}", "1", "medium") for i in range(4))]
    six.append(line("salt", "1", "pinch"))
    result6 = compute_nutrition(
        six, 4, True, [], [rice, *([reviewed] * 4), unreviewed_salt], computed_at=NOW, table=T
    )
    assert result6.guard_demoted is False
    assert result6.confidence == "calculated"


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("2", (2, None)),
        ("Serves 4", (4, None)),
        ("2 to 3", (2, None)),
        ("2 to 3 people", (2, None)),
        ("4 - 5 people", (4, None)),
        ("4 to 5", (4, None)),
        ("Serves 4-6 (generously)", (4, None)),
        ("18 pieces", (None, 18)),
        ("Makes 12-13 cookies.", (None, 12)),
        ("12 Moong Dal Chilla", (None, 12)),
        ("250 g", (None, None)),
        ("a big pot", (None, None)),
        ("", (None, None)),
        (None, (None, None)),
    ],
)
def test_servings_from_yield(text: str | None, expected: tuple[int | None, int | None]) -> None:
    assert servings_from_yield(text) == expected


def test_yield_text_gives_servings_when_they_would_be_assumed_and_is_not_capped() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    result = _run(lines, ["1", "7"], stated=False, yield_text="2")
    assert (result.servings_basis, result.servings_basis_source) == (2, "yield_text")
    assert result.confidence == "calculated"  # an assumed 4 would cap this at estimated
    assert result.per_serving.kcal == pytest.approx(result.total.kcal / 2)


def test_a_piece_yield_keeps_the_servings_assumed_and_records_the_count() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    result = _run(lines, ["1", "7"], stated=False, yield_text="12 chillas")
    assert (result.servings_basis, result.servings_basis_source) == (4, "assumed")
    assert result.yield_pieces == 12
    assert result.confidence == "estimated"


def test_stated_servings_ignore_the_yield_text() -> None:
    lines = [line("rice", "300", "g"), line("onion", "2", "medium")]
    result = _run(lines, ["1", "7"], servings=3, stated=True, yield_text="12 chillas")
    assert (result.servings_basis, result.servings_basis_source) == (3, "stated")
    assert result.yield_pieces is None
