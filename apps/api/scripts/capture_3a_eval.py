"""3a B1: capture the 30-recipe nutrition eval list as ImportOriginal fixtures.

THIS MAKES LIVE LLM CALLS (one GPT-5-mini call per row; Sonnet only if repair fires), so it
carries its own ₹ guard. Nothing here changes the pipeline: it calls the real `run_import`
with current main settings, `fresh=True` and no result cache.

Per row it writes:
  * tests/fixtures/3a-eval/<id>-<slug>.original.json   (`result.original`, corpus shape)
  * one row in notes/3a-nutrition/b1-capture-log.json   (cost, timing, tier, repair,
    failure, warnings, and what acquisition supplies for attribution)

Attribution is read from the RawAcquisition the import already fetched (blog JSON-LD author
and image, channel, title) plus, for video rows only, ONE free yt-dlp
`extract_info(download=False)` call made AFTER that row's import has finished. A blocked call
logs "attribution: blocked" and the run carries on. Instagram thumbnail URLs are probed with a
Range GET at capture time and again at the end of the run.

Resumable: a row is skipped when its fixture exists or its log row is terminal. Sequential.

Usage:
    python apps/api/scripts/capture_3a_eval.py --env-file "C:/.../ABC cook/apps/api/.env"
    python apps/api/scripts/capture_3a_eval.py --render-only     # Step 4, offline, no spend
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.acquire.pipeline import acquire as default_acquire  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402
from abc_cook.extract.postprocess import reprocess  # noqa: E402
from abc_cook.schema.normalized import ImportOriginal  # noqa: E402

CSV_PATH = REPO_ROOT / "notes" / "3a-nutrition" / "test-30.csv"
LOG_PATH = REPO_ROOT / "notes" / "3a-nutrition" / "b1-capture-log.json"
FIXTURE_DIR = API_ROOT / "tests" / "fixtures" / "3a-eval"
INGREDIENTS_MD = REPO_ROOT / "notes" / "3a-nutrition" / "test-30-ingredients.md"

BUDGET_INR = 70.0
RESERVE_INR = 5.0  # headroom for one import: stop if spent + this would exceed the budget
_STAGES = ("acquire", "extract", "build_graph", "repair", "schedule")
_VIDEO_HOSTS = ("youtube.com", "youtu.be", "instagram.com")


# --- helpers -------------------------------------------------------------------------


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def _host(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def _is_video(url: str) -> bool:
    host = _host(url)
    return any(host == h or host.endswith("." + h) for h in _VIDEO_HOSTS)


def _is_instagram(url: str) -> bool:
    return _host(url).endswith("instagram.com")


def _read_log() -> list[dict[str, Any]]:
    if LOG_PATH.exists():
        rows: list[dict[str, Any]] = json.loads(LOG_PATH.read_text(encoding="utf-8"))
        return rows
    return []


def _write_log(rows: list[dict[str, Any]]) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOG_PATH.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")


def _fixture_path(row_id: int, title: str) -> Path:
    return FIXTURE_DIR / f"{row_id}-{_slug(title)}.original.json"


def _fixture_exists(row_id: int) -> bool:
    return any(FIXTURE_DIR.glob(f"{row_id}-*.original.json"))


def _first(value: Any) -> Any:
    """JSON-LD fields are a str, a dict, or a list of either: take the first."""
    if isinstance(value, list):
        return value[0] if value else None
    return value


def _name_of(value: Any) -> str | None:
    value = _first(value)
    if isinstance(value, dict):
        name = value.get("name")
        return name if isinstance(name, str) else None
    return value if isinstance(value, str) else None


def _image_of(value: Any) -> str | None:
    value = _first(value)
    if isinstance(value, dict):
        url = value.get("url")
        return url if isinstance(url, str) else None
    return value if isinstance(value, str) else None


# --- attribution ---------------------------------------------------------------------


def _blog_attribution(raw: RawAcquisition) -> dict[str, Any]:
    node = raw.blog_recipe or {}
    return {
        "acquisition_channel": raw.channel,
        "acquisition_title": raw.title,
        "jsonld_present": raw.blog_recipe is not None,
        "jsonld_author": _name_of(node.get("author")),
        "jsonld_publisher": _name_of(node.get("publisher")),
        "jsonld_image": _image_of(node.get("image")),
    }


def _oe_expiry(url: str) -> str | None:
    """Instagram CDN URLs carry `oe=<hex unix timestamp>`: when the link stops working."""
    values = parse_qs(urlparse(url).query).get("oe")
    if not values:
        return None
    try:
        return datetime.fromtimestamp(int(values[0], 16), UTC).isoformat()
    except ValueError:
        return None


def _probe(url: str) -> int | str:
    """HTTP status of a one-byte Range GET, or the exception name."""
    try:
        response = httpx.get(url, headers={"Range": "bytes=0-0"}, timeout=20, follow_redirects=True)
        return response.status_code
    except Exception as exc:
        return type(exc).__name__


def _video_attribution(url: str) -> dict[str, Any]:
    """One free yt-dlp metadata call. Blocked (403/429/login wall) is logged, not raised."""
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 30}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        return {"attribution": "blocked", "attribution_error": f"{type(exc).__name__}: {exc}"[:300]}
    if not info:
        return {"attribution": "blocked", "attribution_error": "yt-dlp returned no data"}
    thumbnail = info.get("thumbnail")
    out: dict[str, Any] = {
        "attribution": "ok",
        "uploader": info.get("uploader"),
        "uploader_id": info.get("uploader_id"),
        "uploader_url": info.get("uploader_url"),
        "channel": info.get("channel"),
        "channel_url": info.get("channel_url"),
        "thumbnail": thumbnail,
        "thumbnail_count": len(info.get("thumbnails") or []),
    }
    if thumbnail and _is_instagram(url):
        out["thumbnail_oe_expiry"] = _oe_expiry(thumbnail)
        out["thumbnail_status_capture"] = _probe(thumbnail)
    return out


# --- one import ----------------------------------------------------------------------


def _import_row(
    row: dict[str, str], adapter: Any
) -> tuple[dict[str, Any], ImportOriginal | None]:
    """Run one live import. Returns the log row and the original (None unless `done`)."""
    row_id = int(row["id"])
    url = row["url"]
    raw_box: list[RawAcquisition] = []

    def acquire_fn(u: str) -> RawAcquisition:
        raw = default_acquire(u)
        raw_box.append(raw)
        return raw

    telemetry_box: list[ImportTelemetry] = []
    log: dict[str, Any] = {
        "id": row_id,
        "url": url,
        "title": row["title"],
        "source_type": row.get("source_type"),
        "at": datetime.now(UTC).isoformat(),
    }
    t0 = time.monotonic()
    try:
        result = run_import(
            url,
            adapter,
            graph_id=f"g_3a_{row_id}",
            acquire_fn=acquire_fn,
            on_telemetry=telemetry_box.append,
            cache=None,
            fresh=True,
        )
    except Exception as exc:
        log["wall_s"] = round(time.monotonic() - t0, 1)
        log["error"] = f"{type(exc).__name__}: {exc}"[:400]
        if not raw_box:
            # Acquisition itself failed (403, login wall, no recipe): no LLM call was made.
            log.update(status="acquisition_failed", cost_inr=0.0, spend_counted=0.0)
        else:
            # Failed after acquisition: an LLM call may have been billed and is unpriced.
            log.update(status="error_after_acquire", cost_inr=None, spend_counted=None)
        return log, None

    log["wall_s"] = round(time.monotonic() - t0, 1)
    log["status"] = result.status
    log["failure"] = result.failure
    log["warnings"] = result.warnings
    log["review_recommended"] = result.review_recommended
    if telemetry_box:
        t = telemetry_box[0]
        log["tier"] = t.tier
        log["cost_inr"] = t.cost_inr
        log["ttp_s"] = round(t.ttp_s, 1)
        log["stage_s"] = {k: round(t.stage_s.get(k, 0.0), 1) for k in _STAGES}
        log["repaired"] = bool(t.repair_attempted)
        log["repair_skip_reason"] = t.repair_skip_reason
        log["violations_pre_repair"] = t.violations_pre_repair
        log["output_tokens"] = t.output_tokens
        log["reasoning_tokens"] = t.reasoning_tokens
    else:
        log["cost_inr"] = None

    if raw_box:
        log["attribution_acquired"] = _blog_attribution(raw_box[0])
    if _is_video(url):
        log["attribution_ytdlp"] = _video_attribution(url)  # after the import, by design
    return log, result.original if result.status == "done" else None


# --- capture -------------------------------------------------------------------------


def capture(only_ids: set[int] | None, budget: float) -> None:
    """Import every unfinished row of the list, stopping at the ₹ guard."""
    from abc_cook.extract.adapters.routing import build_default_adapter

    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8")))
    rows = [r for r in rows if r["in_test_30"].strip().lower() == "yes"]
    if only_ids:
        rows = [r for r in rows if int(r["id"]) in only_ids]

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    log = _read_log()
    terminal = {r["id"] for r in log if r.get("status") not in (None, "stopped")}
    spent = sum(r["cost_inr"] or 0.0 for r in log)
    adapter = build_default_adapter()
    print(f"already spent: ₹{spent:.2f}; budget ₹{budget:.2f}", file=sys.stderr)

    for row in rows:
        row_id = int(row["id"])
        if _fixture_exists(row_id) or row_id in terminal:
            print(f"skip {row_id} (done)", file=sys.stderr)
            continue
        if spent + RESERVE_INR > budget:
            print(f"STOP: spent ₹{spent:.2f} + ₹{RESERVE_INR} reserve > ₹{budget}", file=sys.stderr)
            break
        entry, original = _import_row(row, adapter)
        log.append(entry)
        _write_log(log)  # after every row, so a crash loses nothing
        if original is not None:
            path = _fixture_path(row_id, row["title"])
            path.write_text(
                json.dumps(original.model_dump(mode="json"), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        cost = entry.get("cost_inr")
        print(
            f"done {row_id} {entry['status']} ₹{cost} {entry.get('ttp_s')}s "
            f"(wall {entry['wall_s']}s)",
            file=sys.stderr,
        )
        if cost is None:
            print(f"STOP: row {row_id} came back unpriced (cost_inr None)", file=sys.stderr)
            break
        spent += cost

    _end_of_run_thumbnail_probe(log)
    print(f"total spent: ₹{spent:.2f}", file=sys.stderr)


def _end_of_run_thumbnail_probe(log: list[dict[str, Any]]) -> None:
    for entry in log:
        yt = entry.get("attribution_ytdlp") or {}
        thumb = yt.get("thumbnail")
        if thumb and _is_instagram(entry["url"]):
            yt["thumbnail_status_end"] = _probe(thumb)
            yt["thumbnail_end_at"] = datetime.now(UTC).isoformat()
    _write_log(log)


# --- Step 4: ingredient list, offline ------------------------------------------------


def render_ingredients() -> None:
    """Write test-30-ingredients.md from the fixtures through `reprocess` (no spend)."""
    csv_rows = {
        int(r["id"]): r
        for r in csv.DictReader(CSV_PATH.open(encoding="utf-8"))
        if r["in_test_30"].strip().lower() == "yes"
    }
    lines = [
        "# 3a eval list: ingredients as the calculator will receive them",
        "",
        "Generated by `apps/api/scripts/capture_3a_eval.py --render-only` from "
        "`tests/fixtures/3a-eval/*.original.json` through `reprocess()`. "
        "Offline, no LLM. Columns are the raw `Ingredient` fields.",
        "",
    ]
    fixtures = sorted(FIXTURE_DIR.glob("*.original.json"), key=lambda p: int(p.name.split("-")[0]))
    for path in fixtures:
        row_id = int(path.name.split("-")[0])
        original = ImportOriginal.model_validate_json(path.read_text(encoding="utf-8"))
        out = reprocess(original)
        result = out.result
        graph = result.graph
        if result.status != "done" or graph is None:
            lines += [f"## {row_id}. {path.stem}", "", f"reprocess status: {result.status}", ""]
            continue
        # What the calculator will use (plan §7): the default is marked, never hidden.
        servings = f"{graph.servings}" if graph.servings_stated else f"{graph.servings} (assumed)"
        lines += [
            f"## {row_id}. {graph.title}",
            "",
            f"- Source: {csv_rows.get(row_id, {}).get('url', original.source.value)}",
            f"- Servings used by the calculator: {servings}",
            f"- Yield text: {graph.yield_text or 'none'}",
            f"- Ingredients: {len(graph.ingredients)}",
            "",
            "| group | qty_text | unit | name | prep_note | unit_canonical |",
            "|---|---|---|---|---|---|",
        ]
        groups: dict[str | None, list[Any]] = {}
        for ing in graph.ingredients:
            groups.setdefault(ing.group, []).append(ing)
        for group, items in groups.items():
            for ing in items:
                cells = [group, ing.qty_text, ing.unit, ing.name, ing.prep_note, ing.unit_canonical]
                lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")
        lines.append("")
    INGREDIENTS_MD.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {INGREDIENTS_MD}", file=sys.stderr)


def _cell(value: object) -> str:
    return "" if value is None else str(value).replace("|", "\\|").replace("\n", " ")


# --- entry ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> None:
    """Capture the eval list, or (--render-only) regenerate the ingredient list offline."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="dotenv file with the provider keys")
    parser.add_argument("--ids", type=int, nargs="*", help="only these ids")
    parser.add_argument("--budget", type=float, default=BUDGET_INR)
    parser.add_argument("--render-only", action="store_true")
    args = parser.parse_args(argv)
    if args.render_only:
        render_ingredients()
        return
    if args.env_file is None:
        parser.error("--env-file is required for a live capture")
    load_dotenv(args.env_file, override=True)
    capture(set(args.ids) if args.ids else None, args.budget)


if __name__ == "__main__":
    main()
