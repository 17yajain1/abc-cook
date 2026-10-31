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
    JUNK_MIN_TOKENS,
    TranscriptSegment,
    fetch_segments,
    flatten,
    is_junk_transcript,
    junk_reason,
    select_track,
    signal_hits,
    strip_junk_tags,
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
    """Ruling A. Was: ("manual", "en", "manual-en") -- manual `en` beat the Hindi video's own
    auto `hi-orig`. Now: the original speech's captions win; a manual track in another
    language is only a fallback (see the "wins when no -orig" test below)."""
    info = {
        "language": "hi",
        "subtitles": {"en": _json3("manual-en")},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("auto", "hi", "auto-hi-orig")


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


def test_bare_auto_en_is_never_a_fallback_for_another_language() -> None:
    """Was: a `fr` video with only auto `en` returned ("auto", "en", ...). A bare auto `en`
    next to a non-English video is a machine translation, so it is no longer chosen."""
    info = {
        "language": "fr",
        "subtitles": {},
        "automatic_captions": {"en": _json3("auto-en")},
    }
    assert select_track(info) is None


def test_unknown_language_never_takes_a_plain_auto_key() -> None:
    """Was: no `language` + plain auto `en` returned ("auto", "en", ...). With the language
    unknown only a `-orig` track is trustworthy; the plain key may be a translation."""
    info = {"subtitles": {}, "automatic_captions": {"en": _json3("auto-en")}}
    assert select_track(info) is None


def test_unknown_language_takes_the_single_orig_track() -> None:
    info = {
        "subtitles": {},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig"), "en": _json3("auto-en")},
    }
    assert select_track(info) == ("auto", "hi", "auto-hi-orig")


def test_unknown_language_with_several_orig_tracks_picks_none() -> None:
    """Several `-orig` keys and no language: some may be dubs, so none is chosen."""
    info = {
        "subtitles": {},
        "automatic_captions": {"hi-orig": _json3("a"), "en-orig": _json3("b")},
    }
    assert select_track(info) is None


def test_known_language_without_its_orig_never_takes_another_languages_orig() -> None:
    """Ruling A step 4 is "nothing": the lone-`-orig` shortcut is for an UNKNOWN language only.
    (Earlier in this PR this returned ("auto", "en", ...).)"""
    info = {
        "language": "fr",
        "subtitles": {},
        "automatic_captions": {"en-orig": _json3("auto-en-orig")},
    }
    assert select_track(info) is None


def test_lone_orig_step_does_not_fire_when_the_spoken_language_has_an_orig() -> None:
    info = {
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {"hi-orig": _json3("hi"), "en-orig": _json3("en")},
    }
    assert select_track(info) == ("auto", "hi", "hi")


def test_regional_language_tries_the_base_orig() -> None:
    """Frozen link 5's shape: language `en-US`, only `en-orig` (no `en-US-orig`), plus a
    plain translated `en` that must lose."""
    info = {
        "language": "en-US",
        "subtitles": {},
        "automatic_captions": {"en-orig": _json3("auto-en-orig"), "en": _json3("auto-en")},
    }
    assert select_track(info) == ("auto", "en", "auto-en-orig")


def test_manual_other_language_loses_to_orig() -> None:
    """Link 5's shape (ruling A): a creator Hindi track on an English video loses to the
    spoken language's own `en-orig`. (Earlier in this PR the manual `hi` won.)"""
    info = {
        "language": "en-US",
        "subtitles": {"hi": _json3("manual-hi")},
        "automatic_captions": {"en-orig": _json3("auto-en-orig")},
    }
    assert select_track(info) == ("auto", "en", "auto-en-orig")


def test_manual_other_language_wins_when_no_orig_for_the_spoken_language() -> None:
    """No `en-US-orig` / `en-orig`; the only plain `en` is a `tlang=` translation, so step 2
    yields nothing and the creator's Hindi track is the fallback. A foreign `hi-orig` does
    not count as an `-orig` for the spoken language."""
    info = {
        "language": "en-US",
        "subtitles": {"hi": _json3("manual-hi")},
        "automatic_captions": {
            "hi-orig": _json3("auto-hi-orig"),
            "en": _json3("https://x.test/t?lang=en&tlang=en"),
        },
    }
    assert select_track(info) == ("manual", "hi", "manual-hi")


def test_manual_other_language_wins_over_nothing_when_no_auto_at_all() -> None:
    info = {"language": "hi", "subtitles": {"en": _json3("manual-en")}, "automatic_captions": {}}
    assert select_track(info) == ("manual", "en", "manual-en")


def test_unknown_language_with_no_orig_at_all_takes_a_manual_track() -> None:
    info = {"subtitles": {"hi": _json3("manual-hi")}, "automatic_captions": {}}
    assert select_track(info) == ("manual", "hi", "manual-hi")


def test_unknown_language_with_several_orig_keys_does_not_fall_to_a_manual_track() -> None:
    info = {
        "subtitles": {"hi": _json3("manual-hi")},
        "automatic_captions": {"hi-orig": _json3("a"), "en-orig": _json3("b")},
    }
    assert select_track(info) is None


def test_en_us_prefers_en_orig_over_translated_en() -> None:
    info = {
        "language": "en-US",
        "subtitles": {},
        "automatic_captions": {
            "en-orig": _json3("https://x.test/t?lang=en"),
            "en": _json3("https://x.test/t?lang=en&tlang=en"),
        },
    }
    assert select_track(info) == ("auto", "en", "https://x.test/t?lang=en")


def test_manual_in_the_listed_language_outranks_manual_in_another() -> None:
    info = {
        "language": "hi",
        "subtitles": {"bn": _json3("manual-bn"), "hi": _json3("manual-hi")},
        "automatic_captions": {},
    }
    assert select_track(info) == ("manual", "hi", "manual-hi")


def test_translated_url_is_never_chosen() -> None:
    """A `tlang=` URL is a machine translation: skipped at every step, so `-orig` wins."""
    info = {
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {
            "hi": _json3("https://x.test/api/timedtext?lang=hi&tlang=hi&v=1"),
            "hi-orig": _json3("https://x.test/api/timedtext?lang=hi&v=1"),
        },
    }
    assert select_track(info) == ("auto", "hi", "https://x.test/api/timedtext?lang=hi&v=1")


def test_only_a_translated_url_available_returns_none() -> None:
    info = {
        "language": "en",
        "subtitles": {},
        "automatic_captions": {"en": _json3("https://x.test/t?lang=en&tlang=en")},
    }
    assert select_track(info) is None


def test_plain_auto_key_used_when_language_known_and_not_translated() -> None:
    info = {"language": "en", "subtitles": {}, "automatic_captions": {"en": _json3("auto-en")}}
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


def test_junk_min_tokens_is_3() -> None:
    """Was `JUNK_WORD_THRESHOLD == 8` (regex "words"). Now fewer than 3 whitespace tokens."""
    assert JUNK_MIN_TOKENS == 3


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


def test_boundary_exactly_at_min_tokens_with_a_signal_is_not_junk() -> None:
    """Was: 8 filler words cleared the gate. Now 3 tokens clear the length rule, and the
    cooking-signal rule decides; "2 cups water" has a quantity and a unit."""
    text = "2 cups water"
    assert len(text.split()) == JUNK_MIN_TOKENS
    assert junk_reason(text) is None


def test_boundary_one_below_min_tokens_is_junk_even_with_a_signal() -> None:
    assert junk_reason("2 cups") == "too_short"
    assert junk_reason("[Music] हाँ") == "too_short"


def test_long_text_without_a_signal_is_junk() -> None:
    """Was kept at 8+ words. Length alone no longer keeps a transcript."""
    assert junk_reason(" ".join(["word"] * 40)) == "no_cooking_signal"


def test_no_upper_cap_a_long_signal_free_transcript_is_still_junk() -> None:
    assert is_junk_transcript("la " * 500) is True


@pytest.mark.parametrize(
    "tag", ["[Music]", "[संगीत]", "[Applause]", "[música]", "[音楽]", "[موسيقى]", "[MUSIC]"]
)
def test_multilingual_non_speech_tags_are_stripped(tag: str) -> None:
    assert strip_junk_tags(f"a {tag} b").split() == ["a", "b"]


def test_unknown_bracketed_tag_is_not_stripped() -> None:
    assert "[Whistling]" in strip_junk_tags("add [Whistling] salt")


@pytest.mark.parametrize(
    "text",
    [
        "दो प्याज़ मिला दें",  # number word within 3 tokens before a weak stem
        "दो कप पानी मिलाएं",  # unit alone is enough
        "2 चम्मच चीनी डालें",  # digit + unit + strong stem
        "25 ग्राम चीनी",  # digits and a unit, no verb at all
        "10 मिनट तक पकाएं",
        "add salt now",
        "तेल डाल दें",  # डाल + दें
        "पैन में तेल डालकर",  # exact verb form
        "बर्तन में नमक डाल कर",  # डाल + कर
        "पैन गरम करें",  # borrowed verb + कर-family
        "ओवन को बेक करके",  # borrowed verb + कर-family
        "दो कली लहसुन",  # counted unit after a number word
        "2 कली लहसुन",  # counted unit after a digit
        "दो मिनट तक",  # time unit after a number word
        "chopped onions and fried garlic",  # English inflections
        "grating the cheese now",
        "he baked it at 180",
    ],
)
def test_real_cooking_speech_is_kept(text: str) -> None:
    assert junk_reason(text) is None, signal_hits(text)


@pytest.mark.parametrize(
    "text",
    [
        "दो पल के लिए तुम मिले",  # number word is more than 3 tokens before the weak stem
        "तुम मिले तो दिल मिला प्यार मिला",  # love lyric: only weak stems, no second signal
        "Det er et stort problem.",
        "la la la la",
        "eu vou sofrer sem você meu sofrimento é grande",  # Portuguese lyric: sofrer / sofrimento
        "फूलों की डाली",  # डाली = "branch"
        "गरमी का मौसम बेकार",  # गरमी / बेकार
        "कली कली खिल गई",  # lyric: कली = "flower bud", no number before it
        "मिनट मिनट याद आया",  # time unit with no number before it
        "I am so grateful for your temper",  # grateful / temper
        "roll the dice you addicted drained soul",  # dice / addicted / drained
        "the daily grind and the sizzle",  # grind / sizzle are weak
        "this mixture is cute",  # mixture / cute are not mix / cut
        "ये कहना गंगा कह दो ना मैं शर्मा के कह दूंगी मैंने भी दिल दिया आंखों का मसला",  # मसला = "issue"
        "वो बेकार बेकरार दिल गरमी में डाली से टूटा",  # बेक/गरम/डाल prefix everyday words
        "तुम्हारा मसलन ये काटा हुआ वक़्त",  # मसलन = "for example"
    ],
)
def test_lyrics_and_unrelated_speech_are_dropped(text: str) -> None:
    assert junk_reason(text) == "no_cooking_signal", signal_hits(text)


def test_digits_count_in_every_script() -> None:
    assert signal_hits("मुझे २ चाहिए").quantities == 1
    assert signal_hits("½ cup").quantities == 1
    assert signal_hits("25g").quantities == 1


def test_one_is_not_a_number_word_for_a_weak_stem() -> None:
    assert junk_reason("एक पल को तुम मिले") == "no_cooking_signal"
    assert junk_reason("one day we met mix") == "no_cooking_signal"


def test_number_word_must_be_within_three_tokens_before_the_weak_stem() -> None:
    assert junk_reason("two a b mix") is None  # distance 3
    assert junk_reason("two a b c mix") == "no_cooking_signal"  # distance 4
    assert junk_reason("mix two things") == "no_cooking_signal"  # after, not before


def test_weak_stem_alone_is_not_a_signal() -> None:
    assert junk_reason("mix mix mix") == "no_cooking_signal"
    hits = signal_hits("mix mix mix")
    assert (hits.weak_unconfirmed, hits.weak_confirmed) == (3, 0)


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


# ---------------------------------------------------------------------------
# bot-check page: a 200 that is not JSON but says "confirm you're not a bot" is a
# transient block (Q4), not "this video has no captions".
# ---------------------------------------------------------------------------


class _HtmlResp:
    status_code = 200

    def __init__(self, body: str) -> None:
        self.text = body

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        raise ValueError("not json")


def test_bot_check_page_is_a_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    body = "<html>Sign in to confirm you’re not a bot</html>"
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _HtmlResp(body))
    assert fetch_segments("https://example.test/c") == ([], True)


