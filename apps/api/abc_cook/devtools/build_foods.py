"""Build `abc_cook/nutrition/data/foods.json` from USDA FoodData Central (dev-only).

Downloads the SR Legacy and Foundation CSV zips (CC0 1.0, public domain; credit USDA FDC)
into `apps/api/.cache/fdc/`, each into its own empty directory, and writes one compact JSON
file of curated foods: per-100 g macros, a veg flag, a divisible flag, household portion
weights and the reviewed-later Indian-name aliases from `foods_curation.json`.

Run as ``python -I apps/api/abc_cook/devtools/build_foods.py``. The downloaded files are
untrusted data, so nothing here executes or imports anything from them; they are only parsed
with `csv`. The runtime app never imports this module (`tests/test_devtools_isolation.py`).
"""

from __future__ import annotations

import csv
import json
import re
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

_API_DIR = Path(__file__).resolve().parents[2]
if __name__ == "__main__":  # `python -I` ignores PYTHONPATH and the cwd
    sys.path.insert(0, str(_API_DIR))

from abc_cook.extract.units import CANONICAL_UNITS  # noqa: E402

CACHE_DIR = _API_DIR / ".cache" / "fdc"
CURATION_PATH = Path(__file__).with_name("foods_curation.json")
OUT_PATH = _API_DIR / "abc_cook" / "nutrition" / "data" / "foods.json"

SOURCES = {
    "sr_legacy": (
        "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip",
        "SR Legacy (April 2018)",
    ),
    "foundation": (
        "https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_csv_2026-04-30.zip",
        "Foundation (2026-04-30)",
    ),
}
FOODS_VERSION = "usda-fdc-sr2018-04+foundation2026-04-30/b3-1"
_CSV_FILES = (
    "food.csv",
    "food_category.csv",
    "food_nutrient.csv",
    "food_portion.csv",
    "measure_unit.csv",
    "foundation_food.csv",
)

# FDC nutrient ids. Energy falls back to the Atwater values when 1008 is absent (Foundation).
_KCAL_IDS = (1008, 2047, 2048)
_PROTEIN_ID, _FAT_ID, _FIBRE_ID = 1003, 1004, 1079
_CARB_IDS = (1005, 1050)  # total carbohydrate, by difference else by summation (never net)

_MEAT_GROUPS = {
    "Poultry Products",
    "Beef Products",
    "Pork Products",
    "Lamb, Veal, and Game Products",
    "Finfish and Shellfish Products",
    "Sausages and Luncheon Meats",
}
_VEG_GROUPS = {
    "Fruits and Fruit Juices",
    "Vegetables and Vegetable Products",
    "Legumes and Legume Products",
    "Nut and Seed Products",
    "Cereal Grains and Pasta",
    "Spices and Herbs",
}
_MEAT_WORDS = re.compile(
    r"\b(?:meat|chicken|beef|pork|fish|anchovy|anchovies|lard|tallow|gelatin|bacon|ham|shrimp)\b",
    re.IGNORECASE,
)
_EGG_WORD = re.compile(r"\begg\b", re.IGNORECASE)
_EGG_DESCRIPTION = re.compile(r"^egg\b|\byolk\b|\begg white\b|\begg,", re.IGNORECASE)

# Units a portion may be stored under: the closed canonical table, plus size and count words.
_SIZE_COUNT_WORDS = {
    "small": "small",
    "medium": "medium",
    "large": "large",
    "extra": "extra large",
    "clove": "clove",
    "cloves": "clove",
    "slice": "slice",
    "slices": "slice",
    "sprig": "sprig",
    "sprigs": "sprig",
    "leaf": "leaf",
    "leaves": "leaf",
    "stalk": "stalk",
    "stalks": "stalk",
    "piece": "piece",
    "pieces": "piece",
    "each": "piece",
    "unit": "piece",
    "item": "piece",
    "egg": "piece",
    "whole": "whole",
    "fruit": "fruit",
    "pod": "pod",
    "pods": "pod",
}
_VOLUME_UNITS = {"tsp", "tbsp", "cup"}
_NOT_AN_ITEM = {
    "serving", "package", "container", "jar", "can", "bottle", "packet", "box", "bag", "carton",
    "portion", "order", "scoop", "cubic", "fl", "pint", "quart", "gallon", "liter", "milliliter",
    "lb", "oz", "inch", "tablet", "sheet", "bowl", "nlea", "roast",
}  # fmt: skip
_WORD_RE = re.compile(r"[a-z]+")
_PAREN_RE = re.compile(r"\([^)]*\)")


