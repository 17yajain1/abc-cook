"""The web fixtures record which POSTPROCESS_VERSION generated them.

The bundled feed fixtures are pipeline output, so a saved feed recipe may only be
replaced by one of them when they are as current as the server (staleness plan A5/B3).
This fails on every POSTPROCESS_VERSION bump until `make types` (which runs
`scripts/export_web_fixtures.py`) is re-run, so the stamp can never lag the code.
"""

import json
from pathlib import Path

from abc_cook.extract.cache import POSTPROCESS_VERSION

STAMP = (
    Path(__file__).resolve().parents[2]
    / "web"
    / "src"
    / "__fixtures__"
    / "postprocess-version.json"
)


def test_web_fixture_stamp_matches_postprocess_version() -> None:
    stamp = json.loads(STAMP.read_text(encoding="utf-8"))
    assert stamp == {"postprocess_version": POSTPROCESS_VERSION}, (
        "apps/web/src/__fixtures__/postprocess-version.json is stale: run `make types` "
        "(PYTHONPATH=apps/api) and commit the regenerated fixtures."
    )
