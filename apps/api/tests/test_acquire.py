"""extract/acquire/{youtube,blog}.py.

Two tiers, per docs/M2.9-youtube-import-design.md §8.2:

* Pure-function unit tests (default run, no network): chapter-line parsing and the
  frozen `RawAcquisition` fixtures under tests/fixtures/import/, built from real
  fetches during design (never re-fetched).
* `@pytest.mark.network` tests: real live fetches against the actual Step 0 URLs and
  blog links, excluded from the default run alongside `llm`.
"""

import json
from pathlib import Path

import httpx
import pytest
import yt_dlp

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.acquire import transcript as transcript_module
from abc_cook.extract.acquire.blog import fetch_recipe, find_candidate_links
from abc_cook.extract.acquire.transcript import select_track
from abc_cook.extract.acquire.youtube import fetch, parse_chapters

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"

# Real Step 0 URLs (docs/M2.9-youtube-import-design.md §0), one per bucket exercised.
FULL_METHOD_URL = "https://youtu.be/o3k55z-tv9I"  # Pakoda Kadhi, bucket A
INGREDIENTS_ONLY_URL = "https://youtu.be/Cc6qx4HBw9c"  # Soya Veg Biryani, bucket C
USELESS_URL = "https://youtu.be/88MTFAXFh0A"  # Cholle Bhature, bucket E

# The two blog links verified live in §10.A.
CHEFKUNALKAPUR_URL = "http://www.chefkunalkapur.com/dal-makhni/"
RASGULLA_BLOG_URL = "https://bit.ly/2DbcxhJ"

# M2.10 leg-3 source videos (same ones frozen into tests/fixtures/import/).
SHAHI_TUKDA_URL = "https://www.youtube.com/watch?v=pxpJmXq2w7c"
RASMALAI_URL = "https://www.youtube.com/watch?v=ZLaz2azNJl0"


# ---------------------------------------------------------------------------
# Pure functions: chapter parsing. No network.
# ---------------------------------------------------------------------------


def test_parse_chapters_label_first_format() -> None:
    """Real format observed in a Step 0 description: label, then timestamp."""
    description = (
        "Intro 0:00\nMarination 0:57\nFilling 2:41\n"
        "Final process 4:36\nPlating 6:29\nOutro 6:49"
    )
    chapters = parse_chapters(description)
    assert [c.label for c in chapters] == [
        "Intro",
        "Marination",
        "Filling",
        "Final process",
        "Plating",
        "Outro",
    ]
    assert [c.start_sec for c in chapters] == [0, 57, 161, 276, 389, 409]
    assert chapters[-1].end_sec is None
    assert chapters[0].end_sec == 57


def test_parse_chapters_timestamp_first_format() -> None:
    """YouTube's own documented auto-chapter format: timestamp, then label."""
    description = "0:00 Intro\n1:30 Prep\n5:00 Cook"
    chapters = parse_chapters(description)
    assert [c.label for c in chapters] == ["Intro", "Prep", "Cook"]
    assert [c.start_sec for c in chapters] == [0, 90, 300]


def test_parse_chapters_requires_at_least_two() -> None:
    """A single stray timestamped line isn't a chapter list."""
    assert parse_chapters("Marination 0:57\nSome other line with no timestamp") == []


def test_parse_chapters_ignores_ordinary_text() -> None:
    """A description with no chapter-shaped lines yields no chapters, never raises."""
    description = "1 Cup Curd\n2 tsp Salt\nMix well and serve."
    assert parse_chapters(description) == []


def test_parse_chapters_empty_string() -> None:
    assert parse_chapters("") == []


# ---------------------------------------------------------------------------
# Pure functions: blog-link candidate filtering. No network.
# ---------------------------------------------------------------------------


def test_find_candidate_links_excludes_social_hosts() -> None:
    description = (
        "Recipe: https://www.chefkunalkapur.com/recipe/dal-makhni/\n"
        "Follow: https://www.facebook.com/RecipesbyShezasMom\n"
        "https://www.youtube.com/c/somechannel\n"
    )
    candidates = find_candidate_links(description)
    assert candidates == ["https://www.chefkunalkapur.com/recipe/dal-makhni/"]


