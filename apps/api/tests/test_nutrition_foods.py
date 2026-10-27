"""The bundled USDA table and the veg-flag rules that build it (b2-plan Step 2)."""

from __future__ import annotations

import pytest

from abc_cook.devtools.build_foods import _portion_unit, _veg_flag, apply_veg_overrides
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
        assert food.id.startswith(("fdc:", "proxy:"))  # v3 adds the curated poha proxy
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


def test_ginger_garlic_paste_is_an_alias_to_ginger() -> None:
    table = load_foods()
    for alias in ("ginger garlic paste", "garlic ginger paste", "ginger and garlic paste"):
        assert table.foods[table.by_alias[alias]].name == "Ginger root, raw", alias


def test_kasuri_methi_is_no_food_not_fenugreek_seed() -> None:
    table = load_foods()
    assert {"kasuri methi", "dried fenugreek leaves"} <= table.no_food
    assert "kasuri methi" not in table.by_alias


def test_veg_overrides_are_applied_to_plain_pantry_staples() -> None:
    table = load_foods()
    for food_id in ("fdc:174158", "fdc:746784", "fdc:169640", "fdc:175040", "fdc:167532"):
        assert table.foods[food_id].veg == "veg", food_id
    # chocolate, wine and the sauces are not overridden
    for food_id in ("fdc:167976", "fdc:169070", "fdc:174529"):
        assert table.foods[food_id].veg == "unknown", food_id


def test_a_veg_override_only_flips_unknown_to_veg() -> None:
    foods = {
        "fdc:1": {"name": "Water", "veg": "unknown"},
        "fdc:2": {"name": "Bacon", "veg": "non_veg"},
        "fdc:3": {"name": "Egg", "veg": "egg"},
        "fdc:4": {"name": "Onion", "veg": "veg"},
    }
    apply_veg_overrides(foods, [{"fdc_id": 1, "veg": "veg"}, {"fdc_id": 4, "veg": "veg"}])
    assert foods["fdc:1"]["veg"] == "veg"
    assert foods["fdc:4"]["veg"] == "veg"
    for bad in (2, 3):
        with pytest.raises(SystemExit, match="not overridable"):
            apply_veg_overrides(foods, [{"fdc_id": bad, "veg": "veg"}])
    with pytest.raises(SystemExit, match="not in the food list"):
        apply_veg_overrides(foods, [{"fdc_id": 99, "veg": "veg"}])


def test_foods_version_is_b36() -> None:
    assert load_foods().foods_version.endswith("/b36-1")


# --- v3 curation (b35-plan D1-D6) ---------------------------------------------------------------


def test_poha_is_a_proxy_of_rice_nutrients_with_its_own_cup_weight() -> None:
    table = load_foods()
    poha = table.foods["proxy:poha"]
    rice = table.foods["fdc:169756"]
    assert (poha.kcal, poha.protein_g, poha.carbs_g, poha.fat_g, poha.fibre_g) == (
        rice.kcal,
        rice.protein_g,
        rice.carbs_g,
        rice.fat_g,
        rice.fibre_g,
    )
    assert [p.grams for p in poha.portions if p.unit == "cup"] == [60.0]  # never rice's 185 g
    for alias in (
        "poha", "thick poha", "thin poha", "medium poha", "flattened rice", "beaten rice",
        "rice flakes", "aval", "avalakki",
    ):  # fmt: skip
        assert table.by_alias[alias] == "proxy:poha", alias
        assert table.alias_reviewed[alias] is True, alias


def test_the_groundcherry_poha_row_is_blocked_from_poha_shortlists() -> None:
    table = load_foods()
    (block,) = table.shortlist_block
    assert "fdc:173043" in block.food_ids
    assert "poha" in block.names


def test_paneer_stays_on_whole_milk_mozzarella_and_is_reviewed() -> None:
    table = load_foods()
    assert table.by_alias["paneer"] == "fdc:170845"
    assert table.alias_reviewed["paneer"] is True
    assert table.foods["fdc:170845"].name == "Cheese, mozzarella, whole milk"


