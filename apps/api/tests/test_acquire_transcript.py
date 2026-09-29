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
    JUNK_WORD_THRESHOLD,
    TranscriptSegment,
    fetch_segments,
    flatten,
    is_junk_transcript,
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


def test_manual_variant_used_when_exact_manual_key_missing() -> None:
    """A1: link 1's real case -- `language="en"`, manual subtitles include `en-GB`
    but not plain `en`. The creator's own subtitles must win over auto captions."""
    info = {
        "language": "en",
        "subtitles": {"en-GB": _json3("manual-en-gb")},
        "automatic_captions": {"en": _json3("auto-en")},
    }
    assert select_track(info) == ("manual", "en-GB", "manual-en-gb")


def test_manual_variant_tried_for_video_language_before_en() -> None:
    """A1: `language="hi"` with only a `hi-IN` manual track (no plain `hi`, no `en`)
    -- the `hi` variant group is tried before falling through to `en`."""
    info = {
        "language": "hi",
        "subtitles": {"hi-IN": _json3("manual-hi-in")},
        "automatic_captions": {},
    }
    assert select_track(info) == ("manual", "hi-IN", "manual-hi-in")


def test_manual_variant_group_sorted_for_determinism() -> None:
    info = {
        "language": "en",
        "subtitles": {"en-US": _json3("manual-en-us"), "en-GB": _json3("manual-en-gb")},
        "automatic_captions": {},
    }
    assert select_track(info) == ("manual", "en-GB", "manual-en-gb")


