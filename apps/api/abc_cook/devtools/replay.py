"""A zero-cost replay of a streamed import (PR-S2a). No key, no network, no yt-dlp.

`ReplayStreamingAdapter` stands in for the LLM: it streams a frozen `NormalizedRecipe` through
the same `on_text` hook the real OpenAI adapter uses, at the pace measured in REPORT T6, so the
real route, `DraftingAdapter`, scanner, normalize, graph and scheduler all run for real.
`fixture_acquire` stands in for acquisition: it reports the metadata after a delay, then
returns the frozen `RawAcquisition`. `create_replay_app` wires both into the real FastAPI app.

What is calibrated, and what is not. The pace comes from ONE measured run (T6, kadhi at `low`:
first visible token at 7.7 s, 25.8 s for the full output, so 18.1 s of visible text). Every
fixture streams at kadhi's characters-per-second, so a longer recipe takes longer, which is
the right direction but not a measurement. Treat replay timings as a model of the shape, not
as evidence about any recipe's real latency.

Usage numbers on the `CallUsage` this returns are estimates from character counts. That is
fine for a fake and must never be copied into the real adapters, where usage is measured.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pydantic
from fastapi import FastAPI

from abc_cook.extract.acquire import MetadataCallback, RawAcquisition, SourceMetadata
from abc_cook.extract.adapters.base import (
    STREAM_IDLE_TIMEOUT_S,
    CallUsage,
    EffortLevel,
    ExtractResult,
    TextDeltaCallback,
)
from abc_cook.extract.adapters.prompting import parse
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe, RepairProposal

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"

DEFAULT_PRE_CONTENT_S = 7.7
"""Kadhi's first visible token (T6). Used when a fixture does not state reasoning tokens."""

TOKENS_PER_S = 121.0
"""Measured generation rate (T6); reasoning tokens / this = the pre-content delay."""

KADHI_VISIBLE_S = 25.8 - 7.7
"""T6's visible-text time for kadhi: 25.8 s total minus 7.7 s before the first token."""

KADHI_REPLAY_CHARS = 10_681
"""`len(kadhi-pakora recipe.model_dump_json())`, the text the replay streams for kadhi."""

CHARS_PER_S = KADHI_REPLAY_CHARS / KADHI_VISIBLE_S
"""About 590 characters a second, so kadhi's replay matches T6 (n=1)."""

CHUNK_CHARS = 8
REPAIR_DELAY_S = 8.0
"""A stated stand-in for a repair call's latency; the replay has no measurement of it."""

_PARTIAL = {"invalid_json": 0.7, "truncated": 0.6}
"""How much of the text is sent before the call ends unparseable or truncated."""


@dataclass(frozen=True)
class ReplayFixture:
    """One recipe's frozen model output and the source it came from."""

    name: str
    text: str
    raw: RawAcquisition
    repair: RepairProposal | None = None
    reasoning_tokens: int | None = None


_FIXTURE_FILES: dict[str, tuple[str, str]] = {
    "kadhi-pakora": ("import/kadhi-pakora.original.json", "import/kadhi-pakora.raw.json"),
    "croissant": ("import/croissant.original.json", "import/croissant.raw.json"),
    "pumpkin-pancakes": (
        "import/pumpkin-pancakes.original.json",
        "import/pumpkin-pancakes.raw.json",
    ),
    "vanilla-cupcakes": (
        "import/known-wrong/vanilla-cupcakes.original.json",
        "import/known-wrong/vanilla-cupcakes.raw.json",
    ),
}
CHOLE = "chole-bhature-low"
FIXTURE_NAMES = [*_FIXTURE_FILES, CHOLE]


def _replay_text(recipe: NormalizedRecipe) -> str:
    """The recipe as the model streamed it: compact JSON.

    A frozen capture made before `origin` existed (prompt v7) has no `origin` key; replaying it
    without one keeps its length, and so its pacing, the one that was measured. A recipe with an
    added step keeps the key.
    """
    if any(step.origin == "added" for step in recipe.steps):
        return recipe.model_dump_json()
    return recipe.model_dump_json(exclude={"steps": {"__all__": {"origin"}}})


