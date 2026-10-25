"""Gram resolution: metric, hints (Amendment 2), the spoon/cup table, FDC portions, ranges."""

from __future__ import annotations

import pytest
from nutrition_helpers import food, line, table

from abc_cook.nutrition.foods import Food
from abc_cook.nutrition.grams import (
    PINCH_GRAMS,
    density,
    line_grams,
    parse_amount,
)

T = table(
    food("1", "Plain", kcal=100),
    food(
        "2",
        "Onions, raw",
        portions=[("medium", "", 110.0), ("small", "", 70.0), ("large", "", 150.0)],
    ),
    food("3", "Oil, olive", group="Fats and Oils", kcal=884, portions=[("tbsp", "", 13.5)]),
    food(
        "4",
        "Flour",
        portions=[
            ("cup", "sifted", 110.0),
            ("cup", "", 125.0),
            ("cup", "chopped", 90.0),
            ("tbsp", "", 8.0),
        ],
    ),
    food("5", "Garlic, raw", portions=[("clove", "", 3.0)]),
    food("6", "Eggs", portions=[("large", "", 50.0), ("medium", "", 44.0)]),
)


def _food(food_id: str) -> Food:
    found = T.get(f"fdc:{food_id}")
    assert found is not None
    return found


def test_parse_amount_forms() -> None:
    assert parse_amount("½ cup", None)[0].value == 0.5  # type: ignore[union-attr]
    assert parse_amount("1½ teaspoons", None)[0].value == 1.5  # type: ignore[union-attr]
    assert parse_amount("1/4th cup", None)[0].value == 0.25  # type: ignore[union-attr]
    plus, _ = parse_amount("1 + ½ cup (300 ml)", None)
    assert plus is not None
    assert plus.value == 1.5
    assert "cup" in plus.rest
    same_unit, _ = parse_amount("1 tbsp + 1 tbsp", None)
    assert same_unit is not None
    assert same_unit.value == 2.0
    assert same_unit.rest.strip() == "tbsp"
    quarter, _ = parse_amount("1 tsp + ¼ tsp", None)
    assert quarter is not None
    assert quarter.value == 1.25
    assert parse_amount("1 tbsp + 1 cup", None) == (None, True)
    ranged, _ = parse_amount("2 to 3 tbsp", None)
    assert ranged is not None
    assert (ranged.value, ranged.high) == (2.5, 3.0)
    pinch, _ = parse_amount("a pinch", None)
    assert pinch is not None
    assert pinch.value == 1.0


def test_parse_amount_garbled_text_is_flagged_not_guessed() -> None:
    assert parse_amount("30 \t39 40g / 2 \t3 3 tbsp", None) == (None, True)
    assert parse_amount("to taste", None) == (None, False)
    assert parse_amount(None, None) == (None, False)


@pytest.mark.parametrize(
    ("qty", "unit", "expected"),
    [
        ("150", "grams", 150.0),
        ("150g (5oz)", None, 150.0),
        ("½ kg (1.1 lbs.)", None, 500.0),
        ("1 lb or 450 gms", None, 453.592),
        ("8", "oz", 226.796),
    ],
)
def test_metric_arithmetic_is_stated(qty: str, unit: str | None, expected: float) -> None:
    result = line_grams(line("x", qty, unit), _food("1"))
    assert result.basis == "stated"
    assert result.grams == pytest.approx(expected, rel=1e-3)


def test_ml_goes_through_the_foods_density() -> None:
    oil = _food("3")
    assert density(oil) == pytest.approx(13.5 / 15)
    assert line_grams(line("oil", "30", "ml"), oil).grams == pytest.approx(27.0)
    assert line_grams(line("water", "750ml (Approximately)"), _food("1")).grams == 750.0


@pytest.mark.parametrize(
    ("qty", "unit", "food_id", "expected", "has_portion"),
    [
        ("2", "tbsp", "3", 27.0, True),  # the oil's own tablespoon
        ("2", "tbsp", "1", 30.0, False),  # 15 ml x density 1.0
        ("1", "cup", "1", 240.0, False),  # the fixed 240 ml cup
        ("1", "cup", "4", 125.0, True),  # the flour's own generic cup row
        ("2", "katori", "1", 300.0, False),
        ("1", "glass", "1", 250.0, False),
        ("3", "tsp", "1", 15.0, False),
    ],
)
def test_spoon_and_cup_table(
    qty: str, unit: str, food_id: str, expected: float, has_portion: bool
) -> None:
    result = line_grams(line("x", qty, unit), _food(food_id))
    assert result.basis == "table"
    assert result.grams == pytest.approx(expected)
    assert (result.portion is not None) is has_portion


def test_a_pinch_is_a_fixed_weight() -> None:
    result = line_grams(line("salt", "a pinch"), _food("1"))
    assert result.grams == pytest.approx(PINCH_GRAMS)
    assert result.basis == "table"


# --- gram hints: always the line TOTAL unless the text says "each" (Amendment 2) -------------


def test_hint_in_the_unit_field_is_the_total() -> None:
    # '4 Tablespoons (60ml)' coconut oil -> 60 ml total, not 4 x 60
    result = line_grams(line("Coconut Oil", "4", "Tablespoons (60ml)"), _food("1"))
    assert result.grams == pytest.approx(60.0)
    assert result.basis == "stated"
    assert result.hint_reading == "total"
    assert "hint_conflict" not in result.flags


