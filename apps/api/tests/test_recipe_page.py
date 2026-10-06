"""A1/A2 offline: recipe-page routing, usable-instructions rule, SourcePreview.

HTML fixtures under fixtures/recipe_pages/ are SYNTHETIC (hand-written to the shapes real
blogs emit: @graph, HowToSection, entities, tags). Real captured pages come with the
live A4/C2 run.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from abc_cook.extract.acquire import RawAcquisition, pipeline
from abc_cook.extract.acquire.blog import (
    NoRecipeFoundError,
    RecipePage,
    fetch_recipe_page,
    has_usable_instructions,
    recipe_in_html,
)
from abc_cook.extract.acquire.pipeline import acquire
from abc_cook.extract.acquire.preview import build_preview
from abc_cook.extract.acquire.safe_fetch import FetchedPage, FetchError

PAGES = Path(__file__).parent / "fixtures" / "recipe_pages"


def _html(name: str) -> str:
    return (PAGES / name).read_text(encoding="utf-8")


def _fetcher(name: str, final_url: str = "https://kitchen.example/r") -> Callable[..., FetchedPage]:
    return lambda url, **kwargs: FetchedPage(final_url, _html(name))


def _patch_fetch(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    real = pipeline.fetch_recipe_page
    monkeypatch.setattr(pipeline, "fetch_recipe_page", lambda url: real(url, fetch=_fetcher(name)))


# --- usable instructions -----------------------------------------------------------


def test_usable_instructions_shapes() -> None:
    assert has_usable_instructions({"recipeInstructions": "Boil it."})
    assert has_usable_instructions({"recipeInstructions": ["Boil it."]})
    assert has_usable_instructions({"recipeInstructions": [{"@type": "HowToStep", "text": "Go"}]})
    assert has_usable_instructions(
        {"recipeInstructions": [{"@type": "HowToSection", "itemListElement": [{"text": "Go"}]}]}
    )
    for empty in (None, "", "   ", [], [""], [{"@type": "HowToSection", "itemListElement": []}]):
        assert not has_usable_instructions({"recipeInstructions": empty})
    assert not has_usable_instructions({})


# --- fetch_recipe_page -------------------------------------------------------------


def test_fetch_recipe_page_returns_a_reason_instead_of_swallowing() -> None:
    def refuse(url: str, **kwargs: object) -> FetchedPage:
        raise FetchError("http 403")

    result = fetch_recipe_page("https://kitchen.example/r", fetch=refuse)
    assert result == RecipePage(recipe=None, reason="http 403")

    none = fetch_recipe_page("https://kitchen.example/r", fetch=_fetcher("no-recipe.html"))
    assert none.recipe is None
    assert none.reason == "no Recipe JSON-LD"
    assert none.final_url is not None


def test_fetch_recipe_page_finds_recipe_inside_graph() -> None:
    result = fetch_recipe_page("https://kitchen.example/r", fetch=_fetcher("sectioned-recipe.html"))
    assert result.recipe is not None
    assert result.recipe["@type"] == "Recipe"


def test_excluded_host_after_redirect_is_not_a_recipe() -> None:
    result = fetch_recipe_page(
        "https://kitchen.example/r",
        fetch=_fetcher("flat-recipe.html", final_url="https://www.youtube.com/x"),
    )
    assert result.recipe is None
    assert result.reason == "redirected to excluded host"


# --- pipeline routing --------------------------------------------------------------


def test_pasted_recipe_page_becomes_a_blog_recipe_acquisition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: pytest.fail("not a video host"))
    _patch_fetch(monkeypatch, "sectioned-recipe.html")
    raw = acquire("https://www.kitchen.example/tiramisu")
    assert raw.blog_recipe is not None
    assert raw.title == "Cozy Tiramisu &amp; Espresso"  # verbatim JSON-LD name; preview cleans it
    assert raw.channel == "kitchen.example"
    assert raw.description is None


def test_schemeless_and_http_urls_are_upgraded_to_https(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def spy(url: str) -> RecipePage:
        seen.append(url)
        return fetch_recipe_page(url, fetch=_fetcher("flat-recipe.html"))

    monkeypatch.setattr(pipeline, "fetch_recipe_page", spy)
    acquire("kitchen.example/dal")
    acquire("http://kitchen.example/dal")
    assert seen == ["https://kitchen.example/dal", "https://kitchen.example/dal"]


@pytest.mark.parametrize("page", ["no-recipe.html", "no-instructions.html"])
def test_page_without_a_usable_recipe_raises_no_recipe_found(
    monkeypatch: pytest.MonkeyPatch, page: str
) -> None:
    _patch_fetch(monkeypatch, page)
    with pytest.raises(NoRecipeFoundError):
        acquire("https://kitchen.example/post")


def test_unopenable_page_is_a_plain_failure_not_no_recipe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(url: str, **kwargs: object) -> FetchedPage:
        raise FetchError("dns failure")

    real = pipeline.fetch_recipe_page
    monkeypatch.setattr(pipeline, "fetch_recipe_page", lambda url: real(url, fetch=refuse))
    with pytest.raises(RuntimeError, match="couldn't open") as excinfo:
        acquire("https://kitchen.example/post")
    assert not isinstance(excinfo.value, NoRecipeFoundError)


@pytest.mark.parametrize(
    "url",
    [
        "https://www.tiktok.com/@a/video/1",
        "https://www.facebook.com/watch/?v=1",
        "https://x.com/a/status/1",
        "https://bit.ly/abc",
    ],
)
def test_video_social_hosts_still_fail_fast_without_any_fetch(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda u: pytest.fail("no yt-dlp"))
    monkeypatch.setattr(pipeline, "fetch_recipe_page", lambda u: pytest.fail("no page fetch"))
    with pytest.raises(RuntimeError, match="Unsupported"):
        acquire(url)


# --- SourcePreview -----------------------------------------------------------------


def _raw_with(page: str) -> RawAcquisition:
    recipe = recipe_in_html(_html(page))
    return RawAcquisition(source_url="https://kitchen.example/r", title="T", blog_recipe=recipe)


def test_preview_keeps_source_text_sections_and_cleans_markup_only() -> None:
    preview = build_preview(_raw_with("sectioned-recipe.html"))
    assert preview is not None
    assert preview.title == "Cozy Tiramisu & Espresso"
    # Dual units verbatim; entities decoded, nothing reworded or converted.
    assert preview.ingredients == ["200 g mascarpone (7 oz)", "2 tbsp sugar", "½ cup espresso"]
    assert [s.heading for s in preview.instructions] == ["Soak", "Assemble"]
    assert preview.instructions[0].lines == [
        "Brew the espresso and leave it to cool.",
        "Whisk the mascarpone with the sugar.",
    ]


def test_preview_flat_instructions_form_one_headingless_section() -> None:
    preview = build_preview(_raw_with("flat-recipe.html"))
    assert preview is not None
    assert [(s.heading, s.lines) for s in preview.instructions] == [
        (None, ["Boil the dal.", "Temper with cumin."])
    ]


def test_preview_is_none_without_a_usable_recipe() -> None:
    assert build_preview(_raw_with("no-instructions.html")) is None
    assert build_preview(RawAcquisition(source_url="u", title="T", description="x")) is None


def test_preview_model_carries_only_strings() -> None:
    """The preview layer must never hold parsed numbers (A2 three-layers rule)."""
    preview = build_preview(_raw_with("sectioned-recipe.html"))
    assert preview is not None
    assert set(preview.model_dump()) == {"title", "ingredients", "instructions"}
