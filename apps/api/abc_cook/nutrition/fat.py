"""Fat lines: deep fry or shallow/plain, and which graph steps a fat line is linked to (b3-plan 2A).

Pure: text and graph in, a decision out. The calculator turns the decision into grams. The word
lists below are fixed (b3-plan "Blindness"): changing them after the holdout list is rendered
has to be reported.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Node

FatMethod = Literal["deep_fry", "shallow_or_plain"]

_FRY = r"fr(?:y|ies|ying|ied)"
DEEP = re.compile(rf"\bdeep[\s-]?{_FRY}\b", re.IGNORECASE)
SHALLOW_LINE = re.compile(
    rf"\bshallow[\s-]?{_FRY}\b|\bpan[\s-]?{_FRY}\b|\bfor greasing\b|\bfor roasting\b", re.IGNORECASE
)
FRY_LINE = re.compile(r"\bfor frying\b|\bto fry\b|\bfrying\b", re.IGNORECASE)

SHALLOW_METHOD = re.compile(
    r"\b(?:each side|both sides|other side|flip(?:s|ped|ping)?|tawa|griddle|"
    r"roast(?:s|ed|ing)?|cook on both sides)\b",
    re.IGNORECASE,
)
SUBMERGE_METHOD = re.compile(
    r"\b(?:drop(?:s|ped|ping)?|slide(?:s)? into|slide(?:s)? in|in batches|hot oil)\b",
    re.IGNORECASE,
)
_GOLDEN = re.compile(r"\bgolden\b", re.IGNORECASE)
_IN_OIL = re.compile(r"\bin (?:the )?(?:hot )?oil\b", re.IGNORECASE)

SHALLOW_VESSEL = re.compile(r"(?<!deep )(?<!deep-)\bpan\b", re.IGNORECASE)
SUBMERGE_VESSEL = re.compile(r"\b(?:kadai|kadhai|karahi)\b", re.IGNORECASE)


@dataclass(frozen=True)
class FatClass:
    """How a fat line is used, and how sure the text was."""

    method: FatMethod
    uncertain: bool = False
    deep_cue_from_steps_only: bool = False
    """The `DEEP` cue was in a linked step, not in the ingredient line."""


def fat_line_text(ing: Ingredient) -> str:
    """The line as classified: amount text, unit, name and prep note."""
    parts = [ing.qty_text or "", ing.unit or "", ing.name, ing.prep_note or ""]
    return " ".join(p.strip() for p in parts if p and p.strip())


def has_fry_line_cue(line: str) -> bool:
    """Whether the line itself says "for frying" / "to fry" / "frying"."""
    return FRY_LINE.search(line) is not None


def step_text(node: Node) -> str:
    """What a step says: its label and its instruction."""
    return f"{node.label}. {node.instruction}"


def _submerges(text: str) -> bool:
    return SUBMERGE_METHOD.search(text) is not None or (
        _GOLDEN.search(text) is not None and _IN_OIL.search(text) is not None
    )


def classify_fat(line: str, steps: Sequence[str]) -> FatClass:
    """Deep fry or shallow/plain, first rule that matches wins (b3-plan 2A).

    Args:
        line: The fat ingredient line (`fat_line_text`).
        steps: The text of the graph steps linked to the line; empty without a graph.

    Returns:
        The class, with `uncertain` set when the text could not tell the methods apart.
    """
    if DEEP.search(line):
        return FatClass("deep_fry")
    if any(DEEP.search(s) for s in steps):
        return FatClass("deep_fry", deep_cue_from_steps_only=True)
    if SHALLOW_LINE.search(line):
        return FatClass("shallow_or_plain")
    if not FRY_LINE.search(line):
        return FatClass("shallow_or_plain")
    texts = [line, *steps]
    shallow = any(SHALLOW_METHOD.search(t) for t in texts)
    submerge = any(_submerges(t) for t in texts)
    if shallow and submerge:
        return FatClass("shallow_or_plain", uncertain=True)
    if shallow:
        return FatClass("shallow_or_plain")
    if submerge:
        return FatClass("deep_fry")
    shallow_vessel = any(SHALLOW_VESSEL.search(t) for t in texts)
    submerge_vessel = any(SUBMERGE_VESSEL.search(t) for t in texts)
    if shallow_vessel and submerge_vessel:
        return FatClass("shallow_or_plain", uncertain=True)
    if shallow_vessel:
        return FatClass("shallow_or_plain")
    if submerge_vessel:
        return FatClass("deep_fry")
    return FatClass("shallow_or_plain", uncertain=True)


@dataclass(frozen=True)
class FatLinks:
    """The graph steps a fat line is linked to."""

    linked: tuple[Node, ...]
    fry_nodes: tuple[Node, ...]
    """Linked steps that also use a non-fat food: where the fat meets what is cooked."""


def link_nodes(fat_id: str, fat_ids: set[str], nodes: Sequence[Node]) -> FatLinks:
    """Walk forward from the nodes that consume `fat_id` to the first step that fries something.

    A step touches the fat when it consumes the fat or a component derived from it. It is a fry
    node when it also consumes anything that is neither a fat nor derived from this fat; the walk
    never goes past a fry node. Components derived from the fat are found by a fixpoint, so the
    order of `nodes` does not matter.
    """
    fats = fat_ids | {fat_id}
    derived: set[str] = set()

    def touches(node: Node) -> bool:
        return any(c == fat_id or c in derived for c in node.consumes)

    def is_fry(node: Node) -> bool:
        return any(c not in fats and c not in derived for c in node.consumes)

    changed = True
    while changed:
        changed = False
        for node in nodes:
            if not touches(node) or is_fry(node):
                continue
            if node.produces and node.produces not in derived:
                derived.add(node.produces)
                changed = True
    linked = tuple(n for n in nodes if touches(n))
    return FatLinks(linked, tuple(n for n in linked if is_fry(n)))


def fried_ingredient_ids(
    fry_nodes: Sequence[Node], nodes: Sequence[Node], fat_ids: set[str]
) -> list[str]:
    """Ingredient ids behind the fry nodes, each once, through the components they consume.

    Fats are left out, so the oil that is heated first never counts as the food being fried.
    """
    producer = {n.produces: n for n in nodes if n.produces}
    pending = [c for node in fry_nodes for c in node.consumes]
    seen: set[str] = set()
    out: list[str] = []
    while pending:
        ref = pending.pop(0)
        if ref in seen:
            continue
        seen.add(ref)
        if ref in producer:
            pending.extend(producer[ref].consumes)
        elif ref not in fat_ids:
            out.append(ref)
    return out
