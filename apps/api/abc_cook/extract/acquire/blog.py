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
import re
from typing import Any
from urllib.parse import urlparse

import httpx

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

_USER_AGENT = "Mozilla/5.0 (compatible; ABCCookImport/1.0; +https://abccook.app)"


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


def fetch_recipe(url: str, *, timeout: float = 15.0) -> dict[str, Any] | None:
    """Fetch `url`, follow redirects, and return its Recipe JSON-LD node if present.

    Returns None on any fetch error, non-2xx status, or absence of a Recipe node —
    never raises. `httpx`'s default SSL context (backed by `certifi`) avoids the local
    certificate-store issue `urllib` hit against a bit.ly redirect during design
    (§10.A) — a plain `urllib` implementation would need the same explicit `certifi`
    handling to reproduce this reliably on Windows.
    """
    try:
        response = httpx.get(
            url,
            follow_redirects=True,
            timeout=timeout,
            headers={"User-Agent": _USER_AGENT},
        )
        response.raise_for_status()
    except httpx.HTTPError:
        return None

    if _is_excluded(_host_of(str(response.url))):
        return None

    for block in _LDJSON_BLOCK.findall(response.text):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        recipe = _find_recipe_node(data)
        if recipe is not None:
            return recipe
    return None