def test_no_manual_variant_falls_through_to_auto_path_unchanged() -> None:
    info = {
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("auto", "hi", "auto-hi-orig")


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
    segments, transient_failure = fetch_segments("https://example.test/caps.json3")
    assert segments == [TranscriptSegment(start_sec=0.0, end_sec=2.0, text="Add salt")]
    assert transient_failure is False


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
    segments, _ = fetch_segments("https://example.test/caps.json3")
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
    segments, _ = fetch_segments("https://example.test/caps.json3")
    assert len(segments) == 1
    assert segments[0].text == "real text"


def test_fetch_segments_returns_empty_non_transient_on_connect_timeout_that_never_recovers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A transport error on every attempt (incl. retries) is transient_failure=True --
    distinguishable from a clean 404, per the Phase 0 audit's false-negative finding."""

    def _boom(url: str, timeout: float = 15.0) -> _FakeResponse:
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(httpx, "get", _boom)
    monkeypatch.setattr(transcript_module.time, "sleep", lambda _: None)
    assert fetch_segments("https://example.test/caps.json3") == ([], True)


def test_fetch_segments_returns_empty_non_transient_on_404(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """404 is definitive -- "genuinely nothing here" -- never retried, never
    transient_failure=True. This is the "genuine no-caption" case."""
    calls = []

    def _get(url: str, timeout: float = 15.0) -> _FakeResponse:
        calls.append(url)
        return _FakeResponse({}, status_code=404)

    monkeypatch.setattr(httpx, "get", _get)
    assert fetch_segments("https://example.test/caps.json3") == ([], False)
    assert len(calls) == 1  # never retried -- 404 isn't in _RETRYABLE_STATUS


def test_fetch_segments_returns_empty_non_transient_on_unparseable_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _BadJson(_FakeResponse):
        def json(self) -> object:
            raise ValueError("not json")

    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _BadJson({}))
    assert fetch_segments("https://example.test/caps.json3") == ([], False)


def test_fetch_segments_retries_429_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    """The confirmed Phase 0 case: youtube.com/api/timedtext returns 429 under burst
    traffic, then a real caption track is there on retry -- this must not be lost."""
    payload = {
        "events": [{"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "recovered"}]}]
    }
    responses = iter(
        [
            _FakeResponse({}, status_code=429),
            _FakeResponse({}, status_code=429),
            _FakeResponse(payload),
        ]
    )
    sleeps: list[float] = []
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: next(responses))
    monkeypatch.setattr(transcript_module.time, "sleep", sleeps.append)

    segments, transient_failure = fetch_segments("https://example.test/caps.json3")

    assert transient_failure is False
    assert len(segments) == 1
    assert segments[0].text == "recovered"
    assert len(sleeps) == 2  # backed off before each of the two retries


def test_fetch_segments_429_exhausts_retries_is_transient_not_no_captions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """This is the exact Phase 0 bug: `select_track` found a real track, but every
    fetch attempt was rate-limited. The old code returned `[]` here -- silently
    identical to "no captions ever existed". The fix must make this distinguishable."""
    call_count = 0

    def _always_429(url: str, timeout: float = 15.0) -> _FakeResponse:
        nonlocal call_count
        call_count += 1
        return _FakeResponse({}, status_code=429)

    monkeypatch.setattr(httpx, "get", _always_429)
    monkeypatch.setattr(transcript_module.time, "sleep", lambda _: None)

    segments, transient_failure = fetch_segments("https://example.test/caps.json3", max_retries=2)

    assert segments == []
    assert transient_failure is True  # NOT the same outcome as a genuine 404/no-track case
    assert call_count == 3  # initial attempt + 2 retries, bounded


def test_fetch_segments_respects_max_retries_zero(monkeypatch: pytest.MonkeyPatch) -> None:
    """max_retries=0 makes a single attempt -- no unbounded/aggressive retrying."""
    call_count = 0

    def _always_429(url: str, timeout: float = 15.0) -> _FakeResponse:
        nonlocal call_count
        call_count += 1
        return _FakeResponse({}, status_code=429)

    monkeypatch.setattr(httpx, "get", _always_429)
    segments, transient_failure = fetch_segments("https://example.test/caps.json3", max_retries=0)
    assert (segments, transient_failure) == ([], True)
    assert call_count == 1


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


# ---------------------------------------------------------------------------
# is_junk_transcript -- Phase 1 speech-quality gate. Threshold justified by the
# shortform-video-import Phase 0 eval's real cases: every confirmed-junk transcript
# had <=5 real words; every confirmed-genuine spoken-method transcript had >=129.
# No network.
# ---------------------------------------------------------------------------


def test_junk_word_threshold_is_8() -> None:
    """The exact Phase 0-justified value -- see the constant's docstring."""
    assert JUNK_WORD_THRESHOLD == 8


def test_genuine_transcript_is_not_junk() -> None:
    """A real spoken-method transcript, well above the threshold (Phase 0's shortest
    confirmed-genuine case was 129 words; this is deliberately much shorter than that
    and still clears 8)."""
    text = (
        "First heat oil in a pan then add cumin seeds and let them splutter for a "
        "few seconds before adding the chopped onions and cooking until golden"
    )
    assert is_junk_transcript(text) is False


def test_wrong_language_hallucination_is_junk() -> None:
    """The confirmed Phase 0 case: a 14s clip ASR'd as Norwegian/Danish "Det er et
    stort problem." (5 words) on a video with no spoken recipe content."""
    assert is_junk_transcript("Det er et stort problem.") is True


def test_music_only_tag_is_junk() -> None:
    assert is_junk_transcript("[Music]") is True


def test_music_tag_stripped_before_counting_remaining_words() -> None:
    """A transcript that is mostly a tag plus a couple of stray words must not be
    pushed over the threshold by counting the tag itself as content."""
    assert is_junk_transcript("[Music] la la") is True


def test_empty_text_is_junk() -> None:
    assert is_junk_transcript("") is True


def test_boundary_exactly_at_threshold_is_not_junk() -> None:
    """Exactly `JUNK_WORD_THRESHOLD` real words clears the gate -- the check is
    strictly "fewer than", never "at or below"."""
    text = " ".join(["word"] * JUNK_WORD_THRESHOLD)
    assert len(text.split()) == JUNK_WORD_THRESHOLD
    assert is_junk_transcript(text) is False


def test_boundary_one_below_threshold_is_junk() -> None:
    text = " ".join(["word"] * (JUNK_WORD_THRESHOLD - 1))
    assert is_junk_transcript(text) is True


# ---------------------------------------------------------------------------
# transient_failure must never be read as junk -- that distinction is
# youtube.fetch's job (see test_acquire.py), but is_junk_transcript itself is only
# ever called on text that was actually fetched, never on a transient-failure
# result -- documented here so the invariant has a test next to the function, not
# only at the integration point.
# ---------------------------------------------------------------------------


def test_transient_failure_never_reaches_the_junk_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """A fetch that exhausts its retry budget returns `([], True)` -- empty segments,
    so `flatten` produces `("", False)` and the empty text short-circuits before
    `is_junk_transcript` is ever consulted (see youtube.py's `if text and ...`)."""

    def _always_429(url: str, timeout: float = 15.0) -> object:
        class _Resp:
            status_code = 429

        return _Resp()

    monkeypatch.setattr(httpx, "get", _always_429)
    monkeypatch.setattr(transcript_module.time, "sleep", lambda _: None)

    segments, transient_failure = fetch_segments("https://example.test/caps.json3")
    text, _truncated = flatten(segments)

    assert transient_failure is True
    assert text == ""  # nothing for is_junk_transcript to see -- the gate never fires
