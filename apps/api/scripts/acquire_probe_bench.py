"""PR-S1.5 acquisition bench: per-link probe timing over the corpus URLs. INR 0.

Runs `pipeline.acquire()` ONLY. It constructs no LLM adapter and reads no key (the dotenv
file is deliberately NOT loaded). Live network: yt-dlp plus the description-link probe.

    --mode before   code as of origin/main: wraps `pipeline.fetch_recipe` to time each link.
    --mode after    PR-S1.5 code: reads the `ProbeReport` from `pipeline.probe_links` and
                    the time to the `on_metadata` callback.

Politeness: at least GAP_S between acquisitions, links fetched one at a time as the product
fetches them, no retries. The run STOPS on any 429; on a bot/captcha page or a 503 from a
non-Amazon host. An Amazon-family 503 or bot page is recorded as that link's outcome and the
run continues (BEFORE only; AFTER never reaches those hosts).

Usage (from the repo root):
    python apps/api/scripts/acquire_probe_bench.py --mode before \
        --out notes/pr-s1-5-acquisition/before.json
    python apps/api/scripts/acquire_probe_bench.py --mode after \
        --out notes/pr-s1-5-acquisition/after.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import yt_dlp  # noqa: E402

from abc_cook.extract.acquire import pipeline  # noqa: E402
from abc_cook.extract.acquire.blog import fetch_recipe_page  # noqa: E402
from abc_cook.extract.acquire.safe_fetch import FetchedPage, fetch_html  # noqa: E402

URLS: dict[str, str] = {
    "kadhi-pakora": "https://www.youtube.com/watch?v=Oa2s0dklrRo",
    "croissant": "https://www.youtube.com/watch?v=OzdqThvpMko",
    "pumpkin-pancakes": "https://www.youtube.com/watch?v=TYZNzCnNGwA",
    "vanilla-cupcakes": "https://www.youtube.com/watch?v=YP8a6ugKQ6Y",
    "chole-bhature": "https://www.youtube.com/watch?v=FU1ZVLMbWjA",
    "captions-manual-en": "https://www.youtube.com/watch?v=pxpJmXq2w7c",
    "pizza-dough": "https://www.youtube.com/watch?v=WM1XcYXix0Y",
    "blog-link-only": "https://youtu.be/3Q4NBZaF29w",
    "full-method": "https://youtu.be/o3k55z-tv9I",
    "captions-auto-en-long": "https://www.youtube.com/watch?v=5e5UYxESO-E",
}
GAP_S = 8.0  # >= 5 s between acquisitions (owner rule); 8 s keeps yt-dlp comfortably spaced

_AMAZON_FAMILY = re.compile(
    r"(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co|amzlink\.to|geni\.us|urlgeni\.us)$"
)
_BOT_PAGE = re.compile(
    r"captcha|are you a robot|not a robot|unusual traffic|automated access|robot check",
    re.IGNORECASE,
)
_YTDLP_BOT = re.compile(r"sign in to confirm|429|too many requests|not a bot", re.IGNORECASE)


class StopRunError(Exception):
    """A politeness stop: the whole run ends, nothing is retried."""


def _host(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _is_amazon_family(url: str) -> bool:
    return _AMAZON_FAMILY.search(_host(url)) is not None


def _check_stop(link: str, reason: str | None, text: str | None) -> str | None:
    """Raise `StopRunError` on a stop condition; return a note for a tolerated Amazon one."""
    amazon = _is_amazon_family(link)
    if reason is not None and "http 429" in reason:
        raise StopRunError(f"429 from {_host(link)}")
    if reason is not None and "http 503" in reason:
        if amazon:
            return "amazon-family 503 (recorded, continuing)"
        raise StopRunError(f"503 from non-Amazon host {_host(link)}")
    if text is not None and _BOT_PAGE.search(text[:20000]):
        if amazon:
            return "amazon-family bot page (recorded, continuing)"
        raise StopRunError(f"bot/captcha page from {_host(link)}")
    return None


# ---- yt-dlp timing (both modes) -------------------------------------------------------

_ytdlp: dict[str, float | None] = {"seconds": 0.0, "early_at": None}
_orig_extract_info = yt_dlp.YoutubeDL.extract_info


def _timed_extract_info(self: Any, *args: Any, **kwargs: Any) -> Any:
    t0 = time.monotonic()
    try:
        return _orig_extract_info(self, *args, **kwargs)
    except Exception as exc:
        if _YTDLP_BOT.search(str(exc)):
            raise StopRunError(f"yt-dlp bot/429 signal: {str(exc)[:160]}") from exc
        raise
    finally:
        _ytdlp["seconds"] = time.monotonic() - t0


yt_dlp.YoutubeDL.extract_info = _timed_extract_info  # type: ignore[method-assign]


# ---- BEFORE: wrap pipeline.fetch_recipe -----------------------------------------------

_links: list[dict[str, Any]] = []
_winner: dict[str, Any] = {}


def _before_fetch_recipe(link: str) -> dict[str, Any] | None:
    seen: dict[str, FetchedPage] = {}

    def recording_fetch(url: str, *, allow_http: bool = False) -> FetchedPage:
        page = fetch_html(url, allow_http=allow_http)
        seen["page"] = page
        return page

    t0 = time.monotonic()
    result = fetch_recipe_page(link, allow_http=True, fetch=recording_fetch)
    seconds = time.monotonic() - t0
    page = seen.get("page")
    final_url = result.final_url or (page.final_url if page else None)
    entry: dict[str, Any] = {
        "link": link,
        "outcome": "recipe" if result.recipe is not None else (result.reason or "none"),
        "seconds": round(seconds, 3),
        "final_host": _host(final_url) if final_url else None,
        "note": None,
    }
    _links.append(entry)  # recorded before any StopRunError so the stopping link is in the file
    entry["note"] = _check_stop(link, result.reason, page.text if page else None)
    if result.recipe is not None:
        _winner.update({"link": link, "final_url": result.final_url})
    return result.recipe


# ---- AFTER: capture the ProbeReport ---------------------------------------------------

_report: dict[str, Any] = {}


def _install_after_hooks() -> None:
    orig = pipeline.probe_links  # type: ignore[attr-defined]

    def wrapped(*args: Any, **kwargs: Any) -> Any:
        report = orig(*args, **kwargs)
        _report["report"] = report
        return report

    pipeline.probe_links = wrapped  # type: ignore[attr-defined]


def _run_one(label: str, url: str, mode: str) -> dict[str, Any]:
    _links.clear()
    _winner.clear()
    _report.clear()
    _ytdlp.update(seconds=0.0, early_at=None)
    row: dict[str, Any] = {"label": label, "url": url, "mode": mode}
    t0 = time.monotonic()

    def on_metadata(_meta: object) -> None:
        _ytdlp["early_at"] = time.monotonic() - t0

    try:
        if mode == "after":
            raw = pipeline.acquire(url, on_metadata=on_metadata)  # type: ignore[call-arg]
        else:
            raw = pipeline.acquire(url)
    except StopRunError:
        raise
    except Exception as exc:
        row.update(error=f"{type(exc).__name__}: {str(exc)[:200]}")
        row["total_s"] = round(time.monotonic() - t0, 3)
        row["links"] = list(_links)
        return row

    row["total_s"] = round(time.monotonic() - t0, 3)
    row["ytdlp_s"] = round(float(_ytdlp["seconds"] or 0.0), 3)
    row["description_len"] = len(raw.description or "")
    row["has_transcript"] = raw.transcript is not None
    blog = raw.blog_recipe
    row["blog_found"] = blog is not None
    row["blog_name"] = blog.get("name") if isinstance(blog, dict) else None

    if mode == "before":
        row["links"] = list(_links)
        row["blog_link"] = _winner.get("link")
        row["blog_final_url"] = _winner.get("final_url")
        row["probe_s"] = round(sum(entry["seconds"] for entry in _links), 3)
    else:
        early = _ytdlp["early_at"]
        row["acquired_at_s"] = round(early, 3) if early is not None else None
        report = _report.get("report")
        if report is None:
            row.update(links=[], probe_s=0.0, stopped="none", abandoned=0, blog_link=None)
        else:
            entries = [
                {"link": u, "outcome": o, "seconds": round(s, 3), "final_host": None, "note": None}
                for (u, o, s) in report.entries
            ]
            row["links"] = entries
            row["probe_s"] = round(sum(entry["seconds"] for entry in entries), 3)
            row["stopped"] = report.stopped
            row["abandoned"] = report.abandoned
            row["blog_link"] = next((e["link"] for e in entries if e["outcome"] == "recipe"), None)
            row["blog_final_url"] = report.final_url
            for entry in entries:
                _check_stop(entry["link"], entry["outcome"], None)  # post-hoc 429/503 check
    return row


def main() -> int:
    """Run the bench over `URLS` and write the JSON report."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--mode", choices=("before", "after"), required=True)
    parser.add_argument("--out", required=True, help="JSON output path")
    parser.add_argument("--only", nargs="*", help="labels to run (default: all 10)")
    args = parser.parse_args()

    if args.mode == "before":
        if hasattr(pipeline, "probe_links"):
            parser.error("--mode before needs the unchanged (origin/main) pipeline")
        pipeline.fetch_recipe = _before_fetch_recipe  # type: ignore[assignment]
    else:
        if not hasattr(pipeline, "probe_links"):
            parser.error("--mode after needs the PR-S1.5 pipeline (probe_links)")
        _install_after_hooks()

    rows: list[dict[str, Any]] = []
    stopped: str | None = None
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    labels = [lbl for lbl in URLS if not args.only or lbl in args.only]
    for index, label in enumerate(labels):
        if index:
            time.sleep(GAP_S)
        print(f"[{index + 1}/{len(labels)}] {label}", flush=True)
        try:
            row = _run_one(label, URLS[label], args.mode)
        except StopRunError as exc:
            stopped = f"{label}: {exc}"
            rows.append({"label": label, "stopped": str(exc), "links": list(_links)})
            print(f"STOP: {stopped}", flush=True)
            break
        rows.append(row)
        print(
            f"  total={row.get('total_s')}s ytdlp={row.get('ytdlp_s')}s "
            f"probe={row.get('probe_s')}s links={len(row.get('links', []))} "
            f"blog={row.get('blog_final_url')}",
            flush=True,
        )
        out.write_text(json.dumps({"mode": args.mode, "stopped": stopped, "rows": rows}, indent=2))
    out.write_text(json.dumps({"mode": args.mode, "stopped": stopped, "rows": rows}, indent=2))
    return 1 if stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
