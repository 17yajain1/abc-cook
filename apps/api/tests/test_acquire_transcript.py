"""extract/acquire/transcript.py -- leg 3, caption tracks. No network.

Pure-function unit tests only, matching the tier split in test_acquire.py:
`select_track` and `flatten` need no network at all; `fetch_segments` is exercised
against a monkeypatched `httpx.get` so the json3-parsing/normalization logic is
covered without a real fetch. Live track selection against real videos is a
`@pytest.mark.network` test in test_acquire.py, against the frozen fixtures' sources.
"""

from __future__ import annotations

import httpx
import pytest

from abc_cook.extract.acquire import transcript as transcript_module
from abc_cook.extract.acquire.transcript import (
    TranscriptSegment,
    fetch_segments,
    flatten,
    select_track,
)

# ---------------------------------------------------------------------------
# select_track -- decision 3's order, no network.
# ---------------------------------------------------------------------------


def _json3(url: str) -> list[dict[str, object]]:
    return [{"ext": "json3", "url": url}, {"ext": "vtt", "url": url + ".vtt"}]


def test_manual_in_video_language_wins_over_everything() -> None:
    info = {
        "language": "hi",
        "subtitles": {"hi": _json3("manual-hi"), "en": _json3("manual-en")},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("manual", "hi", "manual-hi")


def test_manual_en_wins_over_auto_when_video_language_has_no_manual_track() -> None:
    info = {
        "language": "hi",
        "subtitles": {"en": _json3("manual-en")},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("manual", "en", "manual-en")


def test_auto_orig_beats_plain_auto_language_key() -> None:
    """The ramen-probe case: `language` metadata says "hi", but the real ASR original
    is under "hi-orig" -- plain "hi" would be a translation into Hindi and must not
    be picked over it."""
    info = {
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {
            "hi-orig": _json3("auto-hi-orig"),
            "hi": _json3("auto-hi-translated"),
        },
    }
    assert select_track(info) == ("auto", "hi", "auto-hi-orig")


def test_auto_language_key_used_when_no_orig_variant_exists() -> None:
    info = {
        "language": "en",
        "subtitles": {},
        "automatic_captions": {"en": _json3("auto-en")},
    }
    assert select_track(info) == ("auto", "en", "auto-en")


def test_auto_en_fallback_when_no_language_specific_track() -> None:
    info = {
        "language": "fr",
        "subtitles": {},
        "automatic_captions": {"en": _json3("auto-en")},
    }
    assert select_track(info) == ("auto", "en", "auto-en")


def test_no_language_key_still_tries_manual_and_auto_en() -> None:
    info = {"subtitles": {}, "automatic_captions": {"en": _json3("auto-en")}}
    assert select_track(info) == ("auto", "en", "auto-en")


def test_never_selects_an_unrelated_translated_auto_language() -> None:
    """Only <lang>-orig, <lang>, and en are ever tried -- a translated "es" or "fr"
    track sitting alongside them (as YouTube always offers) must never be picked."""
    info = {
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {"es": _json3("auto-es"), "fr": _json3("auto-fr")},
    }
    assert select_track(info) is None


def test_nothing_available_returns_none() -> None:
    """The Rasmalai case: a silent video with no caption track at all."""
    info = {"language": "hi", "subtitles": {}, "automatic_captions": {}}
    assert select_track(info) is None


def test_track_without_json3_format_is_skipped() -> None:
    info = {
        "language": "en",
        "subtitles": {"en": [{"ext": "vtt", "url": "manual-en.vtt"}]},
        "automatic_captions": {"en": _json3("auto-en")},
    }
    assert select_track(info) == ("auto", "en", "auto-en")


# ---------------------------------------------------------------------------
# fetch_segments -- json3 parsing + word-boundary normalization. httpx monkeypatched.
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, payload: object, *, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)  # type: ignore[arg-type]

    def json(self) -> object:
        return self._payload


def test_fetch_segments_joins_segs_within_an_event(monkeypatch: pytest.MonkeyPatch) -> None:
    """Real json3 shape: one event's segs are word-fragments of the same line and
    join with no separator."""
    payload = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 2000, "segs": [{"utf8": "Add "}, {"utf8": "salt"}]},
        ]
    }
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _FakeResponse(payload))
    segments = fetch_segments("https://example.test/caps.json3")
    assert segments == [TranscriptSegment(start_sec=0.0, end_sec=2.0, text="Add salt")]


def test_fetch_segments_collapses_internal_whitespace(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "events": [
            {
                "tStartMs": 1000,
                "dDurationMs": 500,
                "segs": [{"utf8": "hello\n"}, {"utf8": "  world"}],
            },
        ]
    }
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _FakeResponse(payload))
    segments = fetch_segments("https://example.test/caps.json3")
    assert segments[0].text == "hello world"


def test_fetch_segments_skips_events_with_no_text(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 1000},  # no "segs" key at all (real json3 has these)
            {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "  "}]},
            {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "real text"}]},
        ]
    }
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _FakeResponse(payload))
    segments = fetch_segments("https://example.test/caps.json3")
    assert len(segments) == 1
    assert segments[0].text == "real text"


def test_fetch_segments_returns_empty_on_http_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(url: str, timeout: float = 15.0) -> _FakeResponse:
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(httpx, "get", _boom)
    assert fetch_segments("https://example.test/caps.json3") == []


def test_fetch_segments_returns_empty_on_bad_status(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=15.0: _FakeResponse({}, status_code=404)
    )
    assert fetch_segments("https://example.test/caps.json3") == []


def test_fetch_segments_returns_empty_on_unparseable_json(monkeypatch: pytest.MonkeyPatch) -> None:
    class _BadJson(_FakeResponse):
        def json(self) -> object:
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _BadJson({}))
    assert fetch_segments("https://example.test/caps.json3") == []


# ---------------------------------------------------------------------------
# flatten -- joining + the char cap. No network.
# ---------------------------------------------------------------------------


def test_flatten_joins_segments_with_a_single_space() -> None:
    segments = [
        TranscriptSegment(start_sec=0, end_sec=1, text="कि"),
        TranscriptSegment(start_sec=1, end_sec=2, text="हम"),
    ]
    text, truncated = flatten(segments)
    assert text == "कि हम"  # event-boundary gap preserved -- never "किहम"
    assert truncated is False


def test_flatten_empty_segments() -> None:
    assert flatten([]) == ("", False)


def test_flatten_under_cap_is_not_truncated() -> None:
    segments = [TranscriptSegment(start_sec=0, end_sec=1, text="short")]
    text, truncated = flatten(segments, cap=100)
    assert text == "short"
    assert truncated is False


def test_flatten_truncates_at_a_segment_boundary() -> None:
    segments = [
        TranscriptSegment(start_sec=0, end_sec=1, text="aaaa"),
        TranscriptSegment(start_sec=1, end_sec=2, text="bbbb"),
        TranscriptSegment(start_sec=2, end_sec=3, text="cccc"),
    ]
    # cap fits "aaaa bbbb" (9 chars) but not " cccc" (14 chars total)
    text, truncated = flatten(segments, cap=10)
    assert text == "aaaa bbbb"
    assert truncated is True
    assert "cccc" not in text


def test_flatten_never_bisects_a_single_oversized_segment() -> None:
    segments = [TranscriptSegment(start_sec=0, end_sec=1, text="x" * 20)]
    text, truncated = flatten(segments, cap=10)
    assert text == ""
    assert truncated is True


def test_transcript_char_cap_is_24000() -> None:
    assert transcript_module.TRANSCRIPT_CHAR_CAP == 24_000
