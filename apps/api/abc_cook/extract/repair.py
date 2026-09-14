"""One repair pass on a graph that failed validation, else Tier 1 linear degrade.

See `COOKING_GRAPH.md` §5 ("On failure: one repair pass ... If it fails again,
degrade to a linear ... chain") and docs/M2.9-youtube-import-design.md §4.2 (Tier 1).
Only ever called when `validate.validate()` has already found violations — this module
never runs on a graph that already passed.

The repair call is narrowly scoped by construction, not just by prompt instruction:
the response schema (`RepairProposal`) physically CANNOT carry step text, attention,
duration, or freshness — it is a list of `{consumes_ingredients, produces_component,
depends_on_previous}`, one per step, matched back to the original steps by position.
There is no field for the model to invent a step, an ingredient, or rewrite grounded
content into, regardless of what it tries. (An earlier version asked for the whole
recipe echoed back so a merge step could discard everything but these three fields;
live testing against the real M2.9 s15 checkpoint failure showed a 14-step recipe
echoed in full reliably truncates even at 16000 tokens — the compact shape fixes both
problems at once: the guardrail no longer depends on a merge step catching a rewrite
after the fact, and the response is small enough to reliably finish.) The repaired
recipe is then run through the *exact same* `build_graph` verification (attention-cue
grounding, freshness grounding, the independence safety test, duration clamping) as
the first pass — deterministic verification stays authoritative over whatever the
repair call claims, per §10.C.

If the repair either doesn't come back usable, or its result still fails validation,
the outcome is `build_linear_graph` — a linear chain from the same verified steps,
guaranteed to pass all ten invariants by construction (see `graph.build_graph`'s
`force_linear` docstring). This module never returns an unvalidated `CookingGraph`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from abc_cook.extract.adapters.base import EffortLevel, LLMAdapter
from abc_cook.extract.graph import GraphBuildResult, build_graph, build_linear_graph
from abc_cook.extract.validate import Violation, validate
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedRecipe

REPAIR_MODEL = "claude-sonnet-5"
"""design doc §6.2: Haiku extracts, Sonnet repairs -- "the right repair-pass model"."""

MAX_TOKENS = 8000

_PROMPT_PATH = Path(__file__).parent / "prompts" / "repair_v1.md"

Tier = Literal["repaired", "degraded"]


class StepRepair(BaseModel):
    """The only three fields a repair pass may ever set, for one step."""

    consumes_ingredients: list[str] = Field(default_factory=list)
    produces_component: str | None = Field(default=None)
    depends_on_previous: bool = Field(default=True)


class RepairProposal(BaseModel):
    """The repair call's entire response shape.

    One `StepRepair` per original step, in the same order. Matched back to the
    original steps by position — there is no id/index field because the count and
    order are already fixed by the request.
    """

    steps: list[StepRepair] = Field(default_factory=list)


@dataclass(frozen=True)
class RepairOutcome:
    """Result of `repair_or_degrade`.

    `.build_result.graph` is always set and always passes `validate()` — callers
    never need to re-check.
    """

    build_result: GraphBuildResult
    tier: Tier


def load_repair_prompt() -> str:
    """The repair system prompt (`extract/prompts/repair_v1.md`), read fresh each call."""
    return _PROMPT_PATH.read_text(encoding="utf-8")


def render_repair_source(
    recipe: NormalizedRecipe, violations: list[Violation], raw_source_text: str
) -> str:
    """The repair call's user turn: numbered steps/ingredients, violations, source.

    Deliberately not the full `NormalizedRecipe` JSON — the repair call never needs
    attention/duration/freshness fields it isn't allowed to touch, and omitting them
    keeps the input (and the model's temptation to echo them back) small.
    """
    ingredient_lines = [f"{i}. {ing.name}" for i, ing in enumerate(recipe.ingredients)]
    step_lines = [
        f"{i}. {step.text} "
        f"[currently: consumes_ingredients={step.consumes_ingredients!r}, "
        f"produces_component={step.produces_component!r}, "
        f"depends_on_previous={step.depends_on_previous!r}]"
        for i, step in enumerate(recipe.steps)
    ]
    parts = [
        "Ingredients:",
        *ingredient_lines,
        "",
        "Steps, in order, with their current consumes/produces/depends_on_previous:",
        *step_lines,
        "",
        "Problems found in the resulting graph:",
        *(f"- [{v.rule}] {v.message}" for v in violations),
        "",
        "Original source text, for reference:",
        raw_source_text,
    ]
    return "\n".join(parts)


def _merge_repair(original: NormalizedRecipe, proposal: RepairProposal) -> NormalizedRecipe | None:
    """Apply `proposal` onto `original`'s steps, position for position.

    Returns None if the proposal doesn't have exactly one entry per original step —
    the hard guardrail against an invented or dropped step (LOCKED requirement 3). A
    None here is treated identically to a failed repair call: straight to Tier 1
    degrade. There is nothing else to reject: `RepairProposal` has no field capable of
    carrying step text, an ingredient, or a duration/attention/freshness value.
    """
    if len(proposal.steps) != len(original.steps):
        return None

    merged_steps = [
        orig_step.model_copy(
            update={
                "consumes_ingredients": rep.consumes_ingredients,
                "produces_component": rep.produces_component,
                "depends_on_previous": rep.depends_on_previous,
            }
        )
        for orig_step, rep in zip(original.steps, proposal.steps, strict=True)
    ]
    return original.model_copy(update={"steps": merged_steps})


def _attempt_llm_repair(
    recipe: NormalizedRecipe,
    raw_source_text: str,
    violations: list[Violation],
    adapter: LLMAdapter,
    *,
    model: str,
    max_tokens: int,
    effort: EffortLevel | None,
) -> NormalizedRecipe | None:
    """One repair call, then merge.

    Retried once on a truncated/unparseable response (same truncation-vs-invariant-
    failure distinction `normalize.py` makes), then merged against `recipe` so only
    the in-scope fields can differ.
    """
    prompt = load_repair_prompt()
    source_text = render_repair_source(recipe, violations, raw_source_text)

    result = adapter.extract(
        prompt=prompt,
        source_text=source_text,
        model=model,
        max_tokens=max_tokens,
        output_type=RepairProposal,
        effort=effort,
    )
    if result.recipe is None:
        result = adapter.extract(
            prompt=prompt,
            source_text=source_text,
            model=model,
            max_tokens=max_tokens,
            output_type=RepairProposal,
            effort=effort,
        )
    if result.recipe is None:
        return None

    return _merge_repair(recipe, result.recipe)


def repair_or_degrade(
    recipe: NormalizedRecipe,
    raw_source_text: str,
    violations: list[Violation],
    adapter: LLMAdapter,
    *,
    graph_id: str,
    source: SourceRef,
    model: str = REPAIR_MODEL,
    max_tokens: int = MAX_TOKENS,
    effort: EffortLevel | None = "low",
) -> RepairOutcome:
    """Try one repair pass on a graph that already failed `validate()`; else degrade.

    Args:
        recipe: The same `NormalizedRecipe` that produced the failing graph.
        raw_source_text: The acquisition text, for the repair call's grounding and for
            rebuilding the graph exactly as `graph.build_graph` expects.
        violations: `validate.validate()`'s findings against the original graph. Must
            be non-empty -- this function should only be called on an actual failure
            (LOCKED requirement 1); callers, not this module, own that gate.
        adapter: The same provider boundary `normalize.py` uses.
        graph_id: Passed through to `graph.build_graph`/`build_linear_graph`.
        source: Passed through to `graph.build_graph`/`build_linear_graph`.
        model: Defaults to `REPAIR_MODEL` (Sonnet) per design doc §6.2.
        max_tokens: Output budget for the repair call.
        effort: Defaults to "low" per design doc §6.2 ("adaptive thinking at effort:
            low is the right setting"). Confirmed load-bearing empirically: against
            the real M2.9 s15 checkpoint failure, the repair call truncated even at
            16000 tokens with `effort` unset (the model's own reasoning was consuming
            the output budget before the small JSON response) and completed well
            under 8000 tokens once `effort="low"` was set.

    Returns:
        A `RepairOutcome` whose graph always passes `validate()`.

    Raises:
        ValueError: `violations` is empty. LOCKED requirement 1 — repair only ever
            runs on an actual validation failure; calling this with nothing to fix is
            a caller bug, not a legitimate no-op.
    """
    if not violations:
        raise ValueError("repair_or_degrade called with no violations to repair")

    repaired_recipe = _attempt_llm_repair(
        recipe,
        raw_source_text,
        violations,
        adapter,
        model=model,
        max_tokens=max_tokens,
        effort=effort,
    )

    if repaired_recipe is not None:
        candidate = build_graph(repaired_recipe, raw_source_text, graph_id=graph_id, source=source)
        if candidate.graph is not None and not validate(candidate.graph):
            repaired_result = GraphBuildResult(
                graph=candidate.graph,
                node_decisions=candidate.node_decisions,
                warnings=[*candidate.warnings, "Graph repaired after one LLM repair pass."],
                review_recommended=True,
            )
            return RepairOutcome(build_result=repaired_result, tier="repaired")

    degraded = build_linear_graph(recipe, raw_source_text, graph_id=graph_id, source=source)
    degraded_result = GraphBuildResult(
        graph=degraded.graph,
        node_decisions=degraded.node_decisions,
        warnings=[*degraded.warnings, "degraded"],
        review_recommended=True,
    )
    return RepairOutcome(build_result=degraded_result, tier="degraded")