def load_fixture(name: str) -> ReplayFixture:
    """Load one replay fixture by name (`FIXTURE_NAMES`)."""
    if name == CHOLE:
        recipe = NormalizedRecipe.model_validate_json(
            (FIXTURES_DIR / "stream" / "chole-bhature.low.normalized.json").read_text(
                encoding="utf-8"
            )
        )
        raw = RawAcquisition.model_validate_json(
            (FIXTURES_DIR / "import" / "known-wrong" / "chole-bhature.raw.json").read_text(
                encoding="utf-8"
            )
        )
        return ReplayFixture(name, _replay_text(recipe), raw)
    if name not in _FIXTURE_FILES:
        raise ValueError(f"unknown replay fixture {name!r}; choose from {FIXTURE_NAMES}")
    original_file, raw_file = _FIXTURE_FILES[name]
    original = ImportOriginal.model_validate_json(
        (FIXTURES_DIR / original_file).read_text(encoding="utf-8")
    )
    raw = RawAcquisition.model_validate_json((FIXTURES_DIR / raw_file).read_text(encoding="utf-8"))
    return ReplayFixture(name, _replay_text(original.recipe), raw, repair=original.repair)


def _check_outcome(outcome: str) -> str:
    if outcome in ("ok", "invalid_json", "truncated", "infra"):
        return outcome
    if outcome.startswith("stall_after:") and outcome.split(":", 1)[1].isdigit():
        return outcome
    raise ValueError(
        f"unknown replay outcome {outcome!r}; use ok, invalid_json, truncated, infra "
        "or stall_after:<chars>"
    )


class ReplayStreamingAdapter:
    """An `LLMAdapter` that streams a frozen recipe to `on_text`, one scripted call at a time.

    `script` holds one outcome per extraction call: `ok`, `invalid_json` (70% of the text, then
    unparseable), `truncated` (60%, then a length cut), `infra` (the provider fails before any
    text) or `stall_after:<chars>` (that many characters, then silence until the idle watchdog
    would fire). A call past the end of the script repeats the last outcome. `speed` divides
    every delay, for tests.
    """

    streams_text = True

    def __init__(
        self, fixture: ReplayFixture, script: list[str] | None = None, *, speed: float = 1.0
    ) -> None:
        """Replay `fixture` through `script` (default: one clean call) at `speed`x."""
        self._fixture = fixture
        self._script = [_check_outcome(o) for o in (script or ["ok"])]
        self._speed = speed
        self.calls = 0

    def _sleep_until(self, deadline: float) -> None:
        remaining = deadline - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)

    def _emit(self, text: str, on_text: TextDeltaCallback | None) -> None:
        interval = CHUNK_CHARS / (CHARS_PER_S * self._speed)
        start = time.monotonic()
        for k, i in enumerate(range(0, len(text), CHUNK_CHARS)):
            self._sleep_until(start + k * interval)
            if on_text is not None:
                on_text(text[i : i + CHUNK_CHARS])

    def extract[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None = None,
        on_text: TextDeltaCallback | None = None,
    ) -> ExtractResult[T]:
        """Replay one call. A repair call returns the fixture's stored proposal, if any."""
        started = time.monotonic()
        if output_type is not NormalizedRecipe:
            time.sleep(REPAIR_DELAY_S / self._speed)
            if self._fixture.repair is None:
                return ExtractResult(recipe=None, error="no stored repair", error_kind="infra")
            return ExtractResult(
                recipe=output_type.model_validate(self._fixture.repair.model_dump()),
                usage=self._usage(model, max_tokens, 200, None, started),
            )

        outcome = self._script[min(self.calls, len(self._script) - 1)]
        self.calls += 1
        reasoning = self._fixture.reasoning_tokens
        pre = DEFAULT_PRE_CONTENT_S if reasoning is None else reasoning / TOKENS_PER_S
        time.sleep(pre / self._speed)
        text = self._fixture.text

        if outcome == "infra":
            return ExtractResult(recipe=None, error="APIConnectionError", error_kind="infra")
        if outcome.startswith("stall_after:"):
            self._emit(text[: int(outcome.split(":", 1)[1])], on_text)
            time.sleep(STREAM_IDLE_TIMEOUT_S / self._speed)
            return ExtractResult(recipe=None, error="StreamIdleTimeout", error_kind="infra")
        if outcome in _PARTIAL:
            sent = text[: int(len(text) * _PARTIAL[outcome])]
            self._emit(sent, on_text)
            usage = self._usage(model, max_tokens, len(sent), reasoning, started)
            if outcome == "truncated":
                return ExtractResult(
                    recipe=None,
                    truncated=True,
                    error="max_tokens",
                    error_kind="truncated",
                    usage=usage,
                    raw_text=sent,
                )
            return ExtractResult(
                recipe=None,
                error=f"response was not valid {output_type.__name__} JSON",
                error_kind="unparseable",
                usage=usage,
                raw_text=sent,
            )
        self._emit(text, on_text)
        usage = self._usage(model, max_tokens, len(text), reasoning, started)
        parsed = parse(text, output_type)
        if parsed is None:
            return ExtractResult(
                recipe=None,
                error=f"response was not valid {output_type.__name__} JSON",
                error_kind="unparseable",
                usage=usage,
                raw_text=text,
            )
        return ExtractResult(recipe=parsed, usage=usage)

    def _usage(
        self, model: str, max_tokens: int, chars: int, reasoning: int | None, started: float
    ) -> CallUsage:
        return CallUsage(
            model=model,
            input_tokens=len(self._fixture.raw.description or "") // 4 + 3_000,
            output_tokens=chars // 3 + (reasoning or 0),
            cache_read_input_tokens=0,
            cache_creation_input_tokens=None,
            stop_reason="stop",
            latency_ms=(time.monotonic() - started) * 1000,
            max_tokens_requested=max_tokens,
            reasoning_tokens=reasoning,
        )


