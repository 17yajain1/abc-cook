"""Leg 3: YouTube caption tracks (manual subtitles or auto-captions). No LLM.

Reuses the same yt-dlp `extract_info` call leg 1 (`youtube.py`) already makes -- the
caption track URLs are already on that `info` dict, so this needs no new dependency
(`httpx` is already a project dependency, used by leg 2's `blog.py`).

See docs/M2.10 plan, binding decisions 2-5. Track selection is deterministic and
happens here, never left to the model (decision 3). Auto-caption event boundaries can
glue adjacent words together with no space between them -- observed live on the ramen
probe video, Hindi "कि" + "हम" arriving as one glued "किहम" -- which would silently
break `graph.py`'s verbatim-substring cue verification downstream if not normalized
here (`fetch_segments`/`flatten`).
"""

from __future__ import annotations

import re
import time
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

TRANSCRIPT_CHAR_CAP = 24_000
"""Binding decision 5. Past this, `flatten` truncates at a segment boundary and
reports it -- a module constant, not a function default, so callers can't drift."""

_FETCH_TIMEOUT_SEC = 15.0
_WHITESPACE = re.compile(r"\s+")

_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
"""Statuses worth a bounded retry -- rate-limited or momentarily unavailable, not
"this doesn't exist" (404) or "this request is wrong" (4xx otherwise)."""
_MAX_RETRIES = 2
_RETRY_BACKOFF_SEC = 0.5
"""Fixed, small backoff (0.5s, 1.0s) -- bounded total added latency (~1.5s worst
case) on the rare transient-failure path; zero added latency on the normal path.
Not exponential/jittered -- that's more machinery than this failure mode has earned
(shortform-video-import-plan.md Phase 1 audit: "do not introduce aggressive retries
or a broad networking redesign")."""


class TranscriptSegment(BaseModel):
    """One caption event, before flattening. Transient -- extract-internal only.

    Stored on `RawAcquisition` for a future "watch this step" / duration-corroboration
    feature (deferred, see the M2.10 plan); the LLM itself only ever sees the flattened
    text from `flatten`, never these segments directly.
    """

    start_sec: float = Field(description="Segment start, seconds from video start.")
    end_sec: float = Field(description="Segment end, seconds from video start.")
    text: str = Field(description="Segment text, whitespace-normalized.")


def _json3_url(pool: dict[str, Any], key: str) -> str | None:
    """The `json3`-format URL for `key` in a `subtitles`/`automatic_captions` pool."""
    formats = pool.get(key)
    if not formats:
        return None
    for fmt in formats:
        if isinstance(fmt, dict) and fmt.get("ext") == "json3":
            url = fmt.get("url")
            return url if isinstance(url, str) else None
    return None


def select_track(info: dict[str, Any]) -> tuple[Literal["manual", "auto"], str, str] | None:
    """Pick one caption track from a yt-dlp `info` dict. Deterministic, no LLM.

    Order (binding decision 3, extended by A1): manual subtitles in the video's own
    `language`, then manual `en`; failing that, manual variants whose base language
    matches (`<lang>-*`, then `en-*`, each group sorted for determinism -- e.g. a
    creator's `en-GB` track when only plain `en` was tried); failing that,
    auto-captions `<lang>-orig`, then `<lang>`, then auto `en`. `<lang>-orig` is tried
    before plain `<lang>` because YouTube's own `language` metadata can be wrong or
    absent, and when it is, the plain `<lang>` auto-caption key may itself be a machine
    *translation* of a different spoken language rather than the original ASR
    transcript -- exactly what happened to the ramen probe video. No other auto-caption
    language is ever tried: every other key in `automatic_captions` is a translation,
    and translated ASR is a double degradation the design doc's "never invent" rule
    can't absorb. The auto pass's `-orig` guard is unrelated to the manual-variant
    widening above and is not loosened.

    Args:
        info: the yt-dlp `extract_info` result for one video.

    Returns:
        `(kind, lang, json3_url)`, `kind` one of `"manual"`/`"auto"`, or `None` if no
        `json3`-format track exists on any tried key.
    """
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    lang = info.get("language") or None

    manual_keys = [lang, "en"] if lang else ["en"]
    for key in dict.fromkeys(manual_keys):  # dedupe, keep order
        url = _json3_url(manual, key)
        if url:
            return "manual", key, url

    variant_prefixes = [lang, "en"] if lang else ["en"]
    for prefix in dict.fromkeys(variant_prefixes):
        for key in sorted(k for k in manual if k.startswith(f"{prefix}-")):
            url = _json3_url(manual, key)
            if url:
                return "manual", key, url

    auto_keys = [f"{lang}-orig", lang] if lang else []
    auto_keys.append("en")
    for key in dict.fromkeys(auto_keys):
        url = _json3_url(auto, key)
        if url:
            clean_lang = key.removesuffix("-orig")
            return "auto", clean_lang, url

    return None


