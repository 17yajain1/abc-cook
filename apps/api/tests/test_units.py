"""extract/units.py -- a closed alias table; unknown units stay None, never guessed."""

from __future__ import annotations

import pytest

from abc_cook.extract.units import _ALIASES, canonical_unit

_EVERY_ALIAS = [(alias, canonical) for canonical, aliases in _ALIASES.items() for alias in aliases]


@pytest.mark.parametrize(("alias", "canonical"), _EVERY_ALIAS)
def test_every_alias_maps_to_its_canonical_unit(alias: str, canonical: str) -> None:
    assert canonical_unit(alias) == canonical


@pytest.mark.parametrize(
    ("unit", "canonical"),
    [
        ("GMS", "g"),
        ("Tbsp.", "tbsp"),
        ("no.", "count"),
        ("Nos", "count"),
        ("Lts", "l"),
        ("  cups ", "cup"),
        ("g (about 1 cup)", "g"),
    ],
)
def test_case_and_trailing_dots(unit: str, canonical: str) -> None:
    assert canonical_unit(unit) == canonical


@pytest.mark.parametrize("unit", ["tap", "medium", "large", "small", "bunch", "", None])
def test_unknown_units_are_none(unit: str | None) -> None:
    assert canonical_unit(unit) is None


@pytest.mark.parametrize(
    ("rest", "canonical"),
    [(" lts", "l"), (" Nos", "count"), ("gms", "g"), (" tbsp chopped", "tbsp"), (" medium", None)],
)
def test_unit_read_from_rest_when_there_is_no_unit(rest: str, canonical: str | None) -> None:
    assert canonical_unit(None, rest) == canonical
    assert canonical_unit("", rest) == canonical


def test_unit_field_wins_over_rest() -> None:
    assert canonical_unit("g", " cups") == "g"
    assert canonical_unit("medium", " cups") is None
