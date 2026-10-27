"""The 3a capture script's >= 5 ingredient line check, and the nutrition run script's log helpers.

Both scripts live in `scripts/` (not a package), so they are loaded by path.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import ModuleType

import pytest

from abc_cook.nutrition.match import CallRecord

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


capture = _load("capture_3a_eval")
run_script = _load("run_3a_nutrition")


@pytest.mark.parametrize(
    ("status", "n_lines", "expected"),
    [
        ("done", 3, "done"),
        ("done", 12, "done"),
        ("done", 2, "failed: 2 lines"),
        ("done", 1, "failed: 1 lines"),
        ("done", 0, "failed: 0 lines"),
        ("failed", 9, "failed"),  # an import failure keeps its own status
    ],
)
def test_capture_status_needs_three_ingredient_lines(
    status: str, n_lines: int, expected: str
) -> None:
    assert capture.capture_status(status, n_lines) == expected


def test_the_minimum_is_three_lines() -> None:
    assert capture.MIN_INGREDIENT_LINES == 3


def test_the_progress_line_is_ascii_and_says_inr() -> None:
    text = run_script.progress_line(37, 412.4, "calculated", 1, 0.1234, 1.5)
    text.encode("cp1252")  # a Windows console codec must not fail
    assert text.isascii()
    assert "INR 0.123" in text
    assert "total INR 1.50" in text


def test_every_call_is_appended_to_the_spend_log_as_a_json_line(tmp_path: Path) -> None:
    log = tmp_path / "spend.jsonl"
    run_script.append_spend_log(log, CallRecord(0.2345, 1000, 200, "gpt-5-mini", 7), 15)
    run_script.append_spend_log(log, CallRecord(None, None, None, "gpt-5-mini", 2), 16)
    rows = [json.loads(row) for row in log.read_text(encoding="utf-8").splitlines()]
    assert [r["recipe_id"] for r in rows] == [15, 16]
    assert rows[0]["cost_inr"] == 0.2345
    assert (rows[0]["input_tokens"], rows[0]["output_tokens"], rows[0]["n_lines"]) == (1000, 200, 7)
    assert rows[1]["cost_inr"] is None
