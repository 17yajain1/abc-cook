"""`RawAcquisition` -> `NormalizedRecipe`. The one LLM call per import (decision 1).

See docs/M2.9-youtube-import-design.md §4.1 and §10.C, and the M2.9 implementation
locked decisions (handoff s15). The Tier 0 gate lives here: `method_grounded` is
independently recomputed as `bool(recipe.steps)`, never trusted from the model's own
field — §10.C finding 1 caught the model's structured `method_grounded=true` alongside
a self-contradicting free-text note and an empty `steps` list.

Every LLM call in this module is exactly one, except:
- the first attempt is unparseable (not truncated): retried once with identical
  inputs, same cap (LOCKED DECISION 3) -- sampling variance can fix that.
- the first attempt is truncated (`stop_reason == max_tokens`): NEVER retried at the
  same cap (M2.10 s18 F2 -- a truncation at a given cap reproduces deterministically).
  Escalated once to `ESCALATED_MAX_TOKENS`, unless the partial output already looks
  like a runaway generation, in which case it stops immediately. A second truncation
  after escalating also stops -- never a third generation call.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import CallUsage, ExtractResult, LLMAdapter
from abc_cook.schema.normalized import ImportResult, NormalizedRecipe

DEFAULT_MODEL = "gpt-5-mini"
"""M2.11: extraction moved from Haiku to GPT-5-mini per the M2.10 model bake-offs
(directional evidence: comparable/better grounding, cheaper, ~4x fewer output tokens
than Haiku on the same recipes). Repair stays on Sonnet (`repair.REPAIR_MODEL`) --
`adapters.routing.build_default_adapter` is what lets one call site request two
different providers by model id without this module knowing that."""
MAX_TOKENS = 16_000
"""M2.10 s18 F3: output runs ~250-310 tokens/step + ~800 header; this covers ~50
steps (Ramen's 46-step transcript sat at the edge of the old 8K/12K caps). A cap
above this is free when unused -- see ESCALATED_MAX_TOKENS for what fires on
`max_tokens`, not this default."""
ESCALATED_MAX_TOKENS = 32_000
"""The one allowed escalation rung on a real (non-runaway) truncation at MAX_TOKENS.
Never retried again past this -- see `normalize()`."""

_RUNAWAY_REPEAT_THRESHOLD = 3
"""A truncated response whose partial `"text"` field value repeats this many times
is a stuck/looping generation, not a recipe that needed more room -- escalating would
just pay for more of the same loop (M2.10 s18 diagnosis §D)."""

_STEP_TEXT_RE = re.compile(r'"text"\s*:\s*"((?:[^"\\]|\\.)*)"')


def _is_runaway(raw_text: str) -> bool:
    """Heuristic over a truncated response's partial JSON text.

    Never parsed as JSON -- it's incomplete by definition. Two independent signals,
    per §D: (a) the same step `text` value repeated >= `_RUNAWAY_REPEAT_THRESHOLD`
    times, or (b) no `"steps"` key at all despite a full-cap response -- the model
    spent its whole budget before ever reaching the steps list.
    """
    if '"steps"' not in raw_text:
        return True
    values = _STEP_TEXT_RE.findall(raw_text)
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
        if counts[value] >= _RUNAWAY_REPEAT_THRESHOLD:
            return True
    return False


_PROMPT_PATH = Path(__file__).parent / "prompts" / "v2.md"
"""v2 adds the M2.10 "Sources" section (per-field precedence across description/blog/
transcript, and the transcript-chatter rule); v1 kicked off M2.9. Kept as separate
files rather than editing v1 in place so a prior prompt version stays reproducible."""


@dataclass(frozen=True)
class NormalizeOutcome:
    """Either a recipe ready for `graph.py`, or a terminal Tier 0 result.

    Exactly one of the two fields is set. `graph.py` only ever receives `.recipe`;
    a caller that gets `.tier0_result` stops the pipeline there — no graph, no
    scheduler, no repair call (LOCKED DECISION 3).

    `calls`/`escalated`/`truncations` are this import's extraction-call telemetry
    (M2.10 s18 F5) — every real `adapter.extract` call this function made, in order.
    """

    recipe: NormalizedRecipe | None
    tier0_result: ImportResult | None
    calls: list[CallUsage] = field(default_factory=list)
    escalated: bool = False
    truncations: int = 0

    @property
    def method_grounded(self) -> bool:
        """Whether this outcome carries a graph-ready recipe."""
        return self.recipe is not None


def load_prompt() -> str:
    """The extraction system prompt (`extract/prompts/v1.md`), read fresh each call."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


_TRANSCRIPT_KIND_LABEL = {"manual": "creator subtitles", "auto": "auto-generated captions"}


def _transcript_label(raw: RawAcquisition) -> str:
    """`"Transcript (auto-generated captions, hi):"` etc. (M2.10 decision 6).

    Telling the model a transcript's provenance lets it weigh manual subtitles above
    auto-captions when they'd otherwise conflict, per the Sources section of the
    prompt.
    """
    kind = _TRANSCRIPT_KIND_LABEL.get(raw.transcript_kind or "", raw.transcript_kind or "unknown")
    lang = raw.transcript_lang or "unknown language"
    return f"Transcript ({kind}, {lang}):"


def render_source_text(raw: RawAcquisition) -> str:
    """Render a `RawAcquisition` as the text the model sees.

    Blog JSON-LD (leg 2), when present, is included alongside the description rather
    than instead of it — the description may carry ingredient detail the blog omits,
    and the prompt is told to prefer the blog's structured instructions when both
    exist (design doc §4.4). The transcript (leg 3), when present, is always included
    too (M2.10 decision 4) — never withheld behind a "sufficiency" check.
    """
    parts = [f"Title: {raw.title}"]
    if raw.channel:
        parts.append(f"Channel: {raw.channel}")
    if raw.blog_recipe is not None:
        parts.append(
            "Linked recipe blog structured data (schema.org Recipe JSON-LD) — prefer "
            "this for method text when it has instructions:"
        )
        parts.append(json.dumps(raw.blog_recipe, ensure_ascii=False, indent=2))
    if raw.description:
        parts.append("Video description:")
        parts.append(raw.description)
    if raw.transcript:
        parts.append(_transcript_label(raw))
        parts.append(raw.transcript)
    return "\n\n".join(parts)


def _tier0_result(
    raw: RawAcquisition, recipe: NormalizedRecipe | None, warnings: list[str]
) -> ImportResult:
    """Build the Tier 0 `ImportResult` — ingredients preserved, no graph."""
    return ImportResult(
        status="method_not_grounded",
        source_title=recipe.title if recipe is not None else raw.title,
        ingredients=recipe.ingredients if recipe is not None else [],
        warnings=warnings,
    )


def normalize(
    raw: RawAcquisition,
    adapter: LLMAdapter,
    *,
    model: str = DEFAULT_MODEL,
    max_tokens: int = MAX_TOKENS,
) -> NormalizeOutcome:
    """Turn one `RawAcquisition` into a `NormalizeOutcome`.

    Calls `adapter.extract` once.

    - Unparseable, not truncated: retried once, identical inputs, same cap (LOCKED
      DECISION 3) — sampling variance can fix that.
    - Truncated (`stop_reason == max_tokens`): NEVER retried at the same cap (M2.10
      s18 F2 — a truncation at a given cap reproduces deterministically, so an
      identical retry just pays for the same cut again). Escalated once to
      `ESCALATED_MAX_TOKENS`, unless the partial output already looks like a runaway
      generation (`_is_runaway`), in which case this stops immediately instead of
      paying for more of the same loop. A second truncation after escalating also
      stops — never a third generation call.

    If nothing usable ever comes back, this degrades to a Tier 0 result — there is no
    step list to build even a linear chain from, so treating it as anything other than
    "nothing grounded" would be dishonest.
    """
    prompt = load_prompt()
    source_text = render_source_text(raw)
    calls: list[CallUsage] = []
    escalated = False
    truncations = 0

    def _call(tokens: int) -> ExtractResult[NormalizedRecipe]:
        result = adapter.extract(
            prompt=prompt,
            source_text=source_text,
            model=model,
            max_tokens=tokens,
            output_type=NormalizedRecipe,
        )
        if result.usage is not None:
            calls.append(result.usage)
        return result

    result = _call(max_tokens)

    if result.truncated:
        truncations += 1
        if result.raw_text is not None and _is_runaway(result.raw_text):
            warning = (
                f"Extraction output looked like a runaway generation after "
                f"truncating at {max_tokens} tokens (repeated or missing steps); "
                "stopping rather than escalating."
            )
            return NormalizeOutcome(
                recipe=None,
                tier0_result=_tier0_result(raw, None, [warning]),
                calls=calls,
                truncations=truncations,
            )
        escalated = True
        result = _call(ESCALATED_MAX_TOKENS)
        if result.truncated:
            truncations += 1
            warning = (
                f"Extraction truncated at both {max_tokens} and "
                f"{ESCALATED_MAX_TOKENS} output tokens; stopping rather than "
                "escalating again."
            )
            return NormalizeOutcome(
                recipe=None,
                tier0_result=_tier0_result(raw, None, [warning]),
                calls=calls,
                escalated=escalated,
                truncations=truncations,
            )
    elif result.recipe is None:
        result = _call(max_tokens)

    if result.recipe is None:
        warning = f"Extraction failed twice; treating as ungrounded (error: {result.error})."
        return NormalizeOutcome(
            recipe=None,
            tier0_result=_tier0_result(raw, None, [warning]),
            calls=calls,
            escalated=escalated,
            truncations=truncations,
        )

    recipe = result.recipe
    method_grounded = bool(recipe.steps)  # NEVER trust recipe.method_grounded as emitted.
    if not method_grounded:
        return NormalizeOutcome(
            recipe=None,
            tier0_result=_tier0_result(raw, recipe, []),
            calls=calls,
            escalated=escalated,
            truncations=truncations,
        )

    return NormalizeOutcome(
        recipe=recipe, tier0_result=None, calls=calls, escalated=escalated, truncations=truncations
    )
