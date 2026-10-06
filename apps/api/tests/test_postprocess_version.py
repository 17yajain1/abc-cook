"""POSTPROCESS_VERSION guard (A3): a behaviour change must bump the cache version.

The result cache stores the *final* plan, so it is only safe while everything between
the model's JSON and that plan is unchanged. `cache.POSTPROCESS_VERSION` is part of the
cache identity; this test hashes the post-processing modules and fails when they change
without a new version entry in `fixtures/postprocess_versions.json`.

If this fails:
  1. bump `POSTPROCESS_VERSION` in `abc_cook/extract/cache.py` by one,
  2. run `python tests/test_postprocess_version.py` and APPEND `"<new version>": "<hash>"`
     to the history file. Never edit or reorder an existing entry: an old plan stored
     under an old version must keep missing.

What is hashed: the `ast.dump` of each module with docstrings / bare string statements
removed -- so comments, formatting, line endings and docstring edits do not count, but
any code change does (including a pure refactor, which then costs one cache
invalidation). Tied to the CPython AST of the pinned Python (3.12). `extract/acquire/`
is deliberately not covered: acquisition changes are source drift, bounded by the TTL.
"""

from __future__ import annotations

import ast
import hashlib
import json
from pathlib import Path

from abc_cook.extract.cache import POSTPROCESS_VERSION

_PKG = Path(__file__).resolve().parents[1] / "abc_cook"
_HISTORY = Path(__file__).parent / "fixtures" / "postprocess_versions.json"

_EXTRACT_MODULES = (
    "graph.py",
    "validate.py",
    "repair.py",
    "normalize.py",
    "title.py",
    "corroborate.py",
    "provenance.py",
    "import_pipeline.py",
)


def _covered_files() -> list[Path]:
    files = [_PKG / "extract" / name for name in _EXTRACT_MODULES]
    files += sorted((_PKG / "schedule").glob("*.py"))
    return files


def _strip_docstrings(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if not isinstance(body, list):
            continue
        kept = [
            stmt
            for stmt in body
            if not (
                isinstance(stmt, ast.Expr)
                and isinstance(stmt.value, ast.Constant)
                and isinstance(stmt.value.value, str)
            )
        ]
        if len(kept) != len(body):
            node.body = kept or [ast.Pass()]  # type: ignore[attr-defined]


def postprocess_hash() -> str:
    """Combined hash of the docstring-stripped AST of every covered module."""
    parts: list[str] = []
    for path in _covered_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        _strip_docstrings(tree)
        digest = hashlib.sha256(ast.dump(tree).encode("utf-8")).hexdigest()
        parts.append(f"{path.relative_to(_PKG).as_posix()}:{digest}")
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _history() -> dict[str, str]:
    data: dict[str, str] = json.loads(_HISTORY.read_text(encoding="utf-8"))
    return data


def test_covered_files_exist() -> None:
    files = _covered_files()
    assert all(p.is_file() for p in files)
    assert any(p.parent.name == "schedule" for p in files)


def test_postprocess_hash_ignores_comments_docstrings_and_formatting() -> None:
    a = ast.parse('def f(x):\n    """doc"""\n    return x + 1  # c\n')
    b = ast.parse("def f(x):\n    return (x +\n        1)\n")
    c = ast.parse("def f(x):\n    return x + 2\n")
    for tree in (a, b, c):
        _strip_docstrings(tree)
    assert ast.dump(a) == ast.dump(b)
    assert ast.dump(a) != ast.dump(c)


def test_postprocess_modules_match_the_recorded_version() -> None:
    history = _history()
    current = postprocess_hash()
    assert max(int(v) for v in history) == POSTPROCESS_VERSION, (
        "POSTPROCESS_VERSION must equal the newest history entry"
    )
    assert history[str(POSTPROCESS_VERSION)] == current, (
        "Post-processing code changed since POSTPROCESS_VERSION "
        f"{POSTPROCESS_VERSION} was recorded. Bump POSTPROCESS_VERSION in "
        "abc_cook/extract/cache.py and append a new entry "
        f'"{POSTPROCESS_VERSION + 1}": "{current}" to tests/fixtures/postprocess_versions.json '
        "(run `python tests/test_postprocess_version.py`); never edit an old entry."
    )


if __name__ == "__main__":
    print(postprocess_hash())
