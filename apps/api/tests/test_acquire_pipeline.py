"""extract/acquire/pipeline.py -- wiring leg 1 (YouTube) to leg 2 (blog JSON-LD).

Found missing during the M2.9 s15 checkpoint: `youtube.fetch` never called
`blog.find_candidate_links`/the link probe, so a real bucket-D video (description
links to a recipe blog) never got its `blog_recipe` populated. Offline: `youtube.fetch`
and `pipeline.probe_fetch` are monkeypatched, so this never touches the network — the
`network`-marked tests in test_acquire.py cover the real endpoints.
"""

from __future__ import annotations

import functools
import json
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx
import pytest

from abc_cook.extract.acquire import RawAcquisition, SourceMetadata, pipeline
from abc_cook.extract.acquire.blog import RecipePage, fetch_recipe_page, refuse_redirect_host
from abc_cook.extract.acquire.pipeline import acquire
from abc_cook.extract.acquire.safe_fetch import fetch_html

FIXTURES = Path(__file__).parent / "fixtures" / "import"


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
        pipeline,
        "probe_fetch",
        lambda url, deadline: RecipePage(recipe={"@type": "Recipe", "name": "Test"}),
    )
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe == {"@type": "Recipe", "name": "Test"}
    assert result.description  # leg 1's description is preserved alongside leg 2


def test_leaves_blog_recipe_none_when_nothing_resolves(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw())
    monkeypatch.setattr(pipeline, "find_candidate_links", lambda description: ["https://x.test"])
    monkeypatch.setattr(
        pipeline, "probe_fetch", lambda url, deadline: RecipePage(recipe=None, reason="x")
    )
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

    def _probe(url: str, deadline: float) -> RecipePage:
        return RecipePage(recipe={"@type": "Recipe"} if url == "https://b.test" else None)

    monkeypatch.setattr(pipeline, "probe_fetch", _probe)
    result = acquire("https://youtu.be/test")
    assert result.blog_recipe == {"@type": "Recipe"}


# ---------------------------------------------------------------------------
# Phase 1 host allowlist -- rejects an unsupported host before any network call,
# rather than handing it to `fetch_youtube`'s yt-dlp-generic extraction attempt
# (shortform-video-import-plan.md: this used to take yt-dlp's full retry budget to
# fail on a host like TikTok, reading as a hung import). `fetch_youtube` is
# monkeypatched to raise if it's ever called, so these prove the rejection happens
# strictly before leg 1, not just alongside it.
# ---------------------------------------------------------------------------


def _boom_fetch_youtube(url: str) -> RawAcquisition:
    raise AssertionError("fetch_youtube must not be called for an unsupported host")


def test_rejects_tiktok_before_any_network_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", _boom_fetch_youtube)
    with pytest.raises(RuntimeError, match="Unsupported"):
        acquire("https://www.tiktok.com/@someone/video/123")


