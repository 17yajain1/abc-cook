"""Incremental reader for the streamed extraction response (PR-S2a).

The extraction call streams a `NormalizedRecipe` as compact JSON. `DraftScanner` reads it a
character at a time and surfaces two milestones before the response is complete: the
`ingredients` array (once it closes) and each step's `text` (once its closing quote
arrives). Nothing else is read, so no duration, attention, offset, serving count or total
can reach the draft: it is a transcript of what the model has said so far, not a plan.

It is a reader, not a validator. The finished response still goes through `parse`,
`normalize` and the graph invariants unchanged; a scanner that is wrong, or that breaks on
malformed JSON, can only make the draft shorter. `feed` never raises.
"""

from __future__ import annotations

import json
from typing import Any

import pydantic

from abc_cook.schema.normalized import NormalizedIngredient

MAX_DRAFT_INGREDIENTS = 80
MAX_DRAFT_STEPS = 80
MAX_STEP_TEXT_CHARS = 1000
"""Caps that bound the poll payload. A real recipe is nowhere near them."""

_FENCE = "```json"


def _decode_string(raw: str) -> str:
    """Decode the inside of a JSON string literal: escapes, unicode escapes, surrogate pairs."""
    value: str = json.loads('"' + raw + '"')
    # A lone surrogate from a half-sent escape pair cannot be UTF-8 encoded, which would
    # fail the response serialisation; replace it rather than ship it.
    return value.encode("utf-8", "replace").decode("utf-8")


def _sanitize(value: Any) -> Any:
    """`_decode_string`'s surrogate guard, applied to every string in a parsed value."""
    if isinstance(value, str):
        return value.encode("utf-8", "replace").decode("utf-8")
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    return value


class _Frame:
    """One open JSON container on the scanner's stack."""

    __slots__ = ("duplicate", "expect_key", "has_text", "key", "kind", "role")

    def __init__(self, kind: str, role: str | None = None) -> None:
        self.kind = kind  # "{" or "["
        self.role = role  # arrays only: "ingredients" / "steps" for the first such top-level key
        self.key: str | None = None  # objects only: the key whose value is being read
        self.expect_key = kind == "{"
        self.duplicate = False  # the current key already appeared at the top level
        self.has_text = False  # step objects only: the first `text` already counted