def _ensure_source(name: str) -> Path:
    """Download (if missing) and unpack one source into its own directory; return it."""
    url, _label = SOURCES[name]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    archive = CACHE_DIR / f"{name}.zip"
    if not archive.exists():
        print(f"downloading {url}")
        with urllib.request.urlopen(url, timeout=120) as response:  # fixed https URL
            archive.write_bytes(response.read())
    target = CACHE_DIR / name
    target.mkdir(exist_ok=True)
    if not (target / "food.csv").exists():
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.namelist():
                base = member.rsplit("/", 1)[-1]
                if base in _CSV_FILES:  # flat names only: never a path out of `target`
                    (target / base).write_bytes(bundle.read(member))
    return target


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def _portion_unit(measure: str, modifier: str) -> tuple[str, str] | None:
    """(unit, prep) for one FDC portion row, or None when it is not a unit we keep."""
    measure = measure.strip().lower()
    cleaned = _PAREN_RE.sub("", modifier.lower()).strip()
    words = _WORD_RE.findall(cleaned)
    if measure and measure != "undetermined":
        unit = _known_unit(measure)
        if unit is not None:  # Foundation: the measure is the unit, the modifier is the prep
            return unit, " ".join(words)
    # SR Legacy: the unit is a word of the modifier ("cup, chopped", "potato large (3 in dia)").
    for index, word in enumerate(words[:3]):
        unit = _known_unit(word)
        if unit is None:
            continue
        prep_words = [*words[:index], *words[index + 1 :]]
        if unit == "extra large":
            prep_words = [w for w in prep_words if w != "large"]
        return unit, " ".join(prep_words)
    # A leading item noun ("roll", "breast", "link") is a count of that item.
    if words and words[0] not in _NOT_AN_ITEM and measure in ("", "undetermined"):
        return "piece", " ".join(words)
    return None


def _known_unit(word: str) -> str | None:
    """A portion unit we keep: a spoon or cup, or a size or count word. Metric is arithmetic."""
    canonical = CANONICAL_UNITS.get(word)
    if canonical is not None:
        return canonical if canonical in _VOLUME_UNITS else None
    return _SIZE_COUNT_WORDS.get(word)


def _veg_flag(group: str, description: str) -> str:
    """Classify a food as veg, egg, non_veg or unknown from its FDC group and keywords.

    Meat groups are non_veg and produce, legume, grain, nut and spice groups are veg. Dairy is
    veg unless the description is an egg. Fats and every mixed group (soups, baked goods, sweets,
    snacks, beverages) use a whole-word keyword check: meat or fish words make it non_veg, "egg"
    alone makes it egg, and nothing found is veg for Fats and Oils but unknown elsewhere.
    """
    if group in _MEAT_GROUPS:
        return "non_veg"
    if group in _VEG_GROUPS:
        return "veg"
    if group == "Dairy and Egg Products":
        return "egg" if _EGG_DESCRIPTION.search(description) else "veg"
    if _MEAT_WORDS.search(description):
        return "non_veg"
    if _EGG_WORD.search(description):
        return "egg"
    return "veg" if group == "Fats and Oils" else "unknown"


