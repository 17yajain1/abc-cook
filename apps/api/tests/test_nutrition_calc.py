"""`compute_nutrition`: totals, defaults, fat flags, exclusions and every confidence branch."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from nutrition_helpers import food, line, table

from abc_cook.extract.graph import SERVINGS_DEFAULTED_WARNING
from abc_cook.nutrition.calc import compute_nutrition, servings_basis_source
from abc_cook.nutrition.resolution import LineResolution
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
) -> RecipeNutrition:
    resolutions = [
        LineResolution(
            f"fdc:{fid}" if fid else None, "alias" if fid else None, (llm_grams or {}).get(i)
        )
        for i, fid in enumerate(food_ids)
    ]
    return compute_nutrition(
        lines, servings, stated, warnings or [], resolutions, computed_at=NOW, table=T
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


def test_missing_oil_defaults_to_one_tbsp_per_serving_and_is_estimated() -> None:
    result = _run([line("oil for frying")], ["2"], servings=4)
    row = result.rows[0]
    assert row.grams == pytest.approx(4 * 14.0)
    assert row.grams_basis == "estimated"
    assert "default_fat" in row.flags
    assert "frying" in row.flags
    assert "fat_default_beside_stated_fat" not in row.flags
    assert result.per_serving.kcal == pytest.approx(14.0 * 8.84)


def test_default_fat_beside_a_stated_fat_is_flagged() -> None:
    result = _run([line("butter", "2", "tbsp"), line("oil")], ["3", "2"])
    oil = result.rows[1]
    assert "default_fat" in oil.flags
    assert "fat_default_beside_stated_fat" in oil.flags
    assert "default_fat" not in result.rows[0].flags


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


def test_rough_when_over_a_fifth_of_the_lines_are_unmatched() -> None:
    lines = [
        line("rice", "300", "g"),
        line("a", "1", "tsp"),
        line("b", "1", "tsp"),
        line("c", "1", "tsp"),
    ]
    # 1 of 4 unmatched is 25%
    assert _run(lines, ["1", "7", "7", None]).confidence == "rough"
    # 1 of 6 is 17%: not rough on this rule
    six = [*lines, line("d", "1", "tsp"), line("e", "1", "tsp")]
    assert _run(six, ["1", "7", "7", None, "7", "7"]).confidence != "rough"


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
