"""`RawAcquisition` -> `NormalizedRecipe`. The one LLM call per import (decision 1).

See docs/M2.9-youtube-import-design.md §4.1 and §10.C, and the M2.9 implementation
locked decisions (handoff s15). The Tier 0 gate lives here: `method_grounded` is
independently recomputed as `bool(recipe.steps)`, never trusted from the model's own
field — §10.C finding 1 caught the model's structured `method_grounded=true` alongside
a self-contradicting free-text note and an empty `steps` list. Every LLM call in this
module is exactly one, except when the first attempt is truncated or unparseable, in
which case it retries once with identical inputs (LOCKED DECISION 3) before degrading.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import LLMAdapter
from abc_cook.schema.normalized import ImportResult, NormalizedRecipe

DEFAULT_MODEL = "claude-haiku-4-5-20251001"
MAX_TOKENS = 8000
"""§10.C finding 5: the richest bucket-A/D inputs neared ~4800 output tokens and
truncated at max_tokens=4000. 8000 gives headroom without changing the model."""

_PROMPT_PATH = Path(__file__).parent / "prompts" / "v1.md"


@dataclass(frozen=True)
class NormalizeOutcome:
    """Either a recipe ready for `graph.py`, or a terminal Tier 0 result.

    Exactly one of the two fields is set. `graph.py` only ever receives `.recipe`;
    a caller that gets `.tier0_result` stops the pipeline there — no graph, no
    scheduler, no repair call (LOCKED DECISION 3).
    """

    recipe: NormalizedRecipe | None
    tier0_result: ImportResult | None

    @property
    def method_grounded(self) -> bool:
        """Whether this outcome carries a graph-ready recipe."""
        return self.recipe is not None


def load_prompt() -> str:
    """The extraction system prompt (`extract/prompts/v1.md`), read fresh each call."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


def render_source_text(raw: RawAcquisition) -> str:
    """Render a `RawAcquisition` as the text the model sees.

    Blog JSON-LD (leg 2), when present, is included alongside the description rather
    than instead of it — the description may carry ingredient detail the blog omits,
    and the prompt is told to prefer the blog's structured instructions when both
    exist (design doc §4.4).
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
        parts.append("Transcript:")
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

    Calls `adapter.extract` once; retries once, identical inputs, only if the first
    attempt produced nothing usable (LOCKED DECISION 3). If the retry also fails, this
    degrades to a Tier 0 result — there is no step list to build even a linear chain
    from, so treating it as anything other than "nothing grounded" would be dishonest.
    """
    prompt = load_prompt()
    source_text = render_source_text(raw)

    result = adapter.extract(
        prompt=prompt, source_text=source_text, model=model, max_tokens=max_tokens
    )
    if result.recipe is None:
        result = adapter.extract(
            prompt=prompt, source_text=source_text, model=model, max_tokens=max_tokens
        )

    if result.recipe is None:
        warning = f"Extraction failed twice; treating as ungrounded (error: {result.error})."
        return NormalizeOutcome(recipe=None, tier0_result=_tier0_result(raw, None, [warning]))

    recipe = result.recipe
    method_grounded = bool(recipe.steps)  # NEVER trust recipe.method_grounded as emitted.
    if not method_grounded:
        return NormalizeOutcome(recipe=None, tier0_result=_tier0_result(raw, recipe, []))

    return NormalizeOutcome(recipe=recipe, tier0_result=None)
