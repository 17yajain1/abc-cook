"""B2: acquisition timing (INR 0, no LLM). Live network, scratch only.

For each of the 6 fixture video URLs:
  rep 1 = SEQUENTIAL, as production does:  yt-dlp extract_info -> caption track -> blog candidate
          links one at a time until the first Recipe JSON-LD.
  rep 2 = PARALLEL variant:                yt-dlp extract_info -> (caption || every blog candidate)
          on a thread pool.  Effective blog time = when the first-in-order hit is known.

Politeness (plan B2): <=2 reps per URL (<=12 yt-dlp calls), >=5 s between any two requests to the
same host (sleeps are OUTSIDE the timed sections, so reported times are component times with no
pauses), and the whole script STOPS on HTTP 429/403/503, a bot/consent page, a caption fetch that
exhausts (max_retries=0, so no retry), or a yt-dlp "Sign in to confirm" / 429 error. No retry.

    PYTHONPATH=<abs apps/api>;<abs notes dir> python notes/investigate-extraction-speed/bench_acquire.py [--dry]
"""

from __future__ import annotations

import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import common as c
import yt_dlp
from abc_cook.extract.acquire.blog import fetch_recipe_page, find_candidate_links
from abc_cook.extract.acquire.transcript import fetch_segments, select_track

URLS = {
    "pizza-dough": "https://www.youtube.com/watch?v=WM1XcYXix0Y",
    "pumpkin-pancakes": "https://www.youtube.com/watch?v=TYZNzCnNGwA",
    "kadhi-pakora": "https://www.youtube.com/watch?v=Oa2s0dklrRo",
    "croissant": "https://www.youtube.com/watch?v=OzdqThvpMko",
    "vanilla-cupcakes": "https://www.youtube.com/watch?v=YP8a6ugKQ6Y",
    "chole-bhature": "https://www.youtube.com/watch?v=FU1ZVLMbWjA",
}
GAP_S = 5.0
YT_GAP_S = 8.0
BOT = re.compile(r"sign in to confirm|429|too many requests|consent|captcha|not a bot|unusual traffic", re.I)


class Stop(Exception):
    pass


_last: dict[str, float] = {}
_lock = threading.Lock()
stats = {"ytdlp": 0, "caption": 0, "blog": 0}


def pace(host: str, gap: float = GAP_S) -> None:
    with _lock:
        wait = _last.get(host, 0) + gap - time.monotonic()
        _last[host] = max(time.monotonic(), _last.get(host, 0) + gap)
    if wait > 0:
        time.sleep(wait)


def host_of(u: str) -> str:
    return urlparse(u).netloc.lower().removeprefix("www.")


def timed_ytdlp(url: str) -> tuple[dict, float]:
    pace("youtube.com", YT_GAP_S)
    t0 = time.monotonic()
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 30}) as y:
            info = y.extract_info(url, download=False)
    except Exception as exc:  # noqa: BLE001
        if BOT.search(str(exc)):
            raise Stop(f"yt-dlp bot/429 signal: {str(exc)[:160]}") from exc
        raise
    dt = time.monotonic() - t0
    stats["ytdlp"] += 1
    pace("youtube.com", YT_GAP_S)  # mark completion time as the last-request time
    return info, dt


def timed_caption(info: dict) -> tuple[float | None, dict]:
    tr = select_track(info)
    if tr is None:
        return None, {"track": None}
    kind, lang, turl = tr
    pace("timedtext")
    t0 = time.monotonic()
    segs, transient = fetch_segments(turl, max_retries=0)
    dt = time.monotonic() - t0
    stats["caption"] += 1
    if transient:
        raise Stop("caption fetch exhausted with max_retries=0 (429/5xx/transport) -> possible rate limit")
    return dt, {"track": f"{kind}/{lang}", "segments": len(segs)}


def timed_blog(link: str) -> tuple[float, dict]:
    h = host_of(link)
    pace(h)
    t0 = time.monotonic()
    page = fetch_recipe_page(link, allow_http=True)
    dt = time.monotonic() - t0
    stats["blog"] += 1
    reason = page.reason or ""
    if re.search(r"http (429|403|503)", reason) or BOT.search(reason):
        raise Stop(f"blog fetch {h}: {reason}")
    return dt, {"link": link, "host": h, "hit": page.recipe is not None, "reason": reason or None}


