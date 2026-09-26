"""One repair pass on a graph that failed validation, else Tier 1 linear degrade.

See `COOKING_GRAPH.md` §5 ("On failure: one repair pass ... If it fails again,
degrade to a linear ... chain") and docs/M2.9-youtube-import-design.md §4.2 (Tier 1).
Only ever called when `validate.validate()` has already found violations — this module
never runs on a graph that already passed.

The repair call is narrowly scoped by construction, not just by prompt instruction:
the response schema (`RepairProposal`) physically CANNOT carry step text, attention,
duration, or freshness — it is a list of `{consumes_ingredients, produces_component,
depends_on_previous}`, one per step, matched back to the original steps by position.
Each field is optional: omitted means "leave the extracted value unchanged", and
dependency changes are additive only (CP2 decision D, see `_merge_repair`).
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

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from abc_cook.extract.adapters.base import CallUsage, EffortLevel, LLMAdapter
from abc_cook.extract.graph import GraphBuildResult, build_graph, build_linear_graph
from abc_cook.extract.validate import Violation, validate
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedRecipe

REPAIR_MODEL = "claude-sonnet-5"
"""design doc §6.2: Haiku extracts, Sonnet repairs -- "the right repair-pass model"."""

MAX_TOKENS = 8000

_PROMPT_PATH = Path(__file__).parent / "prompts" / "repair_v2.md"

Tier = Literal["repaired", "degraded"]

REPAIRABLE_RULES: frozenset[str] = frozenset(
    {"acyclic", "single_finish_sink", "no_orphans", "ingredients_consumed", "produces_consumed"}
)
"""M2.10 s18 F(repair-triage): the only `validate.Violation.rule` values a repair call
can plausibly fix, derived directly from what `StepRepair` can set --
`consumes_ingredients`, `produces_component`, `depends_on_previous` -- not guessed.
Those three fields are exactly what `graph.py` uses to derive `depends_on` edges and
consumption links, so they can change whether the graph is acyclic, has one sink, has
no orphans, and whether every ingredient/produced component is consumed -- invariants
2/3/4/5/6. Every other rule is unreachable from a `RepairProposal`, by schema, not by
prompt discipline:
  - "duration_ordering" (7) / "unattended_kind" (9): no duration or attention field.
  - "stage_refs" (10): no stage field.
  - "stated_total_min" (8): no recipe-level field; also unreachable from `validate()`
    in practice since `build_graph` now drops it unconditionally (F1) -- kept here so
    this gate stays correct if that ever changes.
  - "depends_on_exists" (1): a `graph.py` internal-consistency bug, never caused by
    what a repair proposal could have supplied.
Paying ~₹2-8 for a Sonnet call against a violation set outside this set is a
guaranteed-wasted spend, not a bounded bet -- see `repair_or_degrade`."""


class StepRepair(BaseModel):
    """The only three fields a repair pass may ever set, for one step.

    Every field defaults to None, meaning "leave the extracted value unchanged" (CP2
    decision D). A default of True/[] used to *overwrite* extraction: a response that
    simply omitted `depends_on_previous` reset an extracted, verified independence
    claim to sequential. See `_merge_repair` for how each field is applied -- repair
    fixes structure additively; it never resets a semantic decision to a default.
    """

    consumes_ingredients: list[str] | None = Field(
        default=None,
        description="Names to ADD to this step's consumes. Omit to leave unchanged.",
    )
    produces_component: str | None = Field(
        default=None,
        description="Set only to name a component a later step uses. Omit to leave unchanged.",
    )
    depends_on_previous: bool | None = Field(
        default=None,
        description=(
            "true to make this step wait for the previous one. Omit to leave unchanged. "
            "Repair can add a dependency; it can never remove one."
        ),
    )


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
    never need to re-check. `calls` is this repair attempt's LLM-call telemetry
    (M2.10 s18 F5) — 0, 1, or 2 entries (the repair call, and its one retry on a
    failed/truncated response, per `_attempt_llm_repair`), present whether the
    outcome is "repaired" or "degraded". `repair_attempted=False` means the
    repair-scope triage gate skipped the Sonnet call entirely (`calls` is then
    always `[]`) because at least one violation was outside `REPAIRABLE_RULES` --
    `skip_reason` names which rule(s).
    """

    build_result: GraphBuildResult
    tier: Tier
    calls: list[CallUsage] = field(default_factory=list)
    repair_attempted: bool = True
    skip_reason: str | None = None


def load_repair_prompt() -> str:
    """The repair system prompt (`extract/prompts/repair_v2.md`), read fresh each call."""
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
        f"depends_on_previous={step.depends_on_previous!r}"
        + (
            f", depends_on_steps={step.depends_on_steps!r}"
            if step.depends_on_steps is not None
            else ""
        )
        + "]"
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


