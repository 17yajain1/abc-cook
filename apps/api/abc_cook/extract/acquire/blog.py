"""Leg 2: a description-linked recipe blog's schema.org Recipe JSON-LD. No LLM.

See docs/M2.9-youtube-import-design.md §4.4 and §10.A. Verified live against two real
recipe blogs during design: both carried rich, well-formed Recipe JSON-LD, one of them
inside a nested `@graph` with `HowToSection`/`HowToStep` structure — richer grounding
than the video description's own prose. This leg is a bonus, never a hard requirement:
every function here fails soft (returns `None`) rather than raising, since a missing or
broken blog link must never block the import — the description path still runs.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from abc_cook.extract.acquire.safe_fetch import FetchedPage, FetchError, fetch_html

_logger = logging.getLogger(__name__)

_EXCLUDED_HOSTS = frozenset(
    {
        "youtube.com",
        "youtu.be",
        "instagram.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "pinterest.com",
        "tiktok.com",
        "amazon.com",
        "amazon.in",
        "bit.ly",
    }
)
"""Known social/video/affiliate hosts to skip when scanning a description for a
recipe-blog link (design doc §4.4). `bit.ly` is excluded from the *candidate* list
itself, not followed-and-then-checked — see `find_candidate_links`."""

_LDJSON_BLOCK = re.compile(
    r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
    re.IGNORECASE | re.DOTALL,
)
_URL_IN_TEXT = re.compile(r'https?://[^\s<>"\')]+')


class NoRecipeFoundError(RuntimeError):
    """The page was fetched but carries no usable schema.org Recipe (A1).

    Distinct from a fetch failure: the user gets "we couldn't find a recipe on this
    page" and the paste-text option, never an LLM guess over raw HTML.
    """


def _host_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _is_excluded(host: str) -> bool:
    return any(host == excluded or host.endswith("." + excluded) for excluded in _EXCLUDED_HOSTS)


def find_candidate_links(description: str) -> list[str]:
    """URLs in `description` worth trying as a recipe blog.

    A link shortener (bit.ly and similar) is deliberately NOT excluded here — design
    doc §4.4 excludes it only *after* redirect resolution, since a bit.ly link
    genuinely can resolve to a real recipe blog (verified in §10.A). `fetch_recipe`
    follows redirects itself, so the exclusion there checks the final host.
    """
    candidates = []
    for match in _URL_IN_TEXT.finditer(description):
        url = match.group(0).rstrip(".,;)")
        host = _host_of(url)
        if host in ("bit.ly", "b.link", "tinyurl.com"):
            candidates.append(url)  # resolve first; excluded-host check happens post-redirect
            continue
        if _is_excluded(host):
            continue
        candidates.append(url)
    return candidates


def _find_recipe_node(data: Any) -> dict[str, Any] | None:
    """Walk a parsed JSON-LD document, including a nested `@graph`, for a Recipe node."""
    if isinstance(data, list):
        for item in data:
            found = _find_recipe_node(item)
            if found is not None:
                return found
        return None
    if not isinstance(data, dict):
        return None
    node_type = data.get("@type")
    if node_type == "Recipe" or (isinstance(node_type, list) and "Recipe" in node_type):
        return data
    graph = data.get("@graph")
    if graph is not None:
        return _find_recipe_node(graph)
    return None


def recipe_in_html(html: str) -> dict[str, Any] | None:
    """The first schema.org Recipe node in any JSON-LD block of `html`, if any."""
    for block in _LDJSON_BLOCK.findall(html):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        recipe = _find_recipe_node(data)
        if recipe is not None:
            return recipe
    return None


def _instruction_texts(node: Any) -> list[str]:
    """Every non-blank instruction string in a `recipeInstructions` value.

    The field is a string, a list of strings, a list of `HowToStep` (`text`), or a list
    of `HowToSection` (`itemListElement` of the same) -- all shapes seen in the wild.
    """
    if isinstance(node, str):
        return [node.strip()] if node.strip() else []
    if isinstance(node, list):
        return [text for item in node for text in _instruction_texts(item)]
    if isinstance(node, dict):
        if "itemListElement" in node:
            return _instruction_texts(node["itemListElement"])
        return _instruction_texts(node.get("text") or node.get("name"))
    return []


def has_usable_instructions(recipe: dict[str, Any]) -> bool:
    """Whether a Recipe node carries a method of its own (A1 decision 4).

    A Recipe with ingredients but no instructions is treated as "no recipe on this
    page": the method must be grounded in the page's own text, never invented.
    """
    return bool(_instruction_texts(recipe.get("recipeInstructions")))


@dataclass(frozen=True)
class RecipePage:
    """Result of `fetch_recipe_page`: exactly one of `recipe` / `reason` is set."""

    recipe: dict[str, Any] | None
    final_url: str | None = None
    reason: str | None = None


def fetch_recipe_page(
    url: str,
    *,
    allow_http: bool = False,
    fetch: Callable[..., FetchedPage] = fetch_html,
) -> RecipePage:
    """Fetch `url` through the SSRF-guarded fetcher and find its Recipe JSON-LD.

    Never raises: a refused or failed fetch, a redirect onto an excluded host, or a page
    with no Recipe node all come back as `RecipePage(recipe=None, reason=...)`, so the
    caller can tell *why* (the previous implementation swallowed every error silently).
    """
    try:
        page = fetch(url, allow_http=allow_http)
    except FetchError as exc:
        return RecipePage(recipe=None, reason=exc.reason)
    if _is_excluded(_host_of(page.final_url)):
        return RecipePage(
            recipe=None, final_url=page.final_url, reason="redirected to excluded host"
        )
    recipe = recipe_in_html(page.text)
    if recipe is None:
        return RecipePage(recipe=None, final_url=page.final_url, reason="no Recipe JSON-LD")
    return RecipePage(recipe=recipe, final_url=page.final_url)


def fetch_recipe(url: str) -> dict[str, Any] | None:
    """Leg 2 (description-linked blog): its Recipe JSON-LD node, or None. Never raises.

    http links are allowed here (they were fetchable before the SSRF guard existed);
    every other guard applies. A failure is logged with its reason rather than lost.
    """
    result = fetch_recipe_page(url, allow_http=True)
    if result.recipe is None:
        _logger.info("fetch_recipe: %s -> %s", url, result.reason)
    return result.recipe