def test_hint_after_the_unit_word_is_the_total() -> None:
    # '1½ Tablespoon (15gm)' garlic -> 15 g
    result = line_grams(line("Chopped Garlic", "1½", "Tablespoon (15gm)"), _food("1"))
    assert result.grams == pytest.approx(15.0)
    assert result.hint_reading == "total"


def test_hint_inside_the_amount_text_is_the_total() -> None:
    # '2 US cup measure (100 gms)' broccoli -> 100 g
    result = line_grams(line("Broccoli florets", "2 US cup measure (100 gms)"), _food("1"))
    assert result.grams == pytest.approx(100.0)
    assert result.hint_reading == "total"


def test_hint_with_each_is_per_unit() -> None:
    result = line_grams(line("flour", "2 cups (120 g each)"), _food("1"))
    assert result.grams == pytest.approx(240.0)
    assert result.hint_reading == "per_unit"
    result = line_grams(line("eggs", "2", "large", prep_note="(~60g / 2 oz each)"), _food("6"))
    assert result.grams == pytest.approx(120.0)
    assert result.hint_reading == "per_unit"


def test_standalone_and_slash_hints_are_totals() -> None:
    assert line_grams(line("Stewing beef", "1½ (700g)"), _food("1")).grams == pytest.approx(700.0)
    onions = line_grams(
        line("Onion", "4", "Nos (medium size) / 500gm", prep_note="sliced"), _food("2")
    )
    assert onions.grams == pytest.approx(500.0)
    assert onions.hint_reading == "total"


def test_hint_in_the_name_is_the_total() -> None:
    result = line_grams(line("(2 large, 300 grams) tomatoes", "1½ cups"), _food("1"))
    assert result.grams == pytest.approx(300.0)


def test_hint_range_is_a_midpoint_estimate() -> None:
    result = line_grams(
        line("palak", "3½ to 4 cups", "cups", prep_note="(100 to 120 grams)"), _food("1")
    )
    assert result.grams == pytest.approx(110.0)
    assert result.basis == "estimated"
    assert "range_midpoint" in result.flags


def test_hint_far_from_the_table_is_kept_and_flagged() -> None:
    # 900 g of flour for 1 cup (125 g): kept, flagged
    result = line_grams(line("flour", "1 cup (900 g)"), _food("4"))
    assert result.grams == pytest.approx(900.0)
    assert "hint_conflict" in result.flags
    assert result.basis == "stated"


def test_two_gram_figures_are_ambiguous_so_no_hint_is_used() -> None:
    result = line_grams(line("flour", "1 cup (100 g or 120 g)"), _food("4"))
    assert result.hint_reading is None
    assert result.grams == pytest.approx(125.0)


# --- ranges, counts, sizes ---------------------------------------------------------------------


def test_range_resolves_to_its_midpoint_as_an_estimate() -> None:
    result = line_grams(line("oil", "2-3", "tbsp"), _food("3"))
    assert result.grams == pytest.approx(2.5 * 13.5)
    assert result.basis == "estimated"
    assert "range_midpoint" in result.flags


def test_counts_use_the_size_word_and_default_to_medium() -> None:
    assert line_grams(line("onion", "2", "medium"), _food("2")).grams == pytest.approx(220.0)
    assert line_grams(line("onion", "1"), _food("2")).grams == pytest.approx(110.0)
    large = line_grams(line("large onion", "1"), _food("2"))
    assert large.grams == pytest.approx(150.0)
    assert large.portion is not None
    assert large.portion.unit == "large"
    assert line_grams(line("eggs", "4", "large"), _food("6")).grams == pytest.approx(200.0)


def test_count_noun_picks_its_portion() -> None:
    assert line_grams(line("garlic cloves", "4"), _food("5")).grams == pytest.approx(12.0)
    assert line_grams(line("garlic", "3", "cloves"), _food("5")).grams == pytest.approx(9.0)


def test_portion_tiebreak_prefers_prep_match_then_generic() -> None:
    flour = _food("4")
    sifted = line_grams(line("flour", "1", "cup", prep_note="sifted"), flour)
    assert sifted.grams == pytest.approx(110.0)
    chopped = line_grams(line("chopped flour", "1", "cup"), flour)
    assert chopped.grams == pytest.approx(90.0)
    generic = line_grams(line("flour", "1", "cup"), flour)
    assert generic.grams == pytest.approx(125.0)
    assert generic.portion is not None
    assert generic.portion.prep == ""


def test_a_count_with_no_matching_portion_needs_the_llm() -> None:
    result = line_grams(line("curry leaves", "2", "sprigs"), _food("1"))
    assert result.grams is None
    assert result.needs_llm


def test_no_amount_is_missing_not_zero_and_not_a_guess() -> None:
    for qty in (None, "to taste", ""):
        result = line_grams(line("salt", qty), _food("1"))
        assert result.grams is None
        assert result.basis == "missing"
        assert not result.needs_llm


def test_garbled_amount_asks_the_llm_and_is_flagged() -> None:
    result = line_grams(line("butter", "30 \t39 40g / 2 \t3 3 tbsp"), _food("1"))
    assert result.grams is None
    assert result.needs_llm
    assert "unparseable_amount" in result.flags
