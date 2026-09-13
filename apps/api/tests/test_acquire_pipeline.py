"""extract/acquire/pipeline.py -- wiring leg 1 (YouTube) to leg 2 (blog JSON-LD).

Found missing during the M2.9 s15 checkpoint: `youtube.fetch` never called
`blog.find_candidate_links`/`fetch_recipe`, so a real bucket-D video (description
links to a recipe blog) never got its `blog_recipe` populated. Offline: `youtube.fetch`
and `blog.fetch_recipe` are monkeypatched, so this never touches the network — the
`network`-marked tests in test_acquire.py cover the real endpoints.
"""

from __future__ import annotations

import pytest

from abc_cook.extract.acquire import RawAcquisition, pipeline
from abc_cook.extract.acquire.pipeline import acquire


def _raw(**overrides: object) -> RawAcquisition:
    defaults: dict[str, object] = {
        "source_url": "https://youtu.be/test",
        "title": "Test Video",
        "description": "Full recipe: https://example.com/recipe",
    }
    defaults.update(overrides)
    return RawAcquisition(**defaults)  # type: ignore[arg-type]


def test_attaches_blog_recipe_when_a_candidate_link_resolves(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw())
    monkeypatch.setattr(
        pipeline, "find_candidate_links", lambda description: ["https://example.com/recipe"]
    )
    monkeypatch.setattr(
        pipeline, "fetch_recipe", lambda url, **kwargs: {"@type": "Recipe", "name": "Test"}
    )
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe == {"@type": "Recipe", "name": "Test"}
    assert result.description  # leg 1's description is preserved alongside leg 2


def test_leaves_blog_recipe_none_when_nothing_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw())
    monkeypatch.setattr(pipeline, "find_candidate_links", lambda description: ["https://x.test"])
    monkeypatch.setattr(pipeline, "fetch_recipe", lambda url, **kwargs: None)
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe is None


def test_skips_blog_scan_when_leg1_already_found_a_recipe(monkeypatch: pytest.MonkeyPatch) -> None:
    already = _raw(blog_recipe={"@type": "Recipe"})
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: already)

    def _boom(description: str) -> list[str]:
        raise AssertionError("should not scan for links when blog_recipe is already set")

    monkeypatch.setattr(pipeline, "find_candidate_links", _boom)
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe == {"@type": "Recipe"}


def test_no_description_skips_blog_scan(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw(description=None))

    def _boom(description: str) -> list[str]:
        raise AssertionError("should not scan for links with no description")

    monkeypatch.setattr(pipeline, "find_candidate_links", _boom)
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe is None


def test_tries_each_candidate_until_one_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw())
    monkeypatch.setattr(
        pipeline, "find_candidate_links", lambda description: ["https://a.test", "https://b.test"]
    )

    def _fetch_recipe(url: str, **kwargs: object) -> dict[str, object] | None:
        return {"@type": "Recipe"} if url == "https://b.test" else None

    monkeypatch.setattr(pipeline, "fetch_recipe", _fetch_recipe)
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe == {"@type": "Recipe"}
