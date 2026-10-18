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
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import (
    CallUsage,
    EffortLevel,
    ExtractResult,
    LLMAdapter,
    added_steps_enabled,
)
from abc_cook.extract.adapters.prompting import parse_failure_reason
from abc_cook.schema.normalized import ImportFailure, ImportResult, NormalizedRecipe

_logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-5-mini"

EXTRACTION_EFFORT: EffortLevel | None = "low"
"""Reasoning effort for the extraction call: "low" per the A4 experiment and the owner
decision of 2026-10-06 (`notes/step3-effort-ab/DECISION_MEMO.md` §13.6). `None` = send
nothing, i.e. the provider default (GPT-5-mini: medium) -- the previous production
setting and the rollback value. A constant, not an env var, on purpose: it changes only
when an A/B measured on correctness first says so. `scripts/effort_ab.py` overrides it
per run."""
EXTRACTION_EFFORT_CEILING: EffortLevel = "low"
"""The highest reasoning effort `normalize()` accepts without an explicit bench override.

Order: minimal < low < medium < high < xhigh < max. `None` means the provider default
(GPT-5-mini: medium), so it counts as above the ceiling. Raising this is a deliberate
decision (S3 changes it here, in one place), made on an A/B measured on correctness first:
at `medium` a large share of the output budget goes on hidden reasoning and imports get
slower and sometimes end `incomplete` (FGC-1). Bench scripts that need another effort pass
`allow_effort_above_ceiling=True`; the API route never does."""
_EFFORT_ORDER: tuple[EffortLevel, ...] = ("minimal", "low", "medium", "high", "xhigh", "max")
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


_PROMPT_PATH_ADDED = Path(__file__).parent / "prompts" / "v8.md"
"""v8 (FGC-3/4) is v7 plus the `origin="added"` exception to "never invent", the "Steps the source
skips" section and two substitution/serving-way rules for `role`. Used only while
`ABC_COOK_ADDED_STEPS` is on; with it off (the default) the request is v7, byte for byte."""

_PROMPT_PATH = Path(__file__).parent / "prompts" / "v7.md"
"""v7 (P1 #5 Commit 4) adds `yield_text` and tightens `servings` to mean people only,
never a yield's item count. `graph.py` still verifies both independently: `yield_text`
is kept only if a number in it also appears in the source text, and the PC5 guard
discards a "stated" `servings` claim that turns out to be the same number as
`yield_text`'s own with no people word attached (a model that copied a piece count
into `servings`, exactly the failure this field split exists to catch). v6 (P1 #5
Commit 3) adds `title` guidance: a clean dish name grounded in the raw
title or the linked blog's own name, not the raw title verbatim. `title.py`'s
`resolve_title` verifies the grounding claim (case-folded, light suffix stemming) and
replaces it with a deterministic cleanup of the raw title otherwise -- same
never-trust-the-claim-as-is discipline as `label` below, applied to the one field
already on `NormalizedRecipe` before this commit. `ImportResult.source_title` is
never read from this field, resolved or not -- it is always `raw.title` verbatim
(`import_pipeline.py`), so the raw and cleaned titles stay independently available.
v5 (P1 #5 Commit 2) adds `label` -- a model-written, 1-4 word step heading -- with
the shape rules `graph.py`'s `_accept_label` verifies (word count, no leading
conditional marker, no trailing preposition/conjunction). Accepted or not, `label` is
never checked against `text` for topical accuracy; a rejected label falls back to
`_label(text)`'s own trim, same as when the model gives none at all. v4 (P0 #0) adds
three rules `graph.py`'s new verification alone can't teach the model: attach a
marker-less follow-on to the earlier OPTIONAL instruction it depends on (not the step
it will modify), give a per-side/batch/piece estimate as the whole step's total, and
treat "up to N" as a holding limit rather than the step's own duration. v3 (CP2)
replaces `depends_on_previous` with explicit `depends_on_steps`, adds optional/
alternative step roles, and refines attention; `graph.py` verifies all of it. v2 added
the M2.10 "Sources" section (per-field precedence across description/blog/transcript,
and the transcript-chatter rule); v1 kicked off M2.9. Kept as separate files rather
than editing in place so a prior prompt version stays
reproducible."""


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
    """The extraction system prompt: v8, or v7 with `ABC_COOK_ADDED_STEPS` off. Read each call."""
    path = _PROMPT_PATH_ADDED if added_steps_enabled() else _PROMPT_PATH
    return path.read_text(encoding="utf-8")


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


def _above_ceiling(effort: EffortLevel | None) -> bool:
    if effort is None:
        return True
    return _EFFORT_ORDER.index(effort) > _EFFORT_ORDER.index(EXTRACTION_EFFORT_CEILING)


def _reasoning_exhausted(result: ExtractResult[NormalizedRecipe]) -> bool:
    """A truncation that produced no visible output at all (FGC-1).

    The whole budget went on hidden reasoning. Escalating would burn the larger budget the
    same way, so the caller stops. Checked before `_is_runaway`, which would otherwise
    misread an empty text as "the model never reached the steps" (a repeat loop).
    """
    return result.truncated and result.raw_text is not None and result.raw_text.strip() == ""


def _failed_result(
    raw: RawAcquisition, failure: ImportFailure, warnings: list[str]
) -> ImportResult:
    """A terminal `failed` result: nothing was extracted, and it is not the recipe's fault.

    Distinct from Tier 0 (`method_not_grounded`), which says the *source* has no method.
    """
    return ImportResult(status="failed", failure=failure, source_title=raw.title, warnings=warnings)


_LOG_HEAD_CHARS = 2_000
_LOG_TAIL_CHARS = 500


