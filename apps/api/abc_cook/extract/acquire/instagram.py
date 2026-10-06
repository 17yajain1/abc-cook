"""Instagram-specific acquisition fixups. No network, no LLM.

Layered on `youtube.py`'s generic yt-dlp fetch -- Instagram Reels go through that
same leg-1 fetch (see `pipeline.py`'s host allowlist); there is no separate
Instagram fetch path.
"""

from __future__ import annotations

import re

_PLACEHOLDER_TITLE_RE = re.compile(r"^(?:Video|Post) by (\S+)$")
"""yt-dlp's own Instagram extractor synthesizes exactly this shape -- the whole
title, nothing more -- when Instagram gives no real title: `f"Video by {uploader}"`
(or `f"Post by {uploader}"` for image/carousel posts),
`uploader` a single handle-shaped token with no spaces. Confirmed live during the
shortform-video-import Phase 0 eval: 11/11 successfully acquired Instagram Reels had
this placeholder (e.g. "Video by batati.being.batati"). It carries zero
recipe-relevant words and, left as `RawAcquisition.title`, silently breaks
`title.resolve_title`'s grounding check for every import from this host: a correct
model-claimed dish name (e.g. "Lauki Soup") shares no word with "Video by <handle>",
so the claim is rejected as ungrounded and `graph.title` falls back to the useless
placeholder instead -- even though the model got the dish name right. Re-verified
live for this fix: two more real Reels both reproduced the exact same placeholder
shape. Anchored to a single trailing token (`\\S+$`, no free text after) so a
genuine multi-word title that happens to start with "Video by" (e.g. "Video by the
Sea: A Coastal Cooking Story") is never mistaken for it."""


def clean_placeholder_title(title: str, description: str | None) -> str:
    """Replace yt-dlp's synthetic Instagram title with real caption text, if any.

    Only fires on the exact known placeholder shape -- never rewrites a title that
    might be genuine. Falls back to the full `description`, verbatim, not a guessed
    first line: a live Phase 1 check found a real Reel whose first caption line was
    "Tired and Hungry" (a hook, not a title) while the actual dish name ("10-minute
    paneer recipe") was two lines further down -- taking just the first line would
    have invented a *worse* false signal than the placeholder it replaced. Handing
    `resolve_title`'s grounding check the whole caption instead lets it find real
    dish-name words wherever they fall, without this function guessing which words
    those are. If there's no description either, the placeholder is returned
    unchanged -- there is nothing better to offer.

    Args:
        title: `RawAcquisition.title` candidate, as yt-dlp returned it.
        description: The video description/caption, verbatim, or None.

    Returns:
        `description.strip()` when `title` matches the known placeholder shape and a
        non-empty description exists; `title` unchanged otherwise.
    """
    if not _PLACEHOLDER_TITLE_RE.match(title):
        return title
    if description and description.strip():
        return description.strip()
    return title
