"""The bundled USDA food table (`data/foods.json`), loaded once, with a name and alias index.

The file is built by `abc_cook.devtools.build_foods` and is read-only at runtime: no API call,
no network. `FoodTable.from_document` also builds a small table for tests.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

DATA_PATH = Path(__file__).parent / "data" / "foods.json"

VegFlag = Literal["veg", "egg", "non_veg", "unknown"]


@dataclass(frozen=True)
class FoodPortion:
    """One FDC household portion: grams for one of a unit ("medium", "cup", "clove")."""

    unit: str
    prep: str
    grams: float
    raw_modifier: str


@dataclass(frozen=True)
class Food:
    """One food, per 100 g."""

    id: str
    name: str
    aliases: tuple[str, ...]
    food_group: str
    veg: VegFlag
    divisible: bool
    kcal: float
    protein_g: float
    carbs_g: float
    fat_g: float
    fibre_g: float
    portions: tuple[FoodPortion, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ShortlistBlock:
    """Foods kept off the shortlist for any line whose cleaned name contains one of `names`."""

    names: tuple[str, ...]
    food_ids: frozenset[str]


@dataclass(frozen=True)
class FoodTable:
    """All foods plus the lookups the matcher needs."""

    foods_version: str
    foods: dict[str, Food]
    by_name: dict[str, str]
    by_alias: dict[str, str]
    no_food: frozenset[str] = frozenset()
    """Names with no honest USDA row (curation): they stay unmatched without an LLM call."""
    alias_reviewed: dict[str, bool] = field(default_factory=dict)
    """Per alias: whether the owner has reviewed that mapping."""
    shortlist_block: tuple[ShortlistBlock, ...] = ()
    """Curated exclusions from the model's shortlist (a wrong food that shares a word)."""

    @classmethod
    def from_document(cls, document: dict[str, Any]) -> FoodTable:
        """Build the table from a parsed `foods.json` document."""
        foods: dict[str, Food] = {}
        by_name: dict[str, str] = {}
        by_alias: dict[str, str] = {}
        alias_reviewed: dict[str, bool] = {}
        for raw in document["foods"]:
            portions = tuple(
                FoodPortion(p["unit"], p["prep"], float(p["grams"]), p.get("raw_modifier", ""))
                for p in raw.get("portions", [])
            )
            aliases = tuple(a["alias"].casefold() for a in raw.get("aliases", []))
            food = Food(
                id=raw["id"],
                name=raw["name"],
                aliases=aliases,
                food_group=raw["food_group"],
                veg=raw["veg"],
                divisible=raw["divisible"],
                kcal=float(raw["kcal"]),
                protein_g=float(raw["protein_g"]),
                carbs_g=float(raw["carbs_g"]),
                fat_g=float(raw["fat_g"]),
                fibre_g=float(raw["fibre_g"]),
                portions=portions,
            )
            foods[food.id] = food
            by_name.setdefault(food.name.casefold(), food.id)
            for alias in aliases:
                if alias not in by_alias:
                    by_alias[alias] = food.id
                    alias_reviewed[alias] = False
            for entry in raw.get("aliases", []):
                if by_alias.get(entry["alias"].casefold()) == food.id:
                    alias_reviewed[entry["alias"].casefold()] = bool(entry.get("reviewed", False))
        no_food = frozenset(n.casefold() for n in document.get("no_food", []))
        blocks = tuple(
            ShortlistBlock(
                tuple(n.casefold() for n in block["names"]), frozenset(block["food_ids"])
            )
            for block in document.get("shortlist_block", [])
        )
        return cls(
            document["foods_version"], foods, by_name, by_alias, no_food, alias_reviewed, blocks
        )

    def get(self, food_id: str) -> Food | None:
        """The food with this id, or None."""
        return self.foods.get(food_id)


@lru_cache(maxsize=1)
def load_foods() -> FoodTable:
    """The bundled table, parsed once per process."""
    return FoodTable.from_document(json.loads(DATA_PATH.read_text(encoding="utf-8")))