def test_find_candidate_links_keeps_link_shorteners() -> None:
    """A shortener is kept as a candidate; the excluded-host check happens after
    `fetch_recipe` resolves the redirect, since bit.ly may resolve to a real blog
    (verified in design doc §10.A)."""
    candidates = find_candidate_links("Written recipe: https://bit.ly/2DbcxhJ")
    assert candidates == ["https://bit.ly/2DbcxhJ"]


def test_find_candidate_links_empty_description() -> None:
    assert find_candidate_links("") == []


# ---------------------------------------------------------------------------
# Frozen RawAcquisition fixtures. No network -- these are never re-fetched.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("slug", "expect_grounded_shape"),
    [
        ("full-method", True),
        ("partial-ingredients-only", False),
        ("blog-link-only", True),
        ("useless", False),
        # M2.10 leg-3 fixtures: bucket C (ingredients-only description), transcript
        # differs. All four have a real description, hence True here -- "grounded"
        # only means "has description or blog_recipe", not "has a method".
        ("captions-auto-hi", True),
        ("captions-manual-en", True),
        ("captions-auto-en-long", True),
        ("no-captions", True),
    ],
)
def test_frozen_fixture_parses_as_raw_acquisition(slug: str, expect_grounded_shape: bool) -> None:
    data = json.loads((FIXTURES_DIR / f"{slug}.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.title
    assert acquisition.source_url
    if expect_grounded_shape:
        assert acquisition.description or acquisition.blog_recipe


def test_full_method_fixture_has_rich_description() -> None:
    data = json.loads((FIXTURES_DIR / "full-method.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.description is not None
    assert "Process of making" in acquisition.description
    assert acquisition.blog_recipe is None


def test_partial_ingredients_only_fixture_has_no_blog_recipe() -> None:
    path = FIXTURES_DIR / "partial-ingredients-only.raw.json"
    acquisition = RawAcquisition.model_validate(json.loads(path.read_text(encoding="utf-8")))
    assert acquisition.blog_recipe is None
    assert acquisition.description  # ingredients are there; method text is not


def test_blog_link_only_fixture_has_structured_recipe() -> None:
    data = json.loads((FIXTURES_DIR / "blog-link-only.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.blog_recipe is not None
    assert acquisition.blog_recipe.get("recipeIngredient")
    instructions = acquisition.blog_recipe.get("recipeInstructions")
    assert isinstance(instructions, list)
    assert len(instructions) >= 1
    assert all("HowToSection" in section.get("@type", "") for section in instructions)


def test_useless_fixture_has_almost_nothing() -> None:
    data = json.loads((FIXTURES_DIR / "useless.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.blog_recipe is None
    assert acquisition.chapters == []
    assert (acquisition.description or "").strip().count("\n") == 0


# ---------------------------------------------------------------------------
# M2.10 leg-3 fixtures: real caption fetches, frozen once. All four are bucket C
# (ingredients-only description, no written method) -- transcript is what M2.10 adds.
# ---------------------------------------------------------------------------


def test_captions_auto_hi_fixture_has_hindi_auto_transcript() -> None:
    """Sabudana: yt-dlp `language` metadata is "hi" with a matching auto-caption track."""
    data = json.loads((FIXTURES_DIR / "captions-auto-hi.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.transcript_kind == "auto"
    assert acquisition.transcript_lang == "hi"
    assert acquisition.transcript
    assert acquisition.transcript_segments
    # No glued event boundaries (design doc M2.10: normalization must add the space).
    assert "किहम" not in acquisition.transcript


def test_captions_manual_en_fixture_has_creator_subtitles() -> None:
    """Shahi Tukda: creator-uploaded English subtitles, even though `language` is "hi" --
    manual beats auto regardless of the video-language match (decision 3)."""
    data = json.loads((FIXTURES_DIR / "captions-manual-en.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.transcript_kind == "manual"
    assert acquisition.transcript_lang == "en"
    assert acquisition.transcript


def test_captions_auto_en_long_fixture_has_long_english_transcript() -> None:
    """Ramen: the largest realistic single-track input; exercises the cap machinery
    even if it doesn't trip it."""
    data = json.loads(
        (FIXTURES_DIR / "captions-auto-en-long.raw.json").read_text(encoding="utf-8")
    )
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.transcript_kind == "auto"
    assert acquisition.transcript_lang == "en"
    assert acquisition.transcript
    assert len(acquisition.transcript) > 10_000


def test_no_captions_fixture_has_no_transcript() -> None:
    """Rasmalai: a silent video with no caption track -- must stay Tier 0 honestly,
    never a fabricated transcript."""
    data = json.loads((FIXTURES_DIR / "no-captions.raw.json").read_text(encoding="utf-8"))
    acquisition = RawAcquisition.model_validate(data)
    assert acquisition.transcript is None
    assert acquisition.transcript_kind is None
    assert acquisition.transcript_segments == []
    assert acquisition.description  # ingredients are still there


# ---------------------------------------------------------------------------
# youtube.fetch() caption-fetch integration: transient vs. definitive vs. success.
# Phase 0 audit finding (notes/shortform-video-import-plan-2026-09-29.md): a bare
# `except httpx.HTTPError: return []` in fetch_segments made a rate-limited caption
# fetch indistinguishable from "this video has no captions" -- 7 of 14 Phase 0 videos
# were misclassified this way. `yt_dlp.YoutubeDL` and `httpx.get` are both
# monkeypatched here; no network.
# ---------------------------------------------------------------------------


class _FakeYDL:
    """Stands in for `yt_dlp.YoutubeDL` -- returns a canned `info` dict instead of
    hitting the network, so `fetch()`'s caption-handling logic is testable offline."""

    def __init__(self, opts: object, info: dict[str, object]) -> None:
        self._info = info

    def __enter__(self) -> "_FakeYDL":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None

    def extract_info(self, url: str, download: bool = False) -> dict[str, object]:
        return self._info


class _FakeCaptionResponse:
    def __init__(self, payload: object, *, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("boom", request=None, response=None)  # type: ignore[arg-type]

    def json(self) -> object:
        return self._payload


def _base_info(**overrides: object) -> dict[str, object]:
    info: dict[str, object] = {
        "title": "Test Video",
        "channel": "Test Channel",
        "description": None,
        "duration": 60,
        "language": "hi",
        "subtitles": {},
        "automatic_captions": {},
    }
    info.update(overrides)
    return info


def test_fetch_adds_no_warning_when_no_caption_track_genuinely_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Genuine absence (`select_track` returns None) is unchanged by this fix:
    transcript stays None, no warning at all -- never conflated with a fetch failure."""
    info = _base_info()  # automatic_captions={} -> select_track returns None
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))
    acquisition = fetch("https://www.youtube.com/shorts/fake-no-captions")
    assert acquisition.transcript is None
    assert acquisition.transcript_kind is None
    assert acquisition.acquisition_warnings == []


def test_fetch_replaces_instagram_placeholder_title_with_description(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Integration point for the Phase 1 title fix: `fetch()` is the one leg both
    YouTube and Instagram URLs go through (`pipeline.py`'s host allowlist), so this
    exercises `instagram.clean_placeholder_title` the same way a real IG import
    would, not just the pure function in isolation."""
    info = _base_info(
        title="Video by batati.being.batati",
        channel="batati.being.batati",
        description="Lauki soup\n\nRecipe in pinned comment below",
    )
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))

    acquisition = fetch("https://www.instagram.com/reel/fake/")

    assert acquisition.title == "Lauki soup\n\nRecipe in pinned comment below"


def test_fetch_leaves_a_real_title_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    info = _base_info(title="Test Video")
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))
    acquisition = fetch("https://www.youtube.com/shorts/fake")
    assert acquisition.title == "Test Video"


def test_fetch_populates_transcript_on_successful_caption_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    info = _base_info(
        automatic_captions={"hi": [{"ext": "json3", "url": "https://example.test/caps.json3"}]}
    )
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))
    transcript_text = "first heat the oil then add the onions and cook until golden"
    payload = {
        "events": [{"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": transcript_text}]}]
    }
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _FakeCaptionResponse(payload))

    acquisition = fetch("https://www.youtube.com/shorts/fake-success")

    assert acquisition.transcript == transcript_text
    assert acquisition.transcript_kind == "auto"
    assert acquisition.acquisition_warnings == []


def test_fetch_ignores_a_junk_transcript_and_warns_instead(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Phase 1 speech-quality gate, at the integration point: a caption track exists
    and fetches cleanly, but the text is wrong-language/non-speech junk -- transcript
    must stay None (never invent a recipe from it), with a warning distinguishable
    from both "no captions" and the transient-failure case."""
    info = _base_info(
        automatic_captions={"hi": [{"ext": "json3", "url": "https://example.test/caps.json3"}]}
    )
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))
    payload = {
        "events": [
            {"tStartMs": 0, "dDurationMs": 1000, "segs": [{"utf8": "Det er et stort problem."}]}
        ]
    }
    monkeypatch.setattr(httpx, "get", lambda url, timeout=15.0: _FakeCaptionResponse(payload))

    acquisition = fetch("https://www.youtube.com/shorts/fake-junk")

    assert acquisition.transcript is None
    assert acquisition.transcript_kind is None
    assert len(acquisition.acquisition_warnings) == 1
    warning = acquisition.acquisition_warnings[0]
    assert "junk" in warning.lower()
    assert "transient" not in warning.lower()


def test_fetch_surfaces_a_distinguishable_warning_on_transient_caption_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The confirmed Phase 0 bug, at the integration point: a caption track exists,
    every fetch attempt is 429'd, and the result must be distinguishable from "no
    captions" -- transcript stays None (never fails the import, CLAUDE.md), but a
    warning names it as a transient fetch failure, not an absence."""
    info = _base_info(
        automatic_captions={"hi": [{"ext": "json3", "url": "https://example.test/caps.json3"}]}
    )
    monkeypatch.setattr(yt_dlp, "YoutubeDL", lambda opts: _FakeYDL(opts, info))
    monkeypatch.setattr(
        httpx, "get", lambda url, timeout=15.0: _FakeCaptionResponse({}, status_code=429)
    )
    monkeypatch.setattr(transcript_module.time, "sleep", lambda _: None)

    acquisition = fetch("https://www.youtube.com/shorts/fake-transient")

    assert acquisition.transcript is None
    assert len(acquisition.acquisition_warnings) == 1
    warning = acquisition.acquisition_warnings[0]
    assert "transient" in warning.lower()
    assert "no captions" not in warning.lower()  # must not read like genuine absence


# ---------------------------------------------------------------------------
# Live network tests. Excluded from the default run (pyproject.toml `network` marker).
# ---------------------------------------------------------------------------


@pytest.mark.network
def test_fetch_full_method_video_live() -> None:
    acquisition = fetch(FULL_METHOD_URL)
    assert acquisition.source_url == FULL_METHOD_URL
    assert acquisition.title
    assert acquisition.description


@pytest.mark.network
def test_fetch_ingredients_only_video_live() -> None:
    acquisition = fetch(INGREDIENTS_ONLY_URL)
    assert acquisition.title
    # Bucket C: ingredients present, but no crash, no fabricated method text.
    assert acquisition.description is not None


@pytest.mark.network
def test_fetch_useless_video_live_does_not_crash() -> None:
    acquisition = fetch(USELESS_URL)
    assert acquisition.title
    # An (almost) empty description must not raise -- it's a valid, if useless, result.


@pytest.mark.network
def test_fetch_recipe_chefkunalkapur_live() -> None:
    recipe = fetch_recipe(CHEFKUNALKAPUR_URL)
    assert recipe is not None
    assert recipe.get("recipeIngredient")
    assert recipe.get("recipeInstructions")


@pytest.mark.network
def test_fetch_recipe_rasgulla_blog_via_redirect_live() -> None:
    recipe = fetch_recipe(RASGULLA_BLOG_URL)
    assert recipe is not None
    instructions = recipe.get("recipeInstructions")
    assert isinstance(instructions, list)
    assert any("HowToSection" in section.get("@type", "") for section in instructions)


@pytest.mark.network
def test_fetch_recipe_returns_none_for_non_recipe_page() -> None:
    recipe = fetch_recipe("https://example.com")
    assert recipe is None


def _extract_info(url: str) -> dict[str, object]:
    opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    assert info is not None
    return info


@pytest.mark.network
def test_select_track_live_shahi_tukda_yields_manual_english() -> None:
    """Creator-uploaded English subtitles, live -- matches the frozen fixture."""
    track = select_track(_extract_info(SHAHI_TUKDA_URL))
    assert track is not None
    kind, lang, _url = track
    assert (kind, lang) == ("manual", "en")


@pytest.mark.network
def test_select_track_live_rasmalai_yields_none() -> None:
    """A silent video: no caption track of any kind -- must stay Tier 0 honestly."""
    assert select_track(_extract_info(RASMALAI_URL)) is None
