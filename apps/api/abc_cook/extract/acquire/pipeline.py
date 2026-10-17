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

import logging
import time
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlparse

from abc_cook.extract.acquire import MetadataCallback, RawAcquisition
from abc_cook.extract.acquire.blog import (
    NoRecipeFoundError,
    RecipePage,
    count_links,
    fetch_recipe_page,
    find_candidate_links,
    has_usable_instructions,
    refuse_redirect_host,
)
from abc_cook.extract.acquire.youtube import fetch as fetch_youtube

_logger = logging.getLogger(__name__)

LINK_TIMEOUT_S = 8.0
"""Wall-clock cap on one description-link probe (DNS, redirects and body together)."""

PROBE_BUDGET_S = 10.0
"""Wall-clock cap on the whole probe stage, however many candidates remain."""

_PROBE_WORKERS = 4
_probe_executor = ThreadPoolExecutor(max_workers=_PROBE_WORKERS, thread_name_prefix="link-probe")
"""One module-level pool shared by every job, never a pool per call. It lets the caller stop
*waiting* on a link at its deadline, which httpx timeouts cannot do for a blocking
`getaddrinfo`. An abandoned link is not killed: its thread runs on until its own timeouts
expire, possibly after the stage or the import has ended, and its result is discarded."""

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


ProbeFetch = Callable[[str, float], RecipePage]
"""`(link, deadline) -> RecipePage`; `deadline` is a `time.monotonic()` value."""


@dataclass(frozen=True)
class ProbeReport:
    """What `probe_links` did: the recipe (if any) and one entry per link started."""

    recipe: dict[str, Any] | None
    final_url: str | None
    entries: tuple[tuple[str, str, float], ...]
    """`(link, outcome, seconds)`; outcome is `recipe`, or the reason the link yielded none."""
    stopped: Literal["found", "exhausted", "budget"]
    abandoned: int
    """Links whose worker thread was still running when we stopped waiting."""


def probe_fetch(url: str, deadline: float) -> RecipePage:
    """The default `ProbeFetch`: the SSRF-guarded fetch, bounded and redirect-filtered."""
    return fetch_recipe_page(
        url, allow_http=True, deadline=deadline, refuse_host=refuse_redirect_host
    )


def probe_links(
    candidates: Sequence[str],
    *,
    link_timeout_s: float = LINK_TIMEOUT_S,
    budget_s: float = PROBE_BUDGET_S,
    fetch: ProbeFetch | None = None,
    excluded: int = 0,
) -> ProbeReport:
    """Try `candidates` one at a time, in order, until one carries a Recipe.

    Each link gets `min(link_timeout_s, time left in the stage)`, so the stage cap is hard:
    the whole call returns within `budget_s` plus scheduling slack. A link past its deadline
    is recorded as `link timeout` and its worker abandoned (see `_probe_executor`). Never
    raises. Logs one INFO line.

    Args:
        candidates: Links in the order to try them.
        link_timeout_s: Cap on a single link.
        budget_s: Cap on the whole stage.
        fetch: Overrides `probe_fetch` (tests).
        excluded: How many links the scan dropped, for the log line only.
    """
    probe = fetch if fetch is not None else probe_fetch
    started = time.monotonic()
    stage_deadline = started + budget_s
    entries: list[tuple[str, str, float]] = []
    recipe: dict[str, Any] | None = None
    final_url: str | None = None
    stopped: Literal["found", "exhausted", "budget"] = "exhausted"
    abandoned = 0
    for link in candidates:
        t0 = time.monotonic()
        if t0 >= stage_deadline:
            stopped = "budget"
            break
        deadline = min(t0 + link_timeout_s, stage_deadline)
        future = _probe_executor.submit(probe, link, deadline)
        try:
            page = future.result(timeout=max(deadline - time.monotonic(), 0.0))
        except FutureTimeoutError:
            if not future.cancel():  # False: it is running (or finished), not merely queued
                abandoned += 1
            entries.append((link, "link timeout", round(time.monotonic() - t0, 3)))
            if deadline >= stage_deadline:
                stopped = "budget"
                break
            continue
        except Exception as exc:  # a fetch fn that raises must not fail the import
            entries.append((link, f"error: {type(exc).__name__}", round(time.monotonic() - t0, 3)))
            continue
        seconds = round(time.monotonic() - t0, 3)
        if page.recipe is not None:
            entries.append((link, "recipe", seconds))
            recipe, final_url, stopped = page.recipe, page.final_url, "found"
            break
        entries.append((link, page.reason or "no recipe", seconds))
    elapsed = time.monotonic() - started
    found_host = _host_of(final_url) if final_url else "none"
    _logger.info(
        "probe: candidates=%d excluded=%d probed=%d abandoned=%d stopped=%s found=%s elapsed=%.1f",
        len(candidates),
        excluded,
        len(entries),
        abandoned,
        stopped,
        found_host,
        elapsed,
    )
    return ProbeReport(recipe, final_url, tuple(entries), stopped, abandoned)


def _host_of(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _host_in(host: str, hosts: frozenset[str]) -> bool:
    return any(host == h or host.endswith(f".{h}") for h in hosts)


def acquire(url: str, *, on_metadata: MetadataCallback | None = None) -> RawAcquisition:
    """Legs 1+3 (YouTube metadata + captions), then leg 2.

    Leg 2 finds the first description link with Recipe JSON-LD. It is a bonus and
    fails soft by construction (`blog.fetch_recipe` never raises): if no candidate
    link resolves to a Recipe, `blog_recipe` stays None and the description-only
    result from legs 1+3 is returned unchanged.

    Any other https URL is treated as a recipe page (`_acquire_recipe_page`).

    `on_metadata` fires once, right after yt-dlp returns and before captions and link
    probing, so the caller can show the source early. A pasted recipe page has no early
    phase and never calls it.

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
    raw = fetch_youtube(url) if on_metadata is None else fetch_youtube(url, on_metadata=on_metadata)
    if raw.blog_recipe is not None or not raw.description:
        return raw

    candidates = find_candidate_links(raw.description)
    excluded = max(count_links(raw.description) - len(candidates), 0)
    report = probe_links(candidates, excluded=excluded)
    if report.recipe is not None:
        return raw.model_copy(update={"blog_recipe": report.recipe})
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
