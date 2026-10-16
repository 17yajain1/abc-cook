"""B2 resume + oEmbed/ytimg timing. No LLM, no blog fan-out. Stops on 429/503/bot. No retries."""
from __future__ import annotations
import json, re, sys, time, urllib.request, urllib.error
import common as c
import yt_dlp
from abc_cook.extract.acquire.transcript import fetch_segments, select_track

URLS = {
    "pumpkin-pancakes": "TYZNzCnNGwA", "kadhi-pakora": "Oa2s0dklrRo", "croissant": "OzdqThvpMko",
    "vanilla-cupcakes": "YP8a6ugKQ6Y", "chole-bhature": "FU1ZVLMbWjA",
}
BOT = re.compile(r"sign in to confirm|429|503|too many requests|consent|captcha|not a bot|unusual traffic", re.I)
class Stop(Exception): ...
def gap(s=8.0): time.sleep(s)

def ytdlp(url):
    t0 = time.monotonic()
    try:
        with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 30}) as y:
            info = y.extract_info(url, download=False)
    except Exception as e:
        if BOT.search(str(e)): raise Stop(f"yt-dlp: {str(e)[:160]}")
        raise
    return info, time.monotonic() - t0

def http(url):
    t0 = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(); code = r.status; ctype = r.headers.get("content-type")
    except urllib.error.HTTPError as e:
        if e.code in (429, 503): raise Stop(f"HTTP {e.code} {url}")
        return time.monotonic() - t0, e.code, None, None
    return time.monotonic() - t0, code, ctype, body

out, stopped = {}, None
try:
    for slug, vid in URLS.items():
        url = f"https://www.youtube.com/watch?v={vid}"
        r = out.setdefault(slug, {"reps": []})
        for rep in range(2):
            gap(); info, ty = ytdlp(url)
            cap = None; meta = {}
            tr = select_track(info)
            if tr:
                gap(5); t0 = time.monotonic()
                segs, transient = fetch_segments(tr[2], max_retries=0)
                cap = time.monotonic() - t0
                if transient: raise Stop("caption transient failure")
                meta = {"track": f"{tr[0]}/{tr[1]}", "segments": len(segs)}
            r["reps"].append({"ytdlp_s": round(ty, 2), "caption_s": None if cap is None else round(cap, 2), **meta})
            print(slug, r["reps"][-1], flush=True)
        # oEmbed 1 rep, ytimg
        gap(5); dt, code, ct, body = http(f"https://www.youtube.com/oembed?url={url}&format=json")
        r["oembed"] = {"s": round(dt, 2), "code": code, "fields": sorted(json.loads(body)) if body and code == 200 else None,
                       "title": json.loads(body).get("title") if body and code == 200 else None}
        gap(5); dt, code, ct, body = http(f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")
        r["ytimg"] = {"s": round(dt, 2), "code": code, "ctype": ct, "bytes": len(body) if body else None}
        print(slug, r["oembed"], r["ytimg"], flush=True)
except Stop as s:
    stopped = str(s); print("*** STOPPED", stopped)
c.jdump(c.RAW / "acquire2.json", {"stopped": stopped, "results": out})
