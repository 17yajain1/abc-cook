"""The bundled USDA table and the veg-flag rules that build it (b2-plan Step 2)."""

from __future__ import annotations

import pytest

from abc_cook.devtools.build_foods import _portion_unit, _veg_flag
from abc_cook.nutrition.foods import load_foods


@pytest.mark.parametrize(
    ("group", "description", "expected"),
    [
        ("Fats and Oils", "Lard", "non_veg"),
        ("Dairy and Egg Products", "Egg, whole, raw, fresh", "egg"),
        ("Dairy and Egg Products", "Butter, salted", "veg"),
        ("Fats and Oils", "Fish oil, cod liver", "non_veg"),
        ("Fats and Oils", "Oil, olive, salad or cooking", "veg"),
        ("Poultry Products", "Chicken, breast, boneless, skinless, raw", "non_veg"),
        ("Vegetables and Vegetable Products", "Onions, raw", "veg"),
        # whole words only: 'ham' is not in 'graham', 'egg' is not in 'eggplant'
        ("Baked Products", "Cookies, graham crackers, plain or honey", "unknown"),
        ("Vegetables and Vegetable Products", "Eggplant, raw", "veg"),
        ("Soups, Sauces, and Gravies", "Sauce, eggplant, ready-to-serve", "unknown"),
        ("Baked Products", "Ham and cheese roll", "non_veg"),
        ("Soups, Sauces, and Gravies", "Soup, egg drop", "egg"),
        ("Sweets", "Sugars, granulated", "unknown"),
    ],
)
def test_veg_flag(group: str, description: str, expected: str) -> None:
    assert _veg_flag(group, description) == expected


@pytest.mark.parametrize(
    ("measure", "modifier", "expected"),
    [
        ("undetermined", "cup, chopped", ("cup", "chopped")),
        ("undetermined", "tbsp", ("tbsp", "")),
        ("undetermined", 'medium (2-1/2" dia)', ("medium", "")),
        ("undetermined", "clove", ("clove", "")),
        ("tablespoon", "", ("tbsp", "")),
        ("undetermined", "roll", ("piece", "roll")),
        ("undetermined", 'potato large (3" to 4-1/4" dia)', ("large", "potato")),
        ("undetermined", "extra large", ("extra large", "")),
        ("undetermined", "oz", None),
        ("undetermined", "fl oz", None),
        ("undetermined", "serving", None),
    ],
)
def test_portion_unit(measure: str, modifier: str, expected: tuple[str, str] | None) -> None:
    assert _portion_unit(measure, modifier) == expected


def test_bundled_table_is_well_formed() -> None:
    table = load_foods()
    assert 1000 <= len(table.foods) <= 2500
    assert table.foods_version
    for food in table.foods.values():
        assert food.id.startswith("fdc:")
        assert food.veg in {"veg", "egg", "non_veg", "unknown"}
        assert food.kcal >= 0
        assert food.protein_g >= 0
        assert food.carbs_g >= 0
        assert food.fat_g >= 0
    assert len(table.by_alias) >= 250


def test_indian_names_resolve_to_a_reviewable_alias() -> None:
    table = load_foods()
    for alias in ("rajma", "besan", "toor dal", "atta", "maida", "ghee", "paneer", "curd", "jeera"):
        assert alias in table.by_alias, alias
    assert "kidney" in table.foods[table.by_alias["rajma"]].name.lower()
    assert table.foods[table.by_alias["ghee"]].veg == "veg"
    assert table.foods[table.by_alias["rajma"]].veg == "veg"
    # a regional item with no honest USDA row stays unmatched
    for alias in ("garam masala", "curry leaves", "hing", "jaggery"):
        assert alias not in table.by_alias, alias