def fetch_segments(
    url: str, *, timeout: float = _FETCH_TIMEOUT_SEC, max_retries: int = _MAX_RETRIES
) -> tuple[list[TranscriptSegment], bool]:
    """GET a `json3` caption track and parse it into segments. Never raises.

    A missing or broken transcript degrades the source set by one leg, never the
    import -- mirrors `blog.fetch_recipe`'s fail-soft contract. Segment text joins that
    event's `segs[].utf8` fragments with `""` (they are word-parts of the same line)
    and collapses internal whitespace; the space *between* segments that fixes glued
    event boundaries is added later, at `flatten` time.

    Retries up to `max_retries` times, with a short fixed backoff, on a *retryable*
    failure (429/5xx status, or a transport-level error like a timeout) before giving
    up -- YouTube's caption endpoint (`timedtext`) rate-limits under burst traffic,
    confirmed live during the shortform-video-import Phase 0 eval: 7 of 14 probed
    videos had a real caption track that a bare `except httpx.HTTPError: return []`
    turned into "no transcript", indistinguishable from the 7 that genuinely had none.
    A *definitive* failure (404, or any other non-retryable status; malformed JSON)
    still degrades silently on the first try, same as before -- that really does mean
    "there is nothing usable here," not "ask again."

    Returns:
        `(segments, transient_failure)`. `transient_failure` is True only when every
        attempt exhausted the retry budget on a retryable status/transport error --
        never True for a clean 404 or an unparseable response. Callers should surface
        `transient_failure` (e.g. as a warning) rather than silently reading an empty
        `segments` list as "this video has no captions" when it's True.
    """
    response: httpx.Response | None = None
    for attempt in range(max_retries + 1):
        try:
            candidate = httpx.get(url, timeout=timeout)
        except httpx.TransportError:
            candidate = None
        if candidate is not None and candidate.status_code not in _RETRYABLE_STATUS:
            response = candidate
            break
        if attempt < max_retries:
            time.sleep(_RETRY_BACKOFF_SEC * (attempt + 1))
    else:
        return [], True  # every attempt hit a retryable status or transport error

    assert response is not None  # guaranteed by the for/else above on a normal exit
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError:
        return [], False  # a definitive non-retryable status (e.g. 404): genuinely nothing here
    try:
        data = response.json()
    except ValueError:
        return [], False
    if not isinstance(data, dict):
        return [], False

    segments: list[TranscriptSegment] = []
    for event in data.get("events") or []:
        if not isinstance(event, dict):
            continue
        start_ms = event.get("tStartMs")
        if not isinstance(start_ms, int | float):
            continue
        segs = event.get("segs") or []
        text = _WHITESPACE.sub(
            " ", "".join(seg.get("utf8", "") for seg in segs if isinstance(seg, dict))
        ).strip()
        if not text:
            continue
        duration_ms = event.get("dDurationMs") or 0
        segments.append(
            TranscriptSegment(
                start_sec=start_ms / 1000,
                end_sec=(start_ms + duration_ms) / 1000,
                text=text,
            )
        )
    return segments, False


def flatten(
    segments: list[TranscriptSegment], cap: int = TRANSCRIPT_CHAR_CAP
) -> tuple[str, bool]:
    """Join segment texts with a single space; truncate at `cap` chars if needed.

    Truncation always backs up to the last whole segment that fits, so the flattened
    text never bisects a word mid-caption -- a truncated transcript may still lose the
    finish, which is why `review_recommended` is not forced from this alone (decision
    5); the existing invariant checks in `graph.py` decide that independently.

    Returns:
        `(text, truncated)`.
    """
    if not segments:
        return "", False

    full_text = " ".join(segment.text for segment in segments)
    if len(full_text) <= cap:
        return full_text, False

    kept: list[str] = []
    length = 0
    for segment in segments:
        addition = len(segment.text) + (1 if kept else 0)  # +1 for the joining space
        if length + addition > cap:
            break
        kept.append(segment.text)
        length += addition
    return " ".join(kept), True
