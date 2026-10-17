r"""PR-S1.5 probe-only re-run. INR 0, and NO YouTube traffic (no yt-dlp, no captions).

Takes each row's candidate links from a bench `before.json`, filters them with
`find_candidate_links` as the product does, and runs `probe_links` at the module's default
caps. Stop rules as in `acquire_probe_bench.py`: any 429, a bot/captcha page or a non-Amazon
503 ends the run. No retries. At least GAP_S between rows.

    python apps/api/scripts/probe_only_rerun.py --before notes/pr-s1-5-acquisition/before.json \\
        --out notes/pr-s1-5-acquisition/probe-only.json --repeat blog-link-only=3
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

from abc_cook.extract.acquire import pipeline  # noqa: E402
from abc_cook.extract.acquire.blog import (  # noqa: E402
    RecipePage,
    fetch_recipe_page,
    find_candidate_links,
    refuse_redirect_host,
)
from abc_cook.extract.acquire.safe_fetch import FetchedPage, fetch_html  # noqa: E402

GAP_S = 8.0
_AMAZON = re.compile(
    r"(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co|amzlink\.to|geni\.us|urlgeni\.us)$"
)
_BOT = re.compile(r"captcha|are you a robot|not a robot|unusual traffic|robot check", re.IGNORECASE)

_stop: list[str] = []


def _recording_fetch(url: str, **kwargs: Any) -> FetchedPage:
    page = fetch_html(url, **kwargs)
    host = urlparse(url).netloc.lower()
    if _BOT.search(page.text[:20000]) and not _AMAZON.search(host):
        _stop.append(f"bot/captcha page from {host}")
    return page


def _probe_fetch(url: str, deadline: float) -> RecipePage:
    if _stop:
        return RecipePage(recipe=None, reason="skipped after stop")
    host = urlparse(url).netloc.lower()
    page = fetch_recipe_page(
        url,
        allow_http=True,
        deadline=deadline,
        refuse_host=refuse_redirect_host,
        fetch=_recording_fetch,
    )
    reason = page.reason or ""
    if "http 429" in reason:
        _stop.append(f"429 from {host}")
    elif "http 503" in reason and not _AMAZON.search(host):
        _stop.append(f"503 from non-Amazon host {host}")
    return page


def main() -> int:
    """Run the probe over each row of `--before` and write a JSON report."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--before", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--repeat", action="append", default=[], help="label=N extra runs")
    args = parser.parse_args()
    repeats = {k: int(v) for k, v in (item.split("=") for item in args.repeat)}

    rows = json.loads(Path(args.before).read_text(encoding="utf-8"))["rows"]
    results: list[dict[str, Any]] = []
    first = True
    for row in rows:
        links = [entry["link"] for entry in row["links"]]
        candidates = find_candidate_links("\n".join(links))
        for run in range(repeats.get(row["label"], 1)):
            if not first:
                time.sleep(GAP_S)
            first = False
            report = pipeline.probe_links(candidates, fetch=_probe_fetch)
            result = {
                "label": row["label"],
                "run": run + 1,
                "candidates": candidates,
                "stopped": report.stopped,
                "abandoned": report.abandoned,
                "probe_s": round(sum(s for _, _, s in report.entries), 3),
                "final_url": report.final_url,
                "entries": [list(e) for e in report.entries],
            }
            results.append(result)
            print(
                f"{row['label']} run {run + 1}: {report.stopped} probe={result['probe_s']}s "
                f"blog={report.final_url}",
                flush=True,
            )
            if _stop:
                print(f"STOP: {_stop[0]}", flush=True)
                Path(args.out).write_text(json.dumps({"stop": _stop[0], "rows": results}, indent=2))
                return 1
    Path(args.out).write_text(json.dumps({"stop": None, "rows": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