def test_peanut_is_a_reviewed_alias_of_the_peanuts_row() -> None:
    table = load_foods()
    assert table.by_alias["peanut"] == table.by_alias["peanuts"] == "fdc:172430"
    assert table.alias_reviewed["peanut"] is True


@pytest.mark.parametrize(
    ("food_id", "unit", "grams"),
    [
        ("fdc:168570", "piece", 0.5),  # dried red chilli
        ("fdc:171321", "clove", 0.1),
        ("fdc:170919", "pod", 0.2),
        ("fdc:170919", "piece", 0.2),
        ("fdc:170917", "leaf", 0.2),
        ("fdc:170917", "piece", 0.2),
    ],
)
def test_dried_whole_spices_have_a_curated_per_piece_weight(
    food_id: str, unit: str, grams: float
) -> None:
    portions = [p for p in load_foods().foods[food_id].portions if p.unit == unit]
    assert grams in {p.grams for p in portions}
    assert any(p.raw_modifier.startswith("curation|") for p in portions)


def test_dried_red_chillies_map_to_the_sun_dried_row_not_the_fresh_one() -> None:
    table = load_foods()
    for alias in ("dry red chilies", "dried red chilli", "sukhi lal mirch"):
        assert table.by_alias[alias] == "fdc:168570", alias
        assert table.alias_reviewed[alias] is True
    assert "sun-dried" in table.foods["fdc:168570"].name


def test_spice_blends_and_charcoal_are_no_food() -> None:
    table = load_foods()
    blends = {
        "chaat masala", "garam masala", "pav bhaji masala", "biryani masala", "achar masala",
        "sambar masala", "italian seasoning", "kitchen king", "kitchen king masala",
        "charcoal", "natural charcoal",
    }  # fmt: skip
    assert blends <= table.no_food
    assert not blends & set(table.by_alias)
    assert table.by_alias["curry powder"] == "fdc:170924"  # an honest row: not listed


def test_the_owner_reviewed_aliases_are_flipped_and_the_rest_stay_unreviewed() -> None:
    table = load_foods()
    for alias in ("oil", "milk", "onion", "kashmiri red chili powder", "pumpkin pie spice", "ghee"):
        assert table.alias_reviewed[alias] is True, alias
    for alias in ("chicken", "soya", "kalamata olives", "chicken boneless", "boneless chicken"):
        assert table.alias_reviewed[alias] is False, alias
    # 81 flipped + peanut + 9 poha + 10 chilli + 4 salt + 4 coconut + 2 broth (b36)
    assert sum(table.alias_reviewed.values()) == 111
    for alias in ("salt", "sea salt", "salt and pepper", "cooking salt / kosher salt"):
        assert table.alias_reviewed[alias] is True, alias
        assert table.by_alias[alias] == "fdc:173468"


# --- B3.6 curation -----------------------------------------------------------------------


def test_coconut_and_almond_curated_cup_portions() -> None:
    table = load_foods()
    coconut = [(p.prep, p.grams) for p in table.foods["fdc:170170"].portions if p.unit == "cup"]
    assert coconut == [("", 85.0), ("shredded", 53.0)]
    almonds = [(p.prep, p.grams) for p in table.foods["fdc:2346393"].portions if p.unit == "cup"]
    assert almonds == [("whole", 143.0), ("sliced", 92.0), ("slivered", 108.0), ("ground", 95.0)]


def test_b36_aliases_are_reviewed() -> None:
    table = load_foods()
    for alias in (
        "desiccated coconut",
        "unsweetened shredded coconut",
        "unsweetened coconut",
        "unsweetened desiccated coconut",
    ):
        assert table.by_alias[alias] == "fdc:170170", alias
        assert table.alias_reviewed[alias] is True, alias
    assert table.by_alias["chicken broth"] == "fdc:172924"
    assert table.by_alias["vegetable broth"] == "fdc:171583"
    assert table.alias_reviewed["chicken broth"] is True
    assert table.alias_reviewed["vegetable broth"] is True