def test_unparseable_non_bot_page_is_not_transient(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _HtmlResp("<html>hello</html>"))
    assert fetch_segments("https://example.test/c") == ([], False)


def test_dal_is_strong_only_in_verb_forms() -> None:
    assert signal_hits("तेल डाल दें").strong == 1
    assert signal_hits("तेल डालें").strong == 1
    assert signal_hits("फूलों की डाली").strong == 0
    assert signal_hits("डालर में बात").strong == 0
    assert signal_hits("डाल रही थी").strong == 0  # डाल followed by an unlisted token


def test_borrowed_verb_needs_a_kar_family_token_next() -> None:
    assert signal_hits("पैन गरम करें").strong == 1
    assert signal_hits("गरम पानी").strong == 0
    assert signal_hits("गरमी करें की").strong == 0
    assert signal_hits("बेकार करें की").strong == 0


def test_container_and_time_units_count_only_after_a_number() -> None:
    assert signal_hits("दो कली लहसुन").units == 1
    assert signal_hits("कली कली खिल गई").units == 0
    assert signal_hits("कली कली खिल गई").units_unconfirmed == 2
    assert signal_hits("एक कली लहसुन").units == 0  # एक is not a number word
    assert signal_hits("500 ग्राम आटा").units == 1  # weights count alone
    assert signal_hits("चुटकी भर नमक").units == 1  # pinch counts alone