def _log_unparseable(result: ExtractResult[NormalizedRecipe], model: str) -> None:
    """WARNING-log why a response could not be parsed (FGC-13).

    The API sets no logging config, so INFO from `abc_cook` is dropped on Cloud Run; this
    must be WARNING to be seen. Carries the response's head and tail, never a header or key.
    """
    text = result.raw_text or ""
    usage = result.usage
    _logger.warning(
        "extraction response unparseable: model=%s stop_reason=%s output_tokens=%s "
        "reasoning_tokens=%s text_len=%d reason=%s head=%r tail=%r",
        model,
        usage.stop_reason if usage else None,
        usage.output_tokens if usage else None,
        usage.reasoning_tokens if usage else None,
        len(text),
        parse_failure_reason(text, NormalizedRecipe),
        text[:_LOG_HEAD_CHARS],
        text[-_LOG_TAIL_CHARS:] if len(text) > _LOG_HEAD_CHARS else "",
    )


def _tier0_result(
    raw: RawAcquisition, recipe: NormalizedRecipe | None, warnings: list[str]
) -> ImportResult:
    """Build the Tier 0 `ImportResult` — ingredients preserved, no graph.

    P1 #5 Commit 3: `source_title` is always `raw.title` verbatim, never
    `recipe.title` — even when a recipe came back (steps empty, so still Tier 0),
    its `title` claim is a dish-name guess, not the source's own title, and the two
    are deliberately decoupled (`title.py`).
    """
    return ImportResult(
        status="method_not_grounded",
        source_title=raw.title,
        ingredients=recipe.ingredients if recipe is not None else [],
        warnings=warnings,
    )


def normalize(
    raw: RawAcquisition,
    adapter: LLMAdapter,
    *,
    model: str = DEFAULT_MODEL,
    max_tokens: int = MAX_TOKENS,
    effort: EffortLevel | None = EXTRACTION_EFFORT,
    allow_effort_above_ceiling: bool = False,
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

    - A provider failure (`error_kind == "infra"`: auth, quota, outage, network, timeout)
      on any call stops at once with a `failed` result (`failure="unavailable"`). The SDK
      has already retried once, so a same-input retry would only repeat the wait. A rejected
      request (`error_kind == "request"`, any other 4xx) stops the same way: the identical
      request would be rejected again.
    - A refusal (`error_kind == "refused"`) stops at once with `failure="refused"`.
    - A truncation with no visible output (`_reasoning_exhausted`) stops with no escalation:
      a `failed` result (`failure="incomplete"`).

    Raises:
        ValueError: `effort` is above `EXTRACTION_EFFORT_CEILING` (`None` counts as above)
            and `allow_effort_above_ceiling` is False. Raised before any call is made.

    If nothing usable ever comes back, this degrades to a Tier 0 result — there is no
    step list to build even a linear chain from, so treating it as anything other than
    "nothing grounded" would be dishonest.
    """
    if _above_ceiling(effort) and not allow_effort_above_ceiling:
        raise ValueError(
            f"extraction effort {effort!r} is above EXTRACTION_EFFORT_CEILING "
            f"({EXTRACTION_EFFORT_CEILING!r}); raise the ceiling deliberately, or pass "
            "allow_effort_above_ceiling=True from a bench script"
        )
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
            effort=effort,
        )
        if result.usage is not None:
            calls.append(result.usage)
        if result.error_kind == "unparseable":
            _log_unparseable(result, model)
        return result

    def _stop(result: ExtractResult[NormalizedRecipe]) -> NormalizeOutcome | None:
        """The terminal `failed` outcome for a result no retry can fix, or None to carry on.

        `infra` (provider or link) and `request` (a rejected request, e.g. a schema the provider
        refused: the same request would be rejected again) end as `unavailable`; a `refused`
        answer (the model declined, or the output was filtered) ends as `refused`. None of them
        is retried, and none is ever reported as a recipe with no method.
        """
        if result.error_kind == "refused":
            return NormalizeOutcome(
                recipe=None,
                tier0_result=_failed_result(
                    raw,
                    "refused",
                    [f"Extraction was refused by the provider ({result.error}); not retrying."],
                ),
                calls=calls,
                escalated=escalated,
                truncations=truncations,
            )
        if result.error_kind == "request":
            warning = f"Extraction request was rejected ({result.error}); not retrying."
            _logger.warning("extraction request rejected: model=%s error=%s", model, result.error)
        elif result.error_kind == "infra":
            warning = (
                f"Extraction provider unavailable ({result.error}); not retrying the same input."
            )
        else:
            return None
        return NormalizeOutcome(
            recipe=None,
            tier0_result=_failed_result(raw, "unavailable", [warning]),
            calls=calls,
            escalated=escalated,
            truncations=truncations,
        )

    result = _call(max_tokens)
    if (stopped := _stop(result)) is not None:
        return stopped

    if result.truncated:
        truncations += 1
        if _reasoning_exhausted(result):
            reasoning = result.usage.reasoning_tokens if result.usage is not None else None
            warning = (
                f"Extraction used its whole {max_tokens}-token budget on reasoning "
                f"(reasoning_tokens={reasoning}) and produced no visible output; stopping."
            )
            return NormalizeOutcome(
                recipe=None,
                tier0_result=_failed_result(raw, "incomplete", [warning]),
                calls=calls,
                truncations=truncations,
            )
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
        if (stopped := _stop(result)) is not None:
            return stopped
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
        if (stopped := _stop(result)) is not None:
            return stopped

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
    # NEVER trust recipe.method_grounded as emitted. A step the model added is not the source's
    # method (FGC-3): with none of the source's own, the recipe is Tier 0 and the added steps
    # are discarded, so a missing method can never be written from nothing.
    method_grounded = any(step.origin == "source" for step in recipe.steps)
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