def fixture_acquire(
    raw: RawAcquisition,
    *,
    metadata_at_s: float = 3.5,
    done_at_s: float = 6.0,
    speed: float = 1.0,
) -> Callable[..., RawAcquisition]:
    """An acquire stand-in: report the metadata at `metadata_at_s`, return `raw` at `done_at_s`.

    The defaults come from PR-S1.5's measurements (`acquired` at 3.2-4.5 s, kadhi's acquire
    about 6 s). Pasted-text jobs never call it.
    """

    def acquire(url: str, /, *, on_metadata: MetadataCallback | None = None) -> RawAcquisition:
        time.sleep(metadata_at_s / speed)
        if on_metadata is not None:
            on_metadata(
                SourceMetadata(title=raw.title, channel=raw.channel, description=raw.description)
            )
        time.sleep(max(done_at_s - metadata_at_s, 0.0) / speed)
        return raw

    return acquire


def create_replay_app(
    fixture: ReplayFixture,
    script: list[str] | None = None,
    *,
    speed: float = 1.0,
    metadata_at_s: float = 3.5,
    done_at_s: float = 6.0,
) -> FastAPI:
    """The real FastAPI app with the replay adapter and stand-in acquire injected."""
    from abc_cook.api.main import create_app
    from abc_cook.api.routes import import_ as import_routes

    app = create_app()
    acquire = fixture_acquire(
        fixture.raw, metadata_at_s=metadata_at_s, done_at_s=done_at_s, speed=speed
    )
    # A fresh adapter per request, so each job starts at the first outcome in `script`.
    app.dependency_overrides[import_routes.get_adapter] = lambda: ReplayStreamingAdapter(
        fixture, script, speed=speed
    )
    app.dependency_overrides[import_routes.get_acquire] = lambda: acquire
    app.dependency_overrides[import_routes.get_result_cache] = lambda: None
    return app
