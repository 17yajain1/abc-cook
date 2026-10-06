"""`SourcePreview` from a schema.org Recipe node. No LLM, no parsing of quantities.

The preview is the page's own text, shown while the cooking plan is still being built
(A2). Only presentation hygiene is applied -- HTML entities decoded and stray tags
dropped, because JSON-LD routinely carries `&amp;`/`<p>` -- never rewording, never
unit conversion, never anything that would make a line stop being the source's own.
"""

from __future__ import annotations

import html
import re
from typing import Any

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import has_usable_instructions
from abc_cook.schema.normalized import PreviewSection, SourcePreview

_TAG = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")


def _clean(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return _SPACE.sub(" ", html.unescape(_TAG.sub(" ", value))).strip()


def _lines(node: Any) -> list[str]:
    """Instruction lines of a `HowToStep`/string/list, flattened (no sections)."""
    if isinstance(node, str):
        line = _clean(node)
        return [line] if line else []
    if isinstance(node, list):
        return [line for item in node for line in _lines(item)]
    if isinstance(node, dict):
        if "itemListElement" in node:
            return _lines(node["itemListElement"])
        return _lines(node.get("text") or node.get("name"))
    return []


def _sections(node: Any) -> list[PreviewSection]:
    """Instruction sections: each `HowToSection` keeps its name; loose steps group."""
    if isinstance(node, (str, dict)):
        node = [node]
    if not isinstance(node, list):
        return []
    sections: list[PreviewSection] = []
    loose: list[str] = []

    def flush() -> None:
        if loose:
            sections.append(PreviewSection(heading=None, lines=list(loose)))
            loose.clear()

    for item in node:
        if isinstance(item, dict) and "itemListElement" in item:
            flush()
            lines = _lines(item["itemListElement"])
            if lines:
                heading = _clean(item.get("name")) or None
                sections.append(PreviewSection(heading=heading, lines=lines))
        else:
            loose.extend(_lines(item))
    flush()
    return sections


def build_preview(raw: RawAcquisition) -> SourcePreview | None:
    """The readable preview for `raw`, or None when there is nothing honest to show.

    Today this is Recipe JSON-LD only (a pasted recipe page, or a video whose
    description links to one). A video with no linked page gets no preview.
    """
    recipe = raw.blog_recipe
    if recipe is None or not has_usable_instructions(recipe):
        return None
    sections = _sections(recipe.get("recipeInstructions"))
    if not sections:
        return None
    ingredients_raw = recipe.get("recipeIngredient")
    ingredients = [
        line
        for line in (
            _clean(item) for item in (ingredients_raw if isinstance(ingredients_raw, list) else [])
        )
        if line
    ]
    return SourcePreview(
        title=_clean(recipe.get("name")) or raw.title,
        ingredients=ingredients,
        instructions=sections,
    )