def test_directly_pasted_recipe_page_is_no_longer_rejected_by_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A1 deliberately reverses PR #29 for recipe pages: routing is by content, not
    hostname. It still never goes to yt-dlp; a failed/blocked page is a plain failure,
    not an 'Unsupported host' one (test_recipe_page.py covers the page leg)."""
    monkeypatch.setattr(pipeline, "fetch_youtube", _boom_fetch_youtube)
    monkeypatch.setattr(
        pipeline, "fetch_recipe_page", lambda url: RecipePage(recipe=None, reason="http 403")
    )
    with pytest.raises(RuntimeError, match="couldn't open"):
        acquire("https://www.chefkunalkapur.com/dal-makhni/")


def test_accepts_youtube_and_instagram_hosts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pipeline, "fetch_youtube", lambda url: _raw())
    assert acquire("https://youtu.be/test").source_url is not None
    assert acquire("https://www.youtube.com/watch?v=test").source_url is not None
    assert acquire("https://www.instagram.com/reel/Abc123/").source_url is not None
    assert acquire("https://instagram.com/reel/Abc123/").source_url is not None  # no www.


def test_metadata_is_reported_before_the_first_link_is_probed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[str] = []

    def fake_youtube(url: str, *, on_metadata: object = None) -> RawAcquisition:
        raw = _raw()
        assert callable(on_metadata)
        on_metadata(SourceMetadata(raw.title, raw.channel, raw.description))
        events.append("youtube-finished")  # captions ran inside fetch, after the callback
        return raw

    monkeypatch.setattr(pipeline, "fetch_youtube", fake_youtube)
    monkeypatch.setattr(pipeline, "find_candidate_links", lambda d: ["https://a.test"])

    def probe(url: str, deadline: float) -> RecipePage:
        events.append("probe")
        return RecipePage(recipe=None, reason="x")

    monkeypatch.setattr(pipeline, "probe_fetch", probe)

    acquire(
        "https://youtu.be/test",
        on_metadata=lambda meta: events.append(f"metadata:{meta.title}"),
    )

    assert events == ["metadata:Test Video", "youtube-finished", "probe"]


# ---------------------------------------------------------------------------
# PR-S1.5: the bounded description-link probe. Fake fetch / fake HTTP; no network.
# ---------------------------------------------------------------------------

_PUBLIC_IP = "93.184.216.34"
_RECIPE_HTML = (
    '<script type="application/ld+json">'
    '{"@type": "Recipe", "name": "Found", "recipeInstructions": ["Cook."]}'
    "</script>"
)


def _page(recipe: bool) -> RecipePage:
    return RecipePage(
        recipe={"@type": "Recipe"} if recipe else None,
        final_url="https://blog.test/r" if recipe else None,
        reason=None if recipe else "no Recipe JSON-LD",
    )


def test_budget_exhausted_stops_the_stage_within_the_cap() -> None:
    def slow(url: str, deadline: float) -> RecipePage:
        time.sleep(0.15)
        return _page(recipe=False)

    links = [f"https://x{i}.test" for i in range(10)]
    started = time.monotonic()
    report = pipeline.probe_links(links, link_timeout_s=1.0, budget_s=0.5, fetch=slow)
    elapsed = time.monotonic() - started

    assert report.stopped == "budget"
    assert report.recipe is None
    assert 2 <= len(report.entries) < 10  # a few started, the rest never did
    assert elapsed < 0.5 + 0.2


def test_a_hanging_link_is_abandoned_and_the_next_one_is_tried() -> None:
    def fetch(url: str, deadline: float) -> RecipePage:
        if url == "https://hang.test":
            time.sleep(1.0)  # ignores its deadline, like a blocking DNS lookup
            return _page(recipe=True)  # discarded: nobody is waiting any more
        return _page(recipe=True)

    started = time.monotonic()
    report = pipeline.probe_links(
        ["https://hang.test", "https://ok.test"], link_timeout_s=0.2, budget_s=5.0, fetch=fetch
    )
    elapsed = time.monotonic() - started

    assert [(u, o) for u, o, _ in report.entries] == [
        ("https://hang.test", "link timeout"),
        ("https://ok.test", "recipe"),
    ]
    assert report.stopped == "found"
    assert report.abandoned == 1
    assert elapsed < 0.6


def test_the_probe_log_line_counts_abandoned_links(caplog: pytest.LogCaptureFixture) -> None:
    def fetch(url: str, deadline: float) -> RecipePage:
        time.sleep(0.5)
        return _page(recipe=False)

    with caplog.at_level("INFO", logger=pipeline.__name__):
        pipeline.probe_links(["https://a.test"], link_timeout_s=0.1, budget_s=1.0, fetch=fetch)
    line = next(r.getMessage() for r in caplog.records if r.getMessage().startswith("probe:"))
    assert "candidates=1" in line
    assert "probed=1" in line
    assert "abandoned=1" in line
    assert "stopped=exhausted" in line
    assert "found=none" in line


def test_excluded_and_malformed_links_are_never_fetched() -> None:
    description = "\n".join(
        [
            "https://amzn.to/4vbQUSo",
            "https://www.amazon.in/shop/x",
            "https://amazon.co.uk/dp/1",
            "https://amzlink.to/az0vR1N8PiUPw",
            "https://geni.us/abc",
            "https://aip.urlgeni.us/https://amzn.to/4vbQUSo",
            "https://aip.urlgeni.ushttps://amzn.to/4vbQUSo",
            "https://www.youtube.com/watch?v=abc",
        ]
    )
    fetched: list[str] = []

    def recording(url: str, deadline: float) -> RecipePage:
        fetched.append(url)
        return _page(recipe=False)

    candidates = pipeline.find_candidate_links(description)
    report = pipeline.probe_links(candidates, fetch=recording)

    assert candidates == []
    assert fetched == []
    assert report.entries == ()
    assert report.stopped == "exhausted"


def test_a_wrapper_around_a_blog_is_unwrapped_and_the_blog_is_fetched() -> None:
    candidates = pipeline.find_candidate_links(
        "https://aip.urlgeni.us/https://blog.example/recipe/x"
    )
    assert candidates == ["https://blog.example/recipe/x"]


def _fake_http_fetch(routes: dict[str, str], seen_hosts: list[str]) -> pipeline.ProbeFetch:
    """The real probe composition (fetch_recipe_page -> fetch_html) over a fake network."""

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.headers["host"]
        seen_hosts.append(host)
        if host in routes:
            return httpx.Response(301, headers={"location": routes[host]})
        return httpx.Response(200, headers={"content-type": "text/html"}, text=_RECIPE_HTML)

    transport = httpx.MockTransport(handler)

    def fetch(url: str, deadline: float) -> RecipePage:
        return fetch_recipe_page(
            url,
            allow_http=True,
            deadline=deadline,
            refuse_host=refuse_redirect_host,
            fetch=functools.partial(
                fetch_html, resolve=lambda host: [_PUBLIC_IP], transport=transport
            ),
        )

    return fetch


def test_a_shortener_that_leads_to_a_blog_is_found_within_budget() -> None:
    seen: list[str] = []
    fetch = _fake_http_fetch({"bit.ly": "https://blog.example/recipe"}, seen)
    report = pipeline.probe_links(["https://bit.ly/abc"], fetch=fetch)

    assert report.stopped == "found"
    assert report.final_url == "https://blog.example/recipe"
    assert seen == ["bit.ly", "blog.example"]


def test_a_shortener_that_leads_to_youtube_never_requests_youtube() -> None:
    seen: list[str] = []
    fetch = _fake_http_fetch({"bit.ly": "https://www.youtube.com/watch?v=abc"}, seen)
    report = pipeline.probe_links(["https://bit.ly/abc"], fetch=fetch)

    assert report.recipe is None
    assert [o for _, o, _ in report.entries] == ["redirected to excluded host"]
    assert seen == ["bit.ly"]  # the 301 only; YouTube was never requested


@pytest.mark.parametrize(
    ("slug", "winner_host"),
    [
        ("blog-link-only", "bit.ly"),  # the only shortener -> blog case
        ("kadhi-pakora", "www.chefkunalkapur.com"),
        ("pizza-dough", "natashaskitchen.com"),
    ],
)
def test_the_blog_that_won_before_still_wins_first(slug: str, winner_host: str) -> None:
    raw = json.loads((FIXTURES / f"{slug}.raw.json").read_text(encoding="utf-8"))
    recipe_hosts = ("bit.ly", "chefkunalkapur.com", "natashaskitchen.com", "nehascookbook.com")

    def fetch(url: str, deadline: float) -> RecipePage:
        host = urlparse(url).netloc
        return _page(recipe=any(host.endswith(h) for h in recipe_hosts))

    candidates = pipeline.find_candidate_links(raw["description"])
    report = pipeline.probe_links(candidates, fetch=fetch)

    assert report.stopped == "found"
    assert urlparse(report.entries[-1][0]).netloc == winner_host
    # Competing recipe links come later in the description; the first one tried wins.
    assert len(report.entries) == 1
