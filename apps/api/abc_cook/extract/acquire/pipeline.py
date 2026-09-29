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
from abc_cook.extract.acquire.blog import fetch_recipe, find_candidate_links
from abc_cook.extract.acquire.youtube import fetch as fetch_youtube

_SUPPORTED_HOSTS = frozenset({"youtube.com", "youtu.be", "instagram.com"})
"""The only hosts `youtube.fetch`'s yt-dlp-generic leg is actually exercised
against and frozen-fixture-tested for (docs/M2.9 design; shortform-video-import-
plan.md Phase 0 eval). Everything else -- TikTok, Facebook, a blog link pasted
directly as the primary URL, a typo -- is rejected here rather than handed to
yt-dlp."""


def _host_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _is_supported_host(host: str) -> bool:
    return any(
        host == supported or host.endswith(f".{supported}") for supported in _SUPPORTED_HOSTS
    )


def acquire(url: str) -> RawAcquisition:
    """Legs 1+3 (YouTube metadata + captions), then leg 2.

    Leg 2 finds the first description link with Recipe JSON-LD. It is a bonus and
    fails soft by construction (`blog.fetch_recipe` never raises): if no candidate
    link resolves to a Recipe, `blog_recipe` stays None and the description-only
    result from legs 1+3 is returned unchanged.

    Raises:
        RuntimeError: `url`'s host isn't in `_SUPPORTED_HOSTS` (fast, before any
            network call), or `youtube.fetch` itself failed for a supported host.
    """
    host = _host_of(url)
    if not _is_supported_host(host):
        raise RuntimeError(
            f"Unsupported link host {host!r} -- only YouTube and Instagram links "
            "can be imported."
        )
    raw = fetch_youtube(url)
    if raw.blog_recipe is not None or not raw.description:
        return raw

    for link in find_candidate_links(raw.description):
        recipe = fetch_recipe(link)
        if recipe is not None:
            return raw.model_copy(update={"blog_recipe": recipe})
    return raw
