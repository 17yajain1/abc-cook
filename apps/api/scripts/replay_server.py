r"""Run the real API with a replayed import: no key, no network, no yt-dlp. INR 0.

    python apps/api/scripts/replay_server.py --fixture kadhi-pakora --script ok --port 8765
    python apps/api/scripts/replay_server.py --fixture chole-bhature-low --script invalid_json,ok

Every `POST /import` (a URL or pasted text) replays the fixture: the metadata arrives at
`--metadata-at` seconds, acquisition returns at `--done-at`, and the extraction call streams
the frozen recipe at the pace measured in REPORT T6 (one run; see `devtools/replay.py`). The
route, the draft scanner, normalize, the graph and the scheduler are the real code.

`--script` is a comma-separated list, one outcome per extraction call: ok, invalid_json,
truncated, infra, stall_after:<chars>. A call past the end repeats the last outcome. Each job
starts again at the first.

CORS allows the Vite dev server (5173) and the S2b port (5174) unless CORS_ORIGINS is set.
It reads no key: LLM_API_KEY and OPENAI_API_KEY are never touched.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

DEFAULT_ORIGINS = ",".join(
    f"http://{host}:{port}" for port in (5173, 5174) for host in ("localhost", "127.0.0.1")
)


def main() -> None:
    """Parse the command line and serve the replay app."""
    from abc_cook.devtools.replay import FIXTURE_NAMES

    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--fixture", default="kadhi-pakora", choices=FIXTURE_NAMES)
    parser.add_argument("--script", default="ok")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--speed", type=float, default=1.0, help="divide every delay (tests)")
    parser.add_argument("--metadata-at", type=float, default=3.5)
    parser.add_argument("--done-at", type=float, default=6.0)
    args = parser.parse_args()

    os.environ.setdefault("CORS_ORIGINS", DEFAULT_ORIGINS)

    import uvicorn

    from abc_cook.devtools.replay import create_replay_app, load_fixture

    app = create_replay_app(
        load_fixture(args.fixture),
        args.script.split(","),
        speed=args.speed,
        metadata_at_s=args.metadata_at,
        done_at_s=args.done_at,
    )
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
