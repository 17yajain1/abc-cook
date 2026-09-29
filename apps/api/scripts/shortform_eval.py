"""Phase 0 of the short-form video import plan (`notes/shortform-video-import-plan-
2026-09-29.md`): a live, read-mostly eval over real YouTube Shorts and Instagram Reel
URLs, seeded with the owner's own ReciMe failure cases.

For each URL in `tests/fixtures/shortform/urls.json` this script:
  1. Runs the real, unmodified `acquire()` (no LLM, no cost) and records the caption/
     description situation, plus a diagnostic (not wired anywhere) speech-quality-gate
     heuristic for the "junk caption" failure class the plan describes.
  2. Runs the real, unmodified `run_import()` -- the production pipeline, live GPT-5-
     mini extraction, Sonnet repair only if a violation fires -- and records tier,
     cost (INR), step count and warnings. This is the plan's ~Rs30-60 of live spend.
  3. If there is no usable transcript AND no substantial description, fetches the
     smallest audio-only stream (yt-dlp format selection + httpx, no ffmpeg) and
     transcribes it with OpenAI's gpt-4o-mini-transcribe -- the one ASR provider this
     machine has credentials for (Groq/Sarvam keys are not in .env; see the Phase 0
     checkpoint report for that gap).

No production code changes. This script is intentionally the only place that calls
the `openai` SDK for audio transcription -- CLAUDE.md's adapter-boundary rule is about
`abc_cook/extract/adapters/`, the production LLM call path; this is a one-off research
script, not part of that path, and never will be (Phase 2, if it happens, gets its own
`acquire/asr.py` adapter).

Usage:
    python apps/api/scripts/shortform_eval.py [--limit N] [--only-platform youtube|instagram]

Writes:
    apps/api/tests/fixtures/shortform/phase0_results.json (raw, one record per URL)
    notes/shortform-video-phase0-results.md (the checkpoint report table)
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Literal

import httpx
import yt_dlp
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
API_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(API_ROOT / ".env")

sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.acquire.pipeline import acquire as default_acquire  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402

logging.basicConfig(level=logging.WARNING)

FIXTURES = API_ROOT / "tests" / "fixtures" / "shortform"
URLS_FILE = FIXTURES / "urls.json"
RESULTS_FILE = FIXTURES / "phase0_results.json"
REPORT_FILE = ROOT / "notes" / "shortform-video-phase0-results.md"

_JUNK_TAG = re.compile(r"\[(music|musique|muzic[aă]|s[á]ngeci?|sangeet)\]", re.IGNORECASE)
_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
JUNK_WORD_THRESHOLD = 8
"""Diagnostic-only placeholder, per the plan: "The threshold N is set from the Phase 0
data, not guessed." This script reports the raw word count per video; Phase 1 tunes
the real threshold from that column, not from this constant."""


def looks_junky(text: str) -> bool:
    """Heuristic only -- mirrors the plan's Phase 1 gate description, not wired
    anywhere. A transcript is "junk" if, once music/no-speech tags are stripped, it
    has fewer than `JUNK_WORD_THRESHOLD` real words."""
    stripped = _JUNK_TAG.sub("", text)
    return len(_WORD.findall(stripped)) < JUNK_WORD_THRESHOLD


def classify_bucket(raw: RawAcquisition) -> tuple[str, str]:
    """Auto-heuristic guess at written/spoken/unclear -- (bucket, reason).

    Never claims "on-screen" or "none": telling those two apart needs watching the
    video, which this script does not do. Those cases come back "unclear" with a note
    so a human (or a later vision-based leg) can resolve them.
    """
    description = (raw.description or "").strip()
    has_recipe_shaped_description = len(description) > 200 and bool(
        re.search(r"\d+\s*(g|kg|ml|l|tsp|tbsp|cup|min|gram|grams)\b", description, re.IGNORECASE)
    )
    if raw.blog_recipe is not None:
        return "written", "linked blog carries schema.org Recipe JSON-LD"
    if has_recipe_shaped_description:
        return "written", "description is long and has measurement-shaped text"
    if raw.transcript and not looks_junky(raw.transcript):
        return "spoken", f"usable {raw.transcript_kind}/{raw.transcript_lang} transcript"
    if raw.transcript and looks_junky(raw.transcript):
        return "unclear", "transcript exists but looks like junk (music-only/no speech)"
    return "unclear", "no transcript, no recipe-shaped description -- needs a manual watch (on-screen vs none)"


def smallest_audio_format(url: str) -> dict[str, Any] | None:
    """The smallest audio-only format yt-dlp exposes for `url`, or None.

    Duplicates the metadata fetch `acquire()` already made -- free (no LLM), and
    keeps this script decoupled from `youtube.py`'s internals rather than reaching
    into acquire()'s private info dict.
    """
    ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 20}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if info is None:
        return None
    formats = [
        f
        for f in (info.get("formats") or [])
        if f.get("vcodec") in (None, "none") and f.get("acodec") not in (None, "none") and f.get("url")
    ]
    if not formats:
        return None
    formats.sort(key=lambda f: (f.get("filesize") or f.get("filesize_approx") or float("inf")))
    return formats[0]


def transcribe_with_openai(audio_bytes: bytes, filename: str) -> str | None:
    """gpt-4o-mini-transcribe over raw audio bytes. Returns None on any failure --
    ASR is a best-effort diagnostic here, never something that should crash the eval."""
    import openai

    client = openai.OpenAI()
    try:
        result = client.audio.transcriptions.create(
            model="gpt-4o-mini-transcribe",
            file=(filename, audio_bytes),
        )
    except Exception as exc:  # noqa: BLE001 -- diagnostic script, record and continue
        return f"__ERROR__ {exc}"
    return result.text


def run_asr_leg(url: str) -> dict[str, Any]:
    """Fetch the smallest audio stream and transcribe it. Never raises."""
    started = time.monotonic()
    out: dict[str, Any] = {"attempted": True, "provider": "openai/gpt-4o-mini-transcribe"}
    try:
        fmt = smallest_audio_format(url)
        if fmt is None:
            out["error"] = "no audio-only format exposed"
            return out
        out["format_ext"] = fmt.get("ext")
        out["format_filesize"] = fmt.get("filesize") or fmt.get("filesize_approx")
        fetch_start = time.monotonic()
        resp = httpx.get(fmt["url"], timeout=30.0)
        resp.raise_for_status()
        out["fetch_sec"] = round(time.monotonic() - fetch_start, 2)
        out["fetched_bytes"] = len(resp.content)
        text = transcribe_with_openai(resp.content, f"audio.{fmt.get('ext') or 'm4a'}")
        if text is not None and text.startswith("__ERROR__"):
            out["error"] = text.removeprefix("__ERROR__ ")
        else:
            out["transcript"] = text
            out["transcript_junky"] = looks_junky(text or "")
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {exc}"
    out["total_sec"] = round(time.monotonic() - started, 2)
    return out


def eval_one(entry: dict[str, Any], *, run_asr: bool) -> dict[str, Any]:
    url = entry["url"]
    record: dict[str, Any] = {**entry, "acquire_error": None, "import_error": None}

    raw: RawAcquisition | None = None
    try:
        raw = default_acquire(url)
    except Exception as exc:  # noqa: BLE001
        record["acquire_error"] = f"{type(exc).__name__}: {exc}"

    if raw is not None:
        record["raw"] = {
            "title": raw.title,
            "channel": raw.channel,
            "description_len": len(raw.description or ""),
            "has_blog_recipe": raw.blog_recipe is not None,
            "transcript_kind": raw.transcript_kind,
            "transcript_lang": raw.transcript_lang,
            "transcript_len": len(raw.transcript or ""),
            "transcript_word_count": len(_WORD.findall(raw.transcript or "")),
            "transcript_junky": looks_junky(raw.transcript) if raw.transcript else None,
            "video_duration_sec": raw.video_duration_sec,
            "acquisition_warnings": raw.acquisition_warnings,
        }
        bucket, reason = classify_bucket(raw)
        record["bucket"] = bucket
        record["bucket_reason"] = reason

        needs_asr = run_asr and bucket == "unclear" and not raw.blog_recipe
        asr_result = run_asr_leg(url) if needs_asr else {"attempted": False}
        record["asr"] = asr_result
        if needs_asr and asr_result.get("transcript") and not asr_result.get("transcript_junky"):
            record["bucket"] = "spoken"
            record["bucket_reason"] = (
                "no usable caption track, but ASR recovers a real spoken method "
                "(Phase 2 candidate)"
            )
    else:
        record["bucket"] = "unclear"
        record["bucket_reason"] = "acquisition failed"
        record["asr"] = {"attempted": False}

    telemetry_box: dict[str, ImportTelemetry] = {}

    def _on_telemetry(t: ImportTelemetry) -> None:
        telemetry_box["t"] = t

    if raw is not None:
        try:
            adapter = build_default_adapter()
            result = run_import(
                url,
                adapter,
                graph_id=f"g_phase0_{abs(hash(url))}",
                on_telemetry=_on_telemetry,
            )
            record["import_status"] = result.status
            record["import_warnings"] = result.warnings
        except Exception as exc:  # noqa: BLE001
            record["import_error"] = f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=3)}"

    telemetry = telemetry_box.get("t")
    if telemetry is not None:
        record["pipeline"] = {
            "tier": telemetry.tier,
            "cost_inr": telemetry.cost_inr,
            "step_count": telemetry.step_count,
            "windows": telemetry.windows,
            "saved_min": telemetry.saved_min,
            "sources": telemetry.sources,
            "repair_attempted": telemetry.repair_attempted,
            "repair_skip_reason": telemetry.repair_skip_reason,
        }
    else:
        record["pipeline"] = None

    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--only-platform", choices=["youtube", "instagram"], default=None)
    parser.add_argument("--no-asr", action="store_true", help="skip the ASR leg entirely")
    parser.add_argument(
        "--start-at", type=int, default=0, help="skip the first N entries (resume a partial run)"
    )
    args = parser.parse_args()

    entries: list[dict[str, Any]] = json.loads(URLS_FILE.read_text(encoding="utf-8"))
    if args.only_platform:
        entries = [e for e in entries if e["platform"] == args.only_platform]
    entries = entries[args.start_at :]
    if args.limit:
        entries = entries[: args.limit]

    results: list[dict[str, Any]] = []
    if RESULTS_FILE.exists() and args.start_at:
        results = json.loads(RESULTS_FILE.read_text(encoding="utf-8"))

    running_cost = sum(
        (r.get("pipeline") or {}).get("cost_inr") or 0.0 for r in results if r.get("pipeline")
    )

    for i, entry in enumerate(entries, start=1):
        print(f"[{i}/{len(entries)}] {entry['url']} ...", flush=True)
        started = time.monotonic()
        record = eval_one(entry, run_asr=not args.no_asr)
        elapsed = time.monotonic() - started
        cost = (record.get("pipeline") or {}).get("cost_inr")
        if cost:
            running_cost += cost
        print(
            f"    tier={((record.get('pipeline') or {}).get('tier'))} "
            f"bucket={record.get('bucket')} cost=Rs{cost} "
            f"({elapsed:.1f}s, running total Rs{running_cost:.2f})",
            flush=True,
        )
        results.append(record)
        RESULTS_FILE.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\nWrote {len(results)} records to {RESULTS_FILE}")
    print(f"Running total measured cost: Rs{running_cost:.2f}")


if __name__ == "__main__":
    main()