def run() -> None:
    dry = "--dry" in sys.argv
    if dry:
        print("B2 dry run: no network calls.")
        print(f"  6 URLs x 2 reps = 12 yt-dlp extract_info calls (max), spaced >= {YT_GAP_S}s")
        print("  rep 1 sequential: yt-dlp, caption (max_retries=0), blog candidates one by one until first hit")
        print("  rep 2 parallel  : yt-dlp, then caption || all blog candidates (thread pool)")
        print(f"  >= {GAP_S}s between any two requests to the same host; STOP on 429/403/503/bot/consent, no retry")
        return
    results: dict[str, dict] = {}
    stopped: str | None = None
    try:
        for slug, url in URLS.items():
            r: dict = {"url": url}
            results[slug] = r
            # ---- rep 1: sequential ------------------------------------------------------
            info, t_y = timed_ytdlp(url)
            cap_t, cap_meta = timed_caption(info)
            cands = find_candidate_links(info.get("description") or "")
            blogs: list[dict] = []
            t_blog_seq = 0.0
            for link in cands:
                dt, meta = timed_blog(link)
                meta["s"] = round(dt, 2)
                blogs.append(meta)
                t_blog_seq += dt
                if meta["hit"]:
                    break
            r["seq"] = {
                "ytdlp_s": round(t_y, 2), "caption_s": None if cap_t is None else round(cap_t, 2),
                "caption": cap_meta, "blog_candidates_total": len(cands), "blog_fetched": blogs,
                "blog_s": round(t_blog_seq, 2),
                "total_s": round(t_y + (cap_t or 0) + t_blog_seq, 2),
            }
            print(f"{slug} seq: yt-dlp {t_y:.1f}s caption {cap_t} blog {t_blog_seq:.1f}s ({len(blogs)}/{len(cands)} candidates)", flush=True)
            # ---- rep 2: parallel --------------------------------------------------------
            info2, t_y2 = timed_ytdlp(url)
            cands2 = find_candidate_links(info2.get("description") or "")
            done_at: dict[str, float] = {}
            metas: dict[str, dict] = {}
            t0 = time.monotonic()

            def job_cap() -> tuple[float | None, dict]:
                out = timed_caption(info2)
                done_at["caption"] = time.monotonic() - t0
                return out

            def job_blog(i: int, link: str) -> None:
                dt, meta = timed_blog(link)
                meta["s"] = round(dt, 2)
                metas[str(i)] = meta
                done_at[f"blog{i}"] = time.monotonic() - t0

            with ThreadPoolExecutor(max_workers=1 + max(1, len(cands2))) as pool:
                fc = pool.submit(job_cap)
                fbs = [pool.submit(job_blog, i, l) for i, l in enumerate(cands2)]
                cap2 = fc.result()
                for f in fbs:
                    f.result()
            wall_par = time.monotonic() - t0
            # effective blog time = first-in-order hit is known once all earlier candidates have finished
            eff = 0.0
            for i in range(len(cands2)):
                eff = max(eff, done_at[f"blog{i}"])
                if metas[str(i)]["hit"]:
                    break
            par_after_ytdlp = max(done_at.get("caption", 0.0) if cap2[0] is not None else 0.0, eff)
            r["par"] = {
                "ytdlp_s": round(t_y2, 2), "caption_s": None if cap2[0] is None else round(cap2[0], 2),
                "blog_candidates_total": len(cands2), "blog_fetched": [metas[str(i)] for i in range(len(cands2))],
                "all_done_after_ytdlp_s": round(wall_par, 2), "effective_after_ytdlp_s": round(par_after_ytdlp, 2),
                "total_s": round(t_y2 + par_after_ytdlp, 2),
                "note": "same-host candidates are paced 5 s apart inside the timed section",
            }
            r["saves_s"] = round(r["seq"]["total_s"] - r["par"]["total_s"], 2)
            print(f"{slug} par: yt-dlp {t_y2:.1f}s then effective {par_after_ytdlp:.1f}s  -> saves {r['saves_s']}s vs seq", flush=True)
    except Stop as s:
        stopped = str(s)
        print(f"\n*** STOPPED: {stopped}", flush=True)
    summary = {"stopped": stopped, "fetches_run": stats, "planned": {
        "ytdlp_max": 12, "note": "caption + blog counts depend on what each video carries; see per-URL candidate counts"},
        "results": results}
    c.jdump(c.RAW / "acquire.json", summary)
    print(json.dumps({"stopped": stopped, "fetches_run": stats}, indent=2))


if __name__ == "__main__":
    run()