def _merge_repair(
    original: NormalizedRecipe, proposal: RepairProposal
) -> tuple[NormalizedRecipe, list[str]] | None:
    """Apply `proposal` onto `original`'s steps, position for position.

    Returns None if the proposal doesn't have exactly one entry per original step —
    the hard guardrail against an invented or dropped step (LOCKED requirement 3). A
    None here is treated identically to a failed repair call: straight to Tier 1
    degrade. There is nothing else to reject: `RepairProposal` has no field capable of
    carrying step text, an ingredient, or a duration/attention/freshness value.

    Otherwise returns the merged recipe plus warnings naming every dependency the
    repair changed, so no change to sequencing is silent. Per field (CP2 decision D):

    - None (omitted) -> the extracted value is kept.
    - `consumes_ingredients` -> added to the extracted list, never replacing it.
    - `produces_component` -> replaces the extracted label.
    - `depends_on_previous` -> may only go False -> True (adds a dependency). A
      True -> False proposal is ignored: an extracted dependency is never removed.
    - `depends_on_steps`, `role` and the other extracted fields are untouched --
      `StepRepair` has no field for them.
    """
    if len(proposal.steps) != len(original.steps):
        return None

    merged_steps = []
    notes: list[str] = []
    for index, (orig_step, rep) in enumerate(zip(original.steps, proposal.steps, strict=True)):
        update: dict[str, object] = {}
        if rep.consumes_ingredients is not None:
            known = {name.lower() for name in orig_step.consumes_ingredients}
            added = [name for name in rep.consumes_ingredients if name.lower() not in known]
            update["consumes_ingredients"] = [
                *orig_step.consumes_ingredients,
                *dict.fromkeys(added),
            ]
        if rep.produces_component is not None:
            update["produces_component"] = rep.produces_component
        if rep.depends_on_previous is True and not orig_step.depends_on_previous:
            update["depends_on_previous"] = True
            notes.append(
                f'Repair made step {index} ("{orig_step.text[:60]}") wait for the '
                "step before it; extraction had marked it independent."
            )
        elif rep.depends_on_previous is False and orig_step.depends_on_previous:
            notes.append(
                f'Repair tried to make step {index} ("{orig_step.text[:60]}") '
                "independent; ignored -- repair can add a dependency, never remove one."
            )
        merged_steps.append(orig_step.model_copy(update=update) if update else orig_step)
    return original.model_copy(update={"steps": merged_steps}), notes


def _attempt_llm_repair(
    recipe: NormalizedRecipe,
    raw_source_text: str,
    violations: list[Violation],
    adapter: LLMAdapter,
    *,
    model: str,
    max_tokens: int,
    effort: EffortLevel | None,
) -> tuple[tuple[NormalizedRecipe, list[str]] | None, list[CallUsage]]:
    """One repair call, then merge.

    Retried once on a truncated/unparseable response (same truncation-vs-invariant-
    failure distinction `normalize.py` makes -- unchanged here per M2.10 s18's scope:
    repair calls stay bounded the way they already were, not redesigned), then merged
    against `recipe` so only the in-scope fields can differ. Returns `_merge_repair`'s
    result (the merged recipe and its dependency-change notes, or None) alongside
    every real call's usage telemetry (F5), in order.
    """
    prompt = load_repair_prompt()
    source_text = render_repair_source(recipe, violations, raw_source_text)
    calls: list[CallUsage] = []

    result = adapter.extract(
        prompt=prompt,
        source_text=source_text,
        model=model,
        max_tokens=max_tokens,
        output_type=RepairProposal,
        effort=effort,
    )
    if result.usage is not None:
        calls.append(result.usage)
    if result.recipe is None:
        result = adapter.extract(
            prompt=prompt,
            source_text=source_text,
            model=model,
            max_tokens=max_tokens,
            output_type=RepairProposal,
            effort=effort,
        )
        if result.usage is not None:
            calls.append(result.usage)
    if result.recipe is None:
        return None, calls

    return _merge_repair(recipe, result.recipe), calls


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

    unrepairable_rules = sorted({v.rule for v in violations if v.rule not in REPAIRABLE_RULES})
    if unrepairable_rules:
        # Repair-scope triage (M2.10 s18): don't pay for a Sonnet call that cannot
        # possibly fix this violation set -- skip straight to the guaranteed-safe
        # linear degrade. Never a partial attempt: even one out-of-scope violation
        # means the repaired graph would still fail validate() on that rule, so
        # `repair_or_degrade`'s own re-validation (below, for the attempted path)
        # would degrade anyway -- this only removes the wasted spend, not the
        # outcome.
        skip_reason = (
            "Skipped repair call: violation(s) outside repair's fixable scope "
            f"({', '.join(unrepairable_rules)}) -- RepairProposal cannot touch "
            "duration, attention, stage, or stated-total fields, so a repair call "
            "here would be a guaranteed-wasted spend."
        )
        degraded = build_linear_graph(recipe, raw_source_text, graph_id=graph_id, source=source)
        degraded_result = GraphBuildResult(
            graph=degraded.graph,
            node_decisions=degraded.node_decisions,
            warnings=[*degraded.warnings, "degraded", skip_reason],
            review_recommended=True,
        )
        return RepairOutcome(
            build_result=degraded_result,
            tier="degraded",
            calls=[],
            repair_attempted=False,
            skip_reason=skip_reason,
        )

    merged, calls = _attempt_llm_repair(
        recipe,
        raw_source_text,
        violations,
        adapter,
        model=model,
        max_tokens=max_tokens,
        effort=effort,
    )

    if merged is not None:
        repaired_recipe, merge_notes = merged
        candidate = build_graph(repaired_recipe, raw_source_text, graph_id=graph_id, source=source)
        if candidate.graph is not None and not validate(candidate.graph):
            repaired_result = GraphBuildResult(
                graph=candidate.graph,
                node_decisions=candidate.node_decisions,
                warnings=[
                    *candidate.warnings,
                    *merge_notes,
                    "Graph repaired after one LLM repair pass.",
                ],
                review_recommended=True,
            )
            return RepairOutcome(build_result=repaired_result, tier="repaired", calls=calls)

    degraded = build_linear_graph(recipe, raw_source_text, graph_id=graph_id, source=source)
    degraded_result = GraphBuildResult(
        graph=degraded.graph,
        node_decisions=degraded.node_decisions,
        warnings=[*degraded.warnings, "degraded"],
        review_recommended=True,
    )
    return RepairOutcome(build_result=degraded_result, tier="degraded", calls=calls)