def _load_source(name: str, categories_of_interest: set[str]) -> dict[str, dict[str, Any]]:
    """Parse one source into {fdc_id: raw food dict} for the included groups."""
    folder = _ensure_source(name)
    categories = {r["id"]: r["description"] for r in _rows(folder / "food_category.csv")}
    measures = {r["id"]: r["name"] for r in _rows(folder / "measure_unit.csv")}
    foods: dict[str, dict[str, Any]] = {}
    foundation_ids: set[str] | None = None
    if (folder / "foundation_food.csv").exists():
        foundation_ids = {r["fdc_id"] for r in _rows(folder / "foundation_food.csv")}
    for row in _rows(folder / "food.csv"):
        if foundation_ids is not None and row["fdc_id"] not in foundation_ids:
            continue
        group = categories.get(row["food_category_id"], "")
        if group not in categories_of_interest:
            continue
        foods[row["fdc_id"]] = {
            "fdc_id": row["fdc_id"],
            "description": row["description"].strip(),
            "group": group,
            "source": name,
            "nutrients": {},
            "portions": [],
        }
    wanted = {*_KCAL_IDS, _PROTEIN_ID, _FAT_ID, _FIBRE_ID, *_CARB_IDS}
    for row in _rows(folder / "food_nutrient.csv"):
        food = foods.get(row["fdc_id"])
        if food is None or int(row["nutrient_id"]) not in wanted:
            continue
        food["nutrients"][int(row["nutrient_id"])] = float(row["amount"])
    for row in _rows(folder / "food_portion.csv"):
        food = foods.get(row["fdc_id"])
        if food is None or not row["gram_weight"]:
            continue
        amount = float(row["amount"] or 1) or 1.0
        measure_name = measures.get(row["measure_unit_id"], "")
        parsed = _portion_unit(measure_name, row["modifier"])
        if parsed is None:
            continue
        unit, prep = parsed
        food["portions"].append(
            {
                "unit": unit,
                "prep": prep,
                "grams": round(float(row["gram_weight"]) / amount, 2),
                "raw_modifier": f"{measure_name}|{row['modifier']}".strip("|"),
            }
        )
    return foods


def _macros(nutrients: dict[int, float]) -> dict[str, float] | None:
    kcal = next((nutrients[i] for i in _KCAL_IDS if i in nutrients), None)
    carbs = next((nutrients[i] for i in _CARB_IDS if i in nutrients), None)
    if kcal is None or carbs is None or _PROTEIN_ID not in nutrients or _FAT_ID not in nutrients:
        return None
    # Carbohydrate "by difference" can come out a hair below zero for fatty meats; clamp at 0.
    return {
        "kcal": round(max(kcal, 0.0), 1),
        "protein_g": round(max(nutrients[_PROTEIN_ID], 0.0), 2),
        "carbs_g": round(max(carbs, 0.0), 2),
        "fat_g": round(max(nutrients[_FAT_ID], 0.0), 2),
        "fibre_g": round(max(nutrients.get(_FIBRE_ID, 0.0), 0.0), 2),
    }


