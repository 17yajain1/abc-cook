"""The seed gate: repaired graphs, thin ingredient lists, missing amounts and rough labels block."""

from __future__ import annotations

from datetime import UTC, datetime

from nutrition_helpers import food, line, table

from abc_cook.extract.graph import SERVINGS_DEFAULTED_WARNING
from abc_cook.nutrition.calc import compute_nutrition
from abc_cook.nutrition.gate import REPAIRED_WARNING, seed_gate_rejects
from abc_cook.nutrition.resolution import LineResolution
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.nutrition import RecipeNutrition

T = table(food("1", "Rice, white, raw", group="Cereal Grains and Pasta", kcal=360))
NOW = datetime(2026, 10, 27, tzinfo=UTC)


def _nutrition(lines: list[Ingredient]) -> RecipeNutrition:
    resolutions = [LineResolution("fdc:1", "alias", None, None, True) for _ in lines]
    return compute_nutrition(lines, 2, True, [], resolutions, computed_at=NOW, table=T)


def _lines(n: int) -> list[Ingredient]:
    return [line(f"rice {i}", "100", "g") for i in range(n)]


def test_five_lines_with_amounts_pass() -> None:
    lines = _lines(5)
    assert seed_gate_rejects(_nutrition(lines), [], lines) == []


def test_four_lines_are_rejected() -> None:
    lines = _lines(4)
    reasons = seed_gate_rejects(_nutrition(lines), [], lines)
    assert reasons == ["fewer than 5 ingredient lines (4)"]


def test_a_repaired_graph_is_rejected() -> None:
    lines = _lines(5)
    assert seed_gate_rejects(_nutrition(lines), [REPAIRED_WARNING], lines) == ["graph repaired"]


def test_fewer_than_eighty_percent_with_an_amount_is_rejected() -> None:
    lines = [*_lines(3), line("salt"), line("pepper")]  # 3 of 5 have an amount
    reasons = seed_gate_rejects(_nutrition(lines), [], lines)
    assert reasons == ["only 3 of 5 lines have an amount"]
    four_of_five = [*_lines(4), line("salt")]
    assert seed_gate_rejects(_nutrition(four_of_five), [], four_of_five) == []


def test_a_rough_label_is_rejected() -> None:
    lines = [line("rice", "100", "g"), *(line(f"x{i}", "400", "g") for i in range(4))]
    resolutions = [LineResolution("fdc:1", "alias", None, None, True)] + [
        LineResolution() for _ in range(4)
    ]
    nutrition = compute_nutrition(lines, 2, True, [], resolutions, computed_at=NOW, table=T)
    assert nutrition.confidence == "rough"
    assert "confidence rough" in seed_gate_rejects(nutrition, [], lines)


def test_defaulted_servings_do_not_block() -> None:
    lines = _lines(5)
    assert seed_gate_rejects(_nutrition(lines), [SERVINGS_DEFAULTED_WARNING], lines) == []
