"""Turns a streaming extraction call into a live `StreamedDraft` (PR-S2a).

`DraftingAdapter` wraps the job's adapter. For a `NormalizedRecipe` extraction on an adapter
that streams, it feeds each text delta to a `DraftScanner` and reports the draft as the
ingredients and steps complete. Everything else (repair's `RepairProposal`, an adapter that
does not stream, or streaming switched off) passes straight through, so the wrapper changes
neither what the model is asked nor what comes back.

A draft can never fail an import: a scanner or callback error is swallowed with one
WARNING per call, and the real result is returned untouched.

Fill, never replace (plan R3). A section (ingredients, steps) belongs to the first call that
produced any item for it. A retry or an escalation writes new wording; swapping it in would
rewrite rows under the cook's eyes, so a later call only fills a section that is still empty.
If call 1 stops partway, its partial list stays, with the section's `*_complete` false.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import pydantic

from abc_cook.extract.adapters.base import (
    EffortLevel,
    ExtractResult,
    LLMAdapter,
    added_steps_enabled,
)
from abc_cook.extract.draft import DraftScanner
from abc_cook.schema.api import DraftStep, StreamedDraft
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe

_logger = logging.getLogger(__name__)


def _seconds(started: float, at: float | None) -> str:
    return "n/a" if at is None else f"{at - started:.1f}"


class DraftingAdapter:
    """An `LLMAdapter` that reports a growing draft while the inner adapter streams."""

    def __init__(
        self,
        inner: LLMAdapter,
        on_draft: Callable[[StreamedDraft], None],
        *,
        graph_id: str = "",
    ) -> None:
        """Wrap `inner`.

        Args:
            inner: The adapter that does the work.
            on_draft: Called with the whole draft each time it changes. Runs on the thread
                that is reading the stream, so it must be quick and must not block.
            graph_id: Only for the log line.
        """
        self._inner = inner
        self._on_draft = on_draft
        self._graph_id = graph_id
        self._calls = 0
        self._ingredients: list[NormalizedIngredient] = []
        self._ingredients_call = 0  # the call that owns the ingredients; 0 = none yet
        self._ingredients_complete = False
        self._steps: list[str] = []
        self._step_added: list[bool] = []
        self._steps_call = 0  # the call that owns the steps; 0 = none yet
        self._steps_complete = False

    @property
    def streams_text(self) -> bool:
        """Whether the wrapped adapter streams."""
        return bool(getattr(self._inner, "streams_text", False))

    def extract[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None = None,
    ) -> ExtractResult[T]:
        """See `LLMAdapter.extract`. Drafts only a streamed `NormalizedRecipe` call."""
        if output_type is not NormalizedRecipe or not self.streams_text:
            return self._inner.extract(
                prompt=prompt,
                source_text=source_text,
                model=model,
                max_tokens=max_tokens,
                output_type=output_type,
                effort=effort,
            )

        self._calls += 1
        call = self._calls
        scanner = DraftScanner(origin_aware=added_steps_enabled())
        started = time.monotonic()
        marks: dict[str, float] = {}
        failed = False
        if self._has_content():
            # A retry or escalation is starting: say so, without touching what is shown.
            failed = self._publish()

        def on_text(delta: str) -> None:
            nonlocal failed
            if failed:
                return
            try:
                marks.setdefault("first_content", time.monotonic())
                if scanner.feed(delta) and self._merge(call, scanner, marks):
                    failed = self._publish()
            except Exception:
                failed = True
                _logger.warning("draft: scanner or callback raised; no more draft updates")

        try:
            # `streams_text` was checked above; the Protocol does not declare `on_text`.
            result = self._inner.extract(  # type: ignore[call-arg]
                prompt=prompt,
                source_text=source_text,
                model=model,
                max_tokens=max_tokens,
                output_type=output_type,
                effort=effort,
                on_text=on_text,
            )
        finally:
            _logger.info(
                "draft: graph_id=%s call=%d first_content_s=%s first_ingredient_s=%s "
                "ingredients_s=%s first_step_s=%s ingredients=%d steps=%d complete=%s broken=%s",
                self._graph_id,
                call,
                _seconds(started, marks.get("first_content")),
                _seconds(started, marks.get("first_ingredient")),
                _seconds(started, marks.get("ingredients")),
                _seconds(started, marks.get("first_step")),
                len(scanner.ingredients),
                len(scanner.steps),
                scanner.steps_complete,
                scanner.broken,
            )
        return result

    # -- draft state --------------------------------------------------------------------

    def _has_content(self) -> bool:
        return bool(self._ingredients) or self._ingredients_complete or bool(self._steps)

    def _merge(self, call: int, scanner: DraftScanner, marks: dict[str, float]) -> bool:
        """Fold this call's milestones in, fill-never-replace. True when the draft changed."""
        changed = False
        if scanner.ingredients and self._ingredients_call == 0:
            self._ingredients_call = call  # the first call to produce an item owns the list
            self._ingredients_complete = False  # an earlier "no ingredients" is superseded
        if self._ingredients_call == call:
            if len(scanner.ingredients) != len(self._ingredients):
                if not self._ingredients:
                    marks.setdefault("first_ingredient", time.monotonic())
                self._ingredients = list(scanner.ingredients)
                changed = True
            if scanner.ingredients_complete and not self._ingredients_complete:
                self._ingredients_complete = True
                marks.setdefault("ingredients", time.monotonic())
                changed = True
        elif (
            self._ingredients_call == 0
            and scanner.ingredients_complete
            and not self._ingredients_complete
        ):
            self._ingredients_complete = True  # the model said "no ingredients"
            changed = True
        if scanner.steps and self._steps_call == 0:
            self._steps_call = call  # the first call to produce a step owns the steps
        if self._steps_call == call:
            if len(scanner.steps) != len(self._steps):
                if not self._steps:
                    marks.setdefault("first_step", time.monotonic())
                self._steps = list(scanner.steps)
                self._step_added = list(scanner.step_added)
                changed = True
            if scanner.steps_complete and not self._steps_complete and self._steps:
                self._steps_complete = True
                changed = True
        return changed

    def _publish(self) -> bool:
        """Report the draft. Returns True when the callback raised (updates then stop)."""
        draft = StreamedDraft(
            ingredients=self._ingredients,
            ingredients_complete=self._ingredients_complete,
            steps=[
                DraftStep(text=t, added=a)
                for t, a in zip(self._steps, self._step_added, strict=True)
            ],
            steps_complete=self._steps_complete,
            calls=self._calls,
        )
        try:
            self._on_draft(draft)
        except Exception:
            _logger.warning("draft: on_draft raised; no more draft updates for this call")
            return True
        return False