class DraftScanner:
    """Character-level scanner. `feed(delta)` is O(len(delta)); total work is O(n).

    Attributes:
        ingredients: `None` until the top-level `ingredients` array closes; then the valid
            items (an invalid item is skipped; `[]` is "complete and empty").
        steps: Each top-level `steps` element's `text`, in order, once that string closes.
        steps_complete: The `steps` array has closed.
        broken: The text stopped being parseable as the expected shape. The scanner stops
            advancing but keeps every milestone already reached.
    """

    def __init__(self) -> None:
        """Start before the first character."""
        self.ingredients: list[NormalizedIngredient] | None = None
        self.steps: list[str] = []
        self.steps_complete = False
        self.broken = False

        self._pre = ""  # text before the root object (a code fence, at most)
        self._started = False
        self._finished = False
        self._stack: list[_Frame] = []
        self._in_string = False
        self._escaped = False
        self._str_buf: list[str] | None = None  # collected only for keys and step texts
        self._str_kind: str | None = None  # "key" or "text" when collecting
        self._seen_top_keys: set[str] = set()
        self._capture: list[str] | None = None  # raw text of the ingredients array

    def feed(self, delta: str) -> bool:
        """Consume `delta`. Returns True when a milestone changed.

        Never raises: any internal failure marks the scanner broken and keeps the draft
        reached so far.
        """
        if self.broken or self._finished:
            return False
        changed = False
        try:
            for ch in delta:
                if self._step(ch):
                    changed = True
                if self.broken or self._finished:
                    break
        except Exception:
            self.broken = True
        return changed

    # -- internals -----------------------------------------------------------------

    def _step(self, ch: str) -> bool:
        if not self._started:
            return self._pre_root(ch)
        if self._capture is not None:
            self._capture.append(ch)
        if self._in_string:
            return self._in_string_char(ch)
        return self._structural(ch)

    def _pre_root(self, ch: str) -> bool:
        if ch == "{":
            head = self._pre.strip()
            if head and head != _FENCE and head != "```":
                self.broken = True
                return False
            self._started = True
            self._stack.append(_Frame("{"))
            return False
        self._pre += ch
        head = self._pre.strip()
        if head and not _FENCE.startswith(head):
            self.broken = True
        return False

    def _in_string_char(self, ch: str) -> bool:
        if self._escaped:
            self._escaped = False
            if self._str_buf is not None:
                self._str_buf.append(ch)
            return False
        if ch == "\\":
            self._escaped = True
            if self._str_buf is not None:
                self._str_buf.append(ch)
            return False
        if ch != '"':
            if self._str_buf is not None:
                self._str_buf.append(ch)
            return False
        self._in_string = False
        raw = "".join(self._str_buf) if self._str_buf is not None else None
        kind = self._str_kind
        self._str_buf = None
        self._str_kind = None
        if raw is None:
            return False
        try:
            decoded = _decode_string(raw)
        except json.JSONDecodeError:
            self.broken = True
            return False
        top = self._stack[-1]
        if kind == "key":
            top.key = decoded
            top.expect_key = False
            if len(self._stack) == 1:
                top.duplicate = decoded in self._seen_top_keys
                self._seen_top_keys.add(decoded)
            return False
        # kind == "text": a step's text value.
        if top.has_text or len(self.steps) >= MAX_DRAFT_STEPS:
            return False
        top.has_text = True
        self.steps.append(decoded[:MAX_STEP_TEXT_CHARS])
        return True

    def _structural(self, ch: str) -> bool:
        stack = self._stack
        top = stack[-1]
        if ch == '"':
            self._in_string = True
            self._escaped = False
            if top.kind == "{" and top.expect_key:
                self._str_buf, self._str_kind = [], "key"
            elif top.kind == "{" and top.key == "text" and self._is_step_object():
                self._str_buf, self._str_kind = [], "text"
            return False
        if ch == "{":
            stack.append(_Frame("{"))
            return False
        if ch == "[":
            role = None
            if len(stack) == 1 and not top.duplicate and top.key in ("ingredients", "steps"):
                role = top.key
            stack.append(_Frame("[", role))
            if role == "ingredients":
                self._capture = ["["]
            return False
        if ch == ",":
            if top.kind == "{":
                top.expect_key = True
                top.key = None
            return False
        if ch in "}]":
            return self._close(ch)
        return False

    def _is_step_object(self) -> bool:
        stack = self._stack
        return (
            len(stack) == 3
            and stack[1].kind == "["
            and stack[1].role == "steps"
            and stack[2].kind == "{"
        )

    def _close(self, ch: str) -> bool:
        stack = self._stack
        frame = stack[-1]
        if frame.kind != ("{" if ch == "}" else "["):
            self.broken = True
            return False
        stack.pop()
        if not stack:
            self._finished = True
            return False
        if frame.role == "steps":
            self.steps_complete = True
            return True
        if frame.role == "ingredients":
            return self._finish_ingredients()
        return False

    def _finish_ingredients(self) -> bool:
        raw = "".join(self._capture or [])
        self._capture = None
        try:
            items = _sanitize(json.loads(raw))
        except json.JSONDecodeError:
            self.broken = True
            return False
        valid: list[NormalizedIngredient] = []
        for item in items if isinstance(items, list) else []:
            if len(valid) >= MAX_DRAFT_INGREDIENTS:
                break
            try:
                valid.append(NormalizedIngredient.model_validate(item))
            except pydantic.ValidationError:
                continue
        self.ingredients = valid
        return True
