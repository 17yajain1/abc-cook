"""extract/source_key.py -- parity with the web app's `canonicalSourceKey` (A3 stage 2).

The vectors file's expected keys are the TypeScript implementation's output (run under
Node); `apps/web/src/library/sourceKey.vectors.test.ts` asserts the same file.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.source_key import (
    _fnv1a,
    _utf16_units,
    canonical_source_key,
    make_source_key,
)

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


# --- fallback provenance (typed, never inferred from the key string) -----------------


@pytest.mark.parametrize(
    "vector", _DOC["vectors"], ids=lambda v: f"{v['kind']}:{v['value'][:40]!r}"
)
def test_make_source_key_value_matches_every_parity_vector(vector: dict[str, str]) -> None:
    sk = make_source_key(vector["kind"], vector["value"])  # type: ignore[arg-type]
    assert sk.value == vector["key"]
    assert sk.kind == vector["kind"]


@pytest.mark.parametrize(
    "value",
    [
        "",
        "not a url at all",
        "/relative/path",
        "site.com/r/AbC123",  # scheme-less: acquire() accepts it, the parser does not
        "example.com/dal",
        "https://exa mple.com/x",  # space in host
        "https://example.com:99999/x",  # bad port
        "gopher://example.com/x",  # non-special scheme with an authority: not emulated
        "file:///tmp/x",
    ],
)
def test_unparseable_or_unemulated_urls_are_marked_fallback(value: str) -> None:
    sk = make_source_key("url", value)
    assert sk.is_fallback
    assert sk.value == canonical_source_key("url", value)  # key string unchanged


@pytest.mark.parametrize(
    "value",
    [
        "https://example.com/dal",
        "http://example.com/dal",
        "https://WWW.Example.com/Recipes/dal/?utm_source=x",
        "https://youtu.be/nF8krMx7OxA",
        "https://www.youtube.com/watch?v=nF8krMx7OxA",
        "https://www.youtube.com/watch?v=",  # empty id: canonicalised url key, not raw
        "https://www.instagram.com/reel/Abc123/",
        "https://www.instagram.com/someuser/",  # not a reel: canonicalised url key
        "ftp://example.com/dal",  # emulated special scheme
        "mailto:a@b.com",  # opaque path is parsed, not a fallback
    ],
)
def test_canonicalised_urls_are_not_fallback(value: str) -> None:
    assert not make_source_key("url", value).is_fallback


def test_youtube_and_instagram_keys_are_never_fallback() -> None:
    assert not make_source_key("url", "https://youtu.be/AbC").is_fallback
    assert not make_source_key("url", "https://instagram.com/reels/AbC/").is_fallback
    assert make_source_key("url", "https://youtu.be/AbC").value == "youtube:AbC"


def test_text_is_not_a_fallback_but_is_a_text_kind() -> None:
    sk = make_source_key("text", "chop onion")
    assert sk.kind == "text"
    assert not sk.is_fallback


def test_image_reference_is_never_canonicalised_so_it_is_fallback() -> None:
    assert make_source_key("image", "img_123").is_fallback


def test_fallback_keys_collide_but_canonical_ones_do_not() -> None:
    a = make_source_key("url", "site.com/r/AbC123")
    b = make_source_key("url", "site.com/r/abc123")
    assert a.value == b.value  # the collision that motivates never caching fallbacks
    assert a.is_fallback
    assert b.is_fallback
    assert (
        make_source_key("url", "https://site.com/r/AbC123").value
        != make_source_key("url", "https://site.com/r/abc123").value
    )