def test_english_stems_match_inflections_not_prefixes() -> None:
    for word in ("added", "adds", "adding", "chopped", "chopping", "fried", "fries", "frying",
                 "grated", "grating", "baking", "baked", "sprinkled", "minced"):
        assert signal_hits(f"we {word} it").strong == 1, word
    for word in ("grateful", "addicted", "address", "temperature", "mixture", "cute", "heater"):
        hits = signal_hits(f"we {word} it")
        assert hits.strong == 0 and hits.weak_confirmed == 0, word


def test_unknown_language_single_orig_defines_the_spoken_language_for_manual_tracks() -> None:
    """Amendment 5: spoken language = the single -orig key's language when `language` is
    missing, so a manual track in THAT language (step 1) outranks the auto -orig."""
    info = {
        "subtitles": {"hi": _json3("manual-hi")},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("manual", "hi", "manual-hi")


def test_unknown_language_single_orig_beats_a_manual_track_in_another_language() -> None:
    info = {
        "subtitles": {"en": _json3("manual-en")},
        "automatic_captions": {"hi-orig": _json3("auto-hi-orig")},
    }
    assert select_track(info) == ("auto", "hi", "auto-hi-orig")


def test_derived_spoken_language_never_trusts_a_plain_auto_key() -> None:
    """Only a LISTED language makes the plain auto key trustworthy; a derived one does not."""
    info = {"subtitles": {}, "automatic_captions": {"en": _json3("auto-en")}}
    assert select_track(info) is None


def test_no_track_is_ever_taken_from_a_tlang_url_whatever_the_language_source() -> None:
    translated = "https://x.test/t?lang=hi&tlang=hi"
    info = {"subtitles": {"hi": _json3(translated)}, "automatic_captions": {}}
    assert select_track(info) is None


def test_seconds_are_a_time_unit_counted_only_after_a_number() -> None:
    assert signal_hits("दो सेकंड रुकें").units == 1
    assert signal_hits("सेकंड सेकंड सेकंड").units == 0
    assert junk_reason("सेकंड सेकंड सेकंड") == "no_cooking_signal"


def test_long_signal_free_text_is_junk_with_no_token_cap() -> None:
    """Amendment 6: no ~60-token cut. A long lyric stays junk; a long transcript with a
    measurement unit stays kept."""
    assert junk_reason("la la la tum hi ho " * 100) == "no_cooking_signal"
    assert junk_reason("la la la tum hi ho " * 100 + "ek 25 gram") is None


def test_sofr_is_weak_so_suffering_is_not_a_cooking_signal() -> None:
    hits = signal_hits("vou sofrer com o sofrimento")
    assert hits.strong == 0 and hits.weak_unconfirmed == 2


def test_only_decimal_digits_and_vulgar_fractions_are_quantities() -> None:
    from abc_cook.extract.acquire.transcript import _has_quantity

    for token in ("2", "25g", "२", "०", "½", "⅓", "¾", "⅕", "1/2"):
        assert _has_quantity(token), token
    for token in ("一", "二", "十", "万", "Ⅻ", "①", "²", "④", "word"):
        assert not _has_quantity(token), token


def test_cjk_lyric_with_numerals_is_dropped() -> None:
    text = "一緒に二人で 歩こう 十 万 夢"
    assert signal_hits(text).quantities == 0
    assert junk_reason(text) == "no_cooking_signal"


def test_devanagari_digit_and_fraction_quantities_are_kept() -> None:
    assert junk_reason("२ कप पानी") is None  # २ = 2
    assert junk_reason("½ tsp salt") is None
    assert signal_hits("① ② song").quantities == 0
