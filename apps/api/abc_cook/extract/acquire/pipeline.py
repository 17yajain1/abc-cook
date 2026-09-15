"""Combines acquisition legs into one `RawAcquisition`. No LLM.

Gap found during the M2.9 s15 checkpoint: `youtube.fetch` (leg 1) and `blog.fetch_recipe`
(leg 2) existed as standalone functions but nothing called leg 2 with leg 1's
description — every real YouTube import fell through to leg 1 alone, even for a video
whose description links to a blog with real Recipe JSON-LD (design doc §4.4/§10.A).
This is the missing orchestration, not a new acquisition leg.

Leg 3 (captions, M2.10) needed no orchestration change here: it lives entirely inside
`youtube.fetch` (leg 1), reading off the same yt-dlp `info` dict. This module still
runs legs 1+3 first, then leg 2 second.
"""

from __future__ import annotations

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire.blog import fetch_recipe, find_candidate_links
from abc_cook.extract.acquire.youtube import fetch as fetch_youtube


def acquire(url: str) -> RawAcquisition:
    """Legs 1+3 (YouTube metadata + captions), then leg 2.

    Leg 2 finds the first description link with Recipe JSON-LD. It is a bonus and
    fails soft by construction (`blog.fetch_recipe` never raises): if no candidate
    link resolves to a Recipe, `blog_recipe` stays None and the description-only
    result from legs 1+3 is returned unchanged.
    """
    raw = fetch_youtube(url)
    if raw.blog_recipe is not None or not raw.description:
        return raw

    for link in find_candidate_links(raw.description):
        recipe = fetch_recipe(link)
        if recipe is not None:
            return raw.model_copy(update={"blog_recipe": recipe})
    return raw
