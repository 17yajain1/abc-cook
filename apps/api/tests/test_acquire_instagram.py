"""extract/acquire/instagram.py -- Instagram title-placeholder fixup. No network.

Phase 1 (shortform-video-import-plan.md): 11/11 successfully acquired Instagram
Reels in the Phase 0 eval had yt-dlp's synthetic "Video by <handle>" title, verified
live against two of those real Reels again for this fix (see the PR report).
"""

from __future__ import annotations

from abc_cook.extract.acquire.instagram import clean_placeholder_title


def test_replaces_video_by_placeholder_with_description() -> None:
    """The confirmed Phase 0 shape, live-verified again for this fix."""
    title = "Video by batati.being.batati"
    description = "Lauki soup \n\nRecipe in pinned comment below"
    assert clean_placeholder_title(title, description) == description


def test_replaces_post_by_placeholder_too() -> None:
    assert clean_placeholder_title("Post by someone", "Real caption text") == "Real caption text"


def test_photo_by_is_not_a_known_placeholder() -> None:
    """yt-dlp never emits "Photo by <handle>"; only Video by / Post by are synthesized."""
    assert clean_placeholder_title("Photo by someone", "Real caption text") == "Photo by someone"


def test_leaves_placeholder_unchanged_when_no_description() -> None:
    """Nothing better to offer -- returning the placeholder is honest, not silent."""
    title = "Video by batati.being.batati"
    assert clean_placeholder_title(title, None) == title
    assert clean_placeholder_title(title, "") == title
    assert clean_placeholder_title(title, "   ") == title


def test_leaves_a_real_title_unchanged() -> None:
    """Must never rewrite a genuine title just because it happens to contain "by"."""
    title = "Paneer Butter Masala Recipe by Chef Kunal"
    assert clean_placeholder_title(title, "some description") == title


def test_leaves_youtube_style_title_unchanged_with_no_description() -> None:
    assert clean_placeholder_title("Kadai Paneer Recipe | Full Method", None) == (
        "Kadai Paneer Recipe | Full Method"
    )


def test_does_not_match_a_title_that_merely_starts_similarly() -> None:
    """"Video by" must be the whole leading shape (yt-dlp's exact synthesis), not a
    substring match that could clip a real title starting the same way."""
    title = "Video by the Sea: A Coastal Cooking Story"
    assert clean_placeholder_title(title, "description") == title


def test_strips_surrounding_whitespace_from_the_replacement() -> None:
    result = clean_placeholder_title("Video by handle", "  Real caption  \n\n")
    assert result == "Real caption"
