"""extract/source_key.py -- parity with the web app's `canonicalSourceKey` (A3 stage 2).

The vectors file's expected keys are the TypeScript implementation's output (run under
Node); `apps/web/src/library/sourceKey.vectors.test.ts` asserts the same file.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.source_key import _fnv1a, _utf16_units, canonical_source_key

_VECTORS = Path(__file__).parent / "fixtures" / "source_key_vectors.json"
_DOC: dict[str, Any] = json.loads(_VECTORS.read_text(encoding="utf-8"))


def test_vectors_are_substantial() -> None:
    assert len(_DOC["vectors"]) > 100


@pytest.mark.parametrize(
    "vector", _DOC["vectors"], ids=lambda v: f"{v['kind']}:{v['value'][:40]!r}"
)
def test_parity_with_typescript(vector: dict[str, str]) -> None:
    assert canonical_source_key(vector["kind"], vector["value"]) == vector["key"]  # type: ignore[arg-type]


def test_known_divergences_do_not_raise_and_are_reported() -> None:
    """Shapes the port does not emulate fall back to the raw key; never an exception."""
    assert _DOC["known_divergences"]
    for d in _DOC["known_divergences"]:
        got = canonical_source_key(d["kind"], d["value"])
        assert got != d["ts_key"]  # a documented divergence, not silent agreement
        assert got.startswith("url:")


def test_text_inline_and_fingerprint_boundaries() -> None:
    assert canonical_source_key("text", "x" * 64) == "text:" + "x" * 64
    long = canonical_source_key("text", "x" * 65)
    assert long == "text:" + "x" * 32 + "#b42b1787"


def test_text_key_ignores_case_and_whitespace() -> None:
    body = "Ingredients: one onion. Method: chop, fry, serve hot with rice. " * 5
    a = canonical_source_key("text", body)
    b = canonical_source_key("text", "  " + body.upper().replace(" ", "  ") + "\n")
    assert a == b
    assert len(a) < 60


def test_fnv_is_over_utf16_code_units() -> None:
    # U+1F35B is a surrogate pair in JS: two code units, not one code point.
    assert _utf16_units("\U0001f35b") == [0xD83C, 0xDF5B]
    assert _fnv1a(_utf16_units("")) == "811c9dc5"


def test_same_recipe_different_share_forms_collapse() -> None:
    a = canonical_source_key("url", "https://youtu.be/nF8krMx7OxA?si=abc")
    b = canonical_source_key("url", "https://www.youtube.com/watch?v=nF8krMx7OxA&t=42s")
    assert a == b == "youtube:nF8krMx7OxA"