def build(curation: dict[str, Any]) -> dict[str, Any]:
    """Assemble the foods.json document from the downloaded sources and the curation file."""
    groups = set(curation["include_groups"])
    excluded = [re.compile(p, re.IGNORECASE) for p in curation["exclude_description_regex"]]
    # Case-sensitive: a brand name is the only all-caps word FDC puts in a description.
    excluded += [re.compile(p) for p in curation["exclude_description_regex_case_sensitive"]]
    processed = re.compile(curation["processed_state_regex"], re.IGNORECASE)
    keep_state = [re.compile(p, re.IGNORECASE) for p in curation["keep_state_regex"]]
    indivisible = [re.compile(p, re.IGNORECASE) for p in curation["indivisible_regex"]]
    extra_ids = {str(i) for i in curation["extra_fdc_ids"]}
    pantry_only = {
        group: [re.compile(p, re.IGNORECASE) for p in patterns]
        for group, patterns in curation["pantry_only"].items()
    }

    raw: dict[str, dict[str, Any]] = {}
    # Foundation last, so it wins on a clash; portions are merged below.
    for name in ("sr_legacy", "foundation"):
        raw.update(_load_source(name, groups | set(curation.get("extra_groups", []))))

    by_description: dict[str, dict[str, Any]] = {}
    for food in raw.values():
        description = food["description"]
        keep = food["fdc_id"] in extra_ids
        if not keep:
            if any(p.search(description) for p in excluded):
                continue
            if food["group"] not in groups:
                continue
            pantry = pantry_only.get(food["group"])
            if pantry is not None and not any(p.search(description) for p in pantry):
                continue
            if processed.search(description) and not any(p.search(description) for p in keep_state):
                continue
        key = description.casefold()
        twin = by_description.get(key)
        if twin is not None:  # same food in both sources: Foundation values, all portions
            food["portions"] = food["portions"] + [
                p for p in twin["portions"] if p not in food["portions"]
            ]
        by_description[key] = food

    foods: dict[str, dict[str, Any]] = {}
    for food in by_description.values():
        macros = _macros(food["nutrients"])
        if macros is None:
            continue
        description = food["description"]
        foods[f"fdc:{food['fdc_id']}"] = {
            "id": f"fdc:{food['fdc_id']}",
            "name": description,
            "aliases": [],
            "food_group": food["group"],
            "veg": _veg_flag(food["group"], description),
            "divisible": not any(p.search(description) for p in indivisible),
            **macros,
            "portions": sorted(food["portions"], key=lambda p: (p["unit"], p["prep"], p["grams"])),
        }

    missing = []
    for row in curation["aliases"]:
        target = foods.get(f"fdc:{row['fdc_id']}")
        if target is None:
            missing.append(f"{row['alias']!r} -> fdc:{row['fdc_id']}")
            continue
        target["aliases"].append(
            {"alias": row["alias"], "source": row["source"], "reviewed": row["reviewed"]}
        )
    if missing:
        raise SystemExit("aliases pointing at foods not in the list:\n  " + "\n  ".join(missing))
    apply_veg_overrides(foods, curation.get("veg_overrides", []))

    return {
        "foods_version": FOODS_VERSION,
        "source": "USDA FoodData Central SR Legacy (April 2018) + Foundation (2026-04-30)",
        "licence": "CC0 1.0, public domain; credit USDA FDC",
        "no_food": [n.casefold() for n in curation.get("no_food", [])],
        "foods": sorted(foods.values(), key=lambda f: f["id"]),
    }


def apply_veg_overrides(foods: dict[str, dict[str, Any]], overrides: list[dict[str, Any]]) -> None:
    """Flip listed `unknown` foods to `veg` (plain pantry staples), in place.

    An override only ever turns `unknown` into `veg`; a listed food that is `non_veg` or `egg`,
    or one that is not in the table at all, stops the build.
    """
    problems = []
    for row in overrides:
        food = foods.get(f"fdc:{row['fdc_id']}")
        if row["veg"] != "veg":
            problems.append(
                f"fdc:{row['fdc_id']}: an override can only set veg, got {row['veg']!r}"
            )
        elif food is None:
            problems.append(f"fdc:{row['fdc_id']}: not in the food list")
        elif food["veg"] in ("non_veg", "egg"):
            problems.append(
                f"fdc:{row['fdc_id']} {food['name']!r} is {food['veg']}: not overridable"
            )
        elif food["veg"] == "unknown":
            food["veg"] = "veg"
    if problems:
        raise SystemExit("veg_overrides:\n  " + "\n  ".join(problems))


def main() -> None:
    """Build and write `foods.json`, then print the food and alias counts."""
    curation = json.loads(CURATION_PATH.read_text(encoding="utf-8"))
    document = build(curation)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
    )
    aliases = sum(len(f["aliases"]) for f in document["foods"])
    size_kib = OUT_PATH.stat().st_size / 1024
    print(
        f"wrote {OUT_PATH} ({len(document['foods'])} foods, {aliases} aliases, {size_kib:.0f} KiB)"
    )


if __name__ == "__main__":
    main()
