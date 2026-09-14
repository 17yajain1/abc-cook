"""Leg 1: YouTube video metadata via yt-dlp, plus chapter-line parsing. No LLM.

See docs/M2.9-youtube-import-design.md §4.4. `yt-dlp` fetches public page metadata the
same way the official player does — this is the one file that changes if it proves
brittle and the swap to the official YouTube Data API v3 becomes necessary.
"""

from __future__ import annotations

import re

import yt_dlp

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.schema.normalized import NormalizedChapter

_TIMESTAMP = r"\d{1,2}(?::\d{2}){1,2}"
_CHAPTER_TS_FIRST = re.compile(rf"^\s*({_TIMESTAMP})\s*[-:]?\s+(.+?)\s*$")
_CHAPTER_LABEL_FIRST = re.compile(rf"^\s*(.+?)\s+({_TIMESTAMP})\s*$")
"""Real descriptions use both orders — YouTube's own auto-chapter format is
`0:00 Label`, but a creator writing chapters as free text may reverse it
(`Marination 0:57`, observed verbatim in a real Step 0 description). Neither is
assumed; both are tried per line (design doc §11)."""


def _match_chapter_line(line: str) -> tuple[int, str] | None:
    """`(start_sec, label)` for one line, trying timestamp-first then label-first."""
    match = _CHAPTER_TS_FIRST.match(line)
    if match is not None:
        return _parse_timestamp(match.group(1)), match.group(2).strip()
    match = _CHAPTER_LABEL_FIRST.match(line)
    if match is not None:
        return _parse_timestamp(match.group(2)), match.group(1).strip()
    return None


def _parse_timestamp(text: str) -> int:
    """`"1:02:03"` or `"2:41"` -> seconds."""
    parts = [int(p) for p in text.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    hours, minutes, seconds = parts
    return hours * 3600 + minutes * 60 + seconds


def parse_chapters(description: str) -> list[NormalizedChapter]:
    """Parse creator-authored chapter markers from a video description.

    Requires at least two ascending timestamped lines to call it a chapter list — a
    single stray "0:00 something" isn't a chapter marker on its own. Never raises: a
    description with no chapter lines simply yields an empty list.
    """
    entries: list[tuple[int, str]] = []
    for line in description.splitlines():
        matched = _match_chapter_line(line)
        if matched is None:
            continue
        entries.append(matched)
    if len(entries) < 2:
        return []

    entries.sort(key=lambda entry: entry[0])
    chapters: list[NormalizedChapter] = []
    for index, (start_sec, label) in enumerate(entries):
        end_sec = entries[index + 1][0] if index + 1 < len(entries) else None
        chapters.append(NormalizedChapter(label=label, start_sec=start_sec, end_sec=end_sec))
    return chapters


def fetch(url: str) -> RawAcquisition:
    """Fetch title/channel/description/chapters for `url`. No LLM.

    Raises:
        RuntimeError: yt-dlp could not extract metadata for `url`.
    """
    ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info is None:
        raise RuntimeError(f"yt-dlp returned no data for {url}")

    description = info.get("description")
    return RawAcquisition(
        source_url=url,
        title=info.get("title", ""),
        channel=info.get("channel") or info.get("uploader"),
        description=description,
        chapters=parse_chapters(description) if description else [],
        video_duration_sec=info.get("duration"),
    )
