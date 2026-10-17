"""The replay harness must stay out of the production app (PR-S2a)."""

from __future__ import annotations

import ast
import os
import subprocess
import sys
from pathlib import Path

import abc_cook.api

_API_DIR = Path(abc_cook.api.__file__).parent


def test_no_module_under_api_imports_devtools() -> None:
    offenders: list[str] = []
    for path in _API_DIR.rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
                names += [f"{node.module}.{alias.name}" for alias in node.names]
            if any(name.startswith("abc_cook.devtools") for name in names):
                offenders.append(f"{path.name}: {names}")
    assert offenders == []


def test_importing_the_app_does_not_load_devtools() -> None:
    code = (
        "import sys, abc_cook.api.main\n"
        "loaded = [m for m in sys.modules if m.startswith('abc_cook.devtools')]\n"
        "assert not loaded, loaded\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(_API_DIR.parents[1])},
        check=False,
    )
    assert result.returncode == 0, result.stderr
