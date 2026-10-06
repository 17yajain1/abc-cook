"""Combines acquisition legs into one `RawAcquisition`. No LLM.

Gap found during the M2.9 s15 checkpoint: `youtube.fetch` (leg 1) and `blog.fetch_recipe`
(leg 2) existed as standalone functions but nothing called leg 2 with leg 1's
description — every real YouTube import fell through to leg 1 alone, even for a video
whose description links to a blog with real Recipe JSON-LD (design doc §4.4/§10.A).
This is the missing orchestration, not a new acquisition leg.

Leg 3 (captions, M2.10) needed no orchestration change here: it lives entirely inside
`youtube.fetch` (leg 1), reading off the same yt-dlp `info` dict. This module still
runs legs 1+3 first, then leg 2 second.

Phase 1 (shortform-video-import-plan.md) adds a fast host allowlist ahead of leg 1.
`youtube.fetch` is yt-dlp-generic, so before this check it would happily *attempt*
any URL, including a host yt-dlp has no real extractor for (TikTok) or one it was
never exercised against here (a blog link pasted directly, rather than found via a
video's description per leg 2). yt-dlp's default retry/backoff budget on an
extraction it's ultimately going to fail can take the length of that whole budget to
give up -- to a user that reads as a hung import, not a fast, clear "unsupported
link." This rejects those up front, before any network call.
"""

from __future__ import annotations

from urllib.parse import urlparse

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import (
    NoRecipeFoundError,
    fetch_recipe,
    fetch_recipe_page,
    find_candidate_links,
    has_usable_instructions,
)
from abc_cook.extract.acquire.youtube import fetch as fetch_youtube

_SUPPORTED_HOSTS = frozenset({"youtube.com", "youtu.be", "instagram.com"})
"""The only hosts `youtube.fetch`'s yt-dlp-generic leg is actually exercised
against and frozen-fixture-tested for (docs/M2.9 design; shortform-video-import-
plan.md Phase 0 eval)."""

_UNSUPPORTED_HOSTS = frozenset(
    {
        "tiktok.com",
        "facebook.com",
        "fb.watch",
        "twitter.com",
        "x.com",
        "vimeo.com",
        "pinterest.com",
        "snapchat.com",
        "bit.ly",
        "amazon.com",
        "amazon.in",
    }
)
"""Video/social/shortener/shop hosts that are neither a supported video host nor a
recipe page. Rejected up front, before any network call (PR #29's fast-fail, kept for
video hosts). Any host in neither set is treated as a candidate recipe page (A1):
routing is by *content* -- does the page carry a schema.org Recipe -- not by hostname
category."""


def _host_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _host_in(host: str, hosts: frozenset[str]) -> bool:
    return any(host == h or host.endswith(f".{h}") for h in hosts)


def acquire(url: str) -> RawAcquisition:
    """Legs 1+3 (YouTube metadata + captions), then leg 2.

    Leg 2 finds the first description link with Recipe JSON-LD. It is a bonus and
    fails soft by construction (`blog.fetch_recipe` never raises): if no candidate
    link resolves to a Recipe, `blog_recipe` stays None and the description-only
    result from legs 1+3 is returned unchanged.

    Any other https URL is treated as a recipe page (`_acquire_recipe_page`).

    Raises:
        NoRecipeFoundError: a recipe-page URL was fetched but carries no usable Recipe.
        RuntimeError: `url`'s host is in `_UNSUPPORTED_HOSTS` (fast, before any network
            call), a recipe page couldn't be opened, or `youtube.fetch` itself failed
            for a supported video host.
    """
    if "://" not in url:
        url = f"https://{url.strip()}"
    elif url.startswith("http://"):
        url = f"https://{url.removeprefix('http://')}"
    host = _host_of(url)
    if _host_in(host, _UNSUPPORTED_HOSTS):
        raise RuntimeError(
            f"Unsupported link host {host!r} -- only YouTube, Instagram and recipe "
            "web pages can be imported."
        )
    if not _host_in(host, _SUPPORTED_HOSTS):
        return _acquire_recipe_page(url, host)
    raw = fetch_youtube(url)
    if raw.blog_recipe is not None or not raw.description:
        return raw

    for link in find_candidate_links(raw.description):
        recipe = fetch_recipe(link)
        if recipe is not None:
            return raw.model_copy(update={"blog_recipe": recipe})
    return raw


def _acquire_recipe_page(url: str, host: str) -> RawAcquisition:
    """A pasted recipe-page URL -> `RawAcquisition(blog_recipe=...)`. No LLM.

    The page's schema.org Recipe JSON-LD becomes `blog_recipe`, the same field a
    description-linked blog fills, so `normalize` needs no new input shape. No Recipe,
    or a Recipe with no instructions, raises `NoRecipeFoundError` rather than falling back
    to an LLM over raw HTML (the method must come from the page, never be invented).
    """
    page = fetch_recipe_page(url)
    if page.final_url is None:
        raise RuntimeError(
            "We couldn't open that page. Check the link, or paste the recipe text instead."
        )
    if page.recipe is None or not has_usable_instructions(page.recipe):
        raise NoRecipeFoundError(page.reason or "Recipe has no instructions")
    name = page.recipe.get("name")
    title = name.strip() if isinstance(name, str) and name.strip() else host
    return RawAcquisition(source_url=url, title=title, channel=host, blog_recipe=page.recipe)
