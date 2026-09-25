"""`NormalizedRecipe` -> `CookingGraph`. THE seam (design doc §4.1).

This is where every "the model's claim is a hint, not a fact" rule in
docs/M2.9-youtube-import-design.md §4.6/§4.7 and the M2.9 locked decisions actually
gets enforced in code:

- `attention`: honored only when `attention_cue` is a real substring of the source
  text; otherwise forced to `hands_on` (decision 4).
- `freshness`: `stated_unbounded`/`stated_numeric` honored only when `freshness_cue`
  carries a genuine immediacy marker AND is grounded in the source text; otherwise
  forced to `none` (decision 5).
- Duration: window-host durations (unattended/periodic, not explicitly stated) are
  clamped so `duration_typical == duration_min` (decision 6, §4.7); missing durations
  get a deterministic, clearly-`defaulted` fallback, never an invented "plausible"
  number attributed to the model.
- `depends_on_previous=False` is honored only when the §4.7 two-condition safety test
  passes: no shared ingredient with the immediately preceding step, and neither
  consumes a component the other produces. Otherwise: sequential, no exceptions.
  A shared pantry staple (salt, water, oil) is not a shared ingredient (CP2 E).

`graph.py` refuses (returns `outcome.graph is None`) if handed a recipe with no steps,
even though `normalize.py`'s Tier 0 gate should already have stopped the pipeline
before this is ever called — per §10.C's rule, this must not depend on every future
caller remembering the gate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from abc_cook.schema.graph import CookingGraph, SourceRef, Stage
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Attention, Node, NodeKind
from abc_cook.schema.normalized import Freshness, NormalizedRecipe, NormalizedStep, ProvenanceSource

_IMMEDIACY_MARKERS = (
    "immediately",
    "right before",
    "just before",
    "right away",
    "at the last moment",
    "just prior",
    "last minute",
    "last-minute",
)
"""§10.C finding 3: a bare "serve" is not an immediacy marker. Only these phrases are."""

_SEQUENCE_CONNECTIVES = ("then", "once", "after", "next", "now", "meanwhile")

_PREP_VERBS = (
    "chop", "dice", "mince", "peel", "grate", "wash", "rinse", "slice", "knead",
    "measure", "whisk", "beat", "wisk",
)
_UNATTENDED_PASSIVE_VERBS = (
    "bake", "roast", "simmer", "boil", "steam", "fry", "cook", "rise", "prove",
    "rest", "cool", "chill", "marinate", "soak", "preheat", "ferment",
)
_COMBINE_VERBS = ("mix", "combine", "fold", "toss", "add", "stir together", "blend")

_DEFAULT_DURATION_MIN = {
    "prep": (3, 5, 8),
    "combine": (2, 3, 5),
    "active": (5, 8, 12),
    "passive": (10, 15, 20),
    "finish": (1, 2, 3),
}
"""Deterministic fallback (min, typical, max) by kind, used only when the model gave
no numbers at all. Always recorded as `defaulted` in provenance — never presented as
an estimate the model made."""


@dataclass(frozen=True)
class NodeDecision:
    """What graph.py decided for one node, and why. Input to `provenance.py`."""

    node_id: str
    attention_source: ProvenanceSource
    duration_source: ProvenanceSource
    depends_on_previous_source: ProvenanceSource
    freshness: Freshness
    freshness_cue: str | None


@dataclass(frozen=True)
class GraphBuildResult:
    """`graph.py`'s full output: the graph, plus what provenance.py needs."""

    graph: CookingGraph | None
    node_decisions: list[NodeDecision] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    review_recommended: bool = False


def _slugify(text: str, *, max_words: int = 6) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())[:max_words]
    return "_".join(words) if words else "x"


_LABEL_VULGAR_FRACTIONS = "¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞"
_LABEL_TOKEN_RE = re.compile(
    rf"\d+(?:/\d+)?|[{_LABEL_VULGAR_FRACTIONS}]|[A-Za-z][A-Za-z']*"
)
_LABEL_PREFIX_RE = re.compile(r"^[A-Za-z]+:\s+")
_LABEL_FUNCTION_WORDS = {
    "in", "on", "or", "and", "with", "to", "your", "the", "a", "of", "for",
    "until", "then", "about", "onto", "over",
}
"""Closed-class prepositions/conjunctions/articles a label must not start or end on
(A1.1) -- a label ending or opening on one of these reads as a truncated fragment
rather than a phrase, regardless of which specific words the source used."""
_LABEL_BARE_NUMBER_RE = re.compile(r"^\d+$")
"""A trailing token that is a bare integer (no unit, no fraction) is almost always a
duration/quantity fragment truncated by max_words (e.g. "...2" of "2 minutes"), not a
meaningful label ending -- drop it (A1.1)."""


def _label(text: str, *, max_words: int = 4) -> str:
    body = _LABEL_PREFIX_RE.sub("", text)
    all_tokens = _LABEL_TOKEN_RE.findall(body)

    start = 0
    while start < len(all_tokens) - 1 and all_tokens[start].lower() in _LABEL_FUNCTION_WORDS:
        start += 1

    tokens = all_tokens[start : start + max_words]
    while tokens and (
        tokens[-1].lower() in _LABEL_FUNCTION_WORDS or _LABEL_BARE_NUMBER_RE.fullmatch(tokens[-1])
    ):
        tokens.pop()
    label = " ".join(tokens)
    return (label[:1].upper() + label[1:]) if label else text[:40]


_UNTIL_PREFIX_RE = re.compile(r"^(?:until|till)\s+", re.IGNORECASE)


def _clean_cue(cue: str | None) -> str | None:
    """Strip a leading "until"/"till" so cue text is the bare condition (A3).

    The prompt's own examples ("until golden") teach the model to include it, but
    every golden fixture's `doneness_cue` is stored *without* it -- the UI convention
    (`StageCard.tsx`, `WaitWindowBlock`) is "cue = the condition", prepending "until"
    itself. One strip point here keeps golden data and UI unchanged.
    """
    if cue is None:
        return None
    stripped = _UNTIL_PREFIX_RE.sub("", cue.strip())
    return stripped or None


_QTY_VULGAR_FRACTIONS = {
    "¼": 0.25, "½": 0.5, "¾": 0.75,
    "⅓": 1 / 3, "⅔": 2 / 3,
    "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
    "⅙": 1 / 6, "⅚": 5 / 6,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
}
_QTY_MIXED_FRACTION_RE = re.compile(r"^(\d+)\s*[-\s]\s*(\d+)\s*/\s*(\d+)$")
_QTY_PLAIN_FRACTION_RE = re.compile(r"^(\d+)\s*/\s*(\d+)$")
_QTY_DECIMAL_RE = re.compile(r"^\d+(?:\.\d+)?$")
_QTY_VULGAR_RE = re.compile(rf"^(\d+)?\s*([{''.join(_QTY_VULGAR_FRACTIONS)}])$")
_RANGE_DASHES = chr(0x2013) + chr(0x2014)  # en dash, em dash -- ASCII-safe in source (RUF001)
_QTY_RANGE_RE = re.compile(rf"^(\d+(?:\.\d+)?)\s*(?:-|[{_RANGE_DASHES}]|to)\s*(\d+(?:\.\d+)?)$")


def _parse_qty(qty: str | None) -> float | None:
    """Parse a source quantity to a single number, conservatively (A2).

    Mixed fractions ("1 1/4", "1-1/4") and unicode vulgar fractions ("½", "1½") parse
    exactly. Ranges ("2-3", "2 to 3", or an en/em-dash range) resolve to their **low
    end** -- the range text itself is never lost, since `Ingredient.qty_text` carries
    it verbatim. Vague phrases ("a pinch", "a little less than 2") return `None`; they
    too survive via `qty_text`. Never invents a number the source didn't give.
    """
    if qty is None:
        return None
    text = qty.strip()
    if not text:
        return None

    match = _QTY_MIXED_FRACTION_RE.match(text)
    if match:
        whole, numerator, denominator = (int(group) for group in match.groups())
        return whole + numerator / denominator if denominator else None

    match = _QTY_VULGAR_RE.match(text)
    if match:
        whole_text, frac_char = match.groups()
        whole = int(whole_text) if whole_text else 0
        return whole + _QTY_VULGAR_FRACTIONS[frac_char]

    match = _QTY_PLAIN_FRACTION_RE.match(text)
    if match:
        numerator, denominator = int(match.group(1)), int(match.group(2))
        return numerator / denominator if denominator else None

    if _QTY_DECIMAL_RE.match(text):
        return float(text)

    match = _QTY_RANGE_RE.match(text)
    if match:
        return float(match.group(1))  # low end -- conservative, never invents

    return None


def _verification_corpus(raw_text: str) -> str:
    return raw_text.lower()


def _is_grounded_substring(cue: str | None, corpus: str) -> bool:
    if not cue or not cue.strip():
        return False
    return cue.strip().lower() in corpus


def _verify_attention(step: NormalizedStep, corpus: str) -> tuple[Attention, ProvenanceSource]:
    """LOCKED DECISION 4.

    hands_on is trusted directly; a non-hands_on claim must carry a cue that's
    actually present in the source text, or it's forced back.
    """
    if step.attention == "hands_on":
        return "hands_on", "extracted"
    if _is_grounded_substring(step.attention_cue, corpus):
        return step.attention, "extracted"
    return "hands_on", "defaulted"


def _verify_freshness(
    step: NormalizedStep, corpus: str
) -> tuple[Freshness, str | None, int | None]:
    """LOCKED DECISION 5.

    Never invent a numeric max_lead_min; never trust stated_unbounded/stated_numeric
    without a genuine, grounded immediacy marker.
    """
    if step.freshness == "none":
        return "none", None, None
    cue = step.freshness_cue or ""
    has_marker = any(marker in cue.lower() for marker in _IMMEDIACY_MARKERS)
    grounded = has_marker and _is_grounded_substring(cue, corpus)
    if not grounded:
        return "none", None, None
    if step.freshness == "stated_numeric" and step.max_lead_min is not None:
        return "stated_numeric", cue, step.max_lead_min
    return "stated_unbounded", cue, None


def _infer_kind(text: str, attention: Attention) -> NodeKind:
    lowered = text.lower()
    if attention == "unattended":
        if any(verb in lowered for verb in _UNATTENDED_PASSIVE_VERBS):
            return "passive"
        return "prep"
    if any(verb in lowered for verb in _PREP_VERBS):
        return "prep"
    if any(verb in lowered for verb in _COMBINE_VERBS):
        return "combine"
    return "active"


def _resolve_duration(
    step: NormalizedStep, kind: NodeKind, attention: Attention
) -> tuple[int, int, int, ProvenanceSource, bool]:
    """LOCKED DECISION 6. Returns (min, typical, max, source, clamp_fired)."""
    has_values = (
        step.duration_min is not None
        and step.duration_typical_min is not None
        and step.duration_max is not None
    )
    if has_values:
        dmin = float(step.duration_min)  # type: ignore[arg-type]
        dtyp = float(step.duration_typical_min)  # type: ignore[arg-type]
        dmax = float(step.duration_max)  # type: ignore[arg-type]
        source: ProvenanceSource = "extracted" if step.duration_stated else "inferred"
    else:
        dmin, dtyp, dmax = _DEFAULT_DURATION_MIN.get(kind, (5, 8, 12))
        source = "defaulted"

    clamp_fired = False
    is_window_host = attention in ("periodic", "unattended")
    if is_window_host and not step.duration_stated and dtyp != dmin:
        dtyp = dmin
        clamp_fired = True

    # Defensive, deterministic ordering/positivity clamp — invariant 7 must hold
    # regardless of what the model returned.
    dmin_i = max(round(dmin), 1)
    dtyp_i = max(round(dtyp), dmin_i)
    dmax_i = max(round(dmax), dtyp_i)
    return dmin_i, dtyp_i, dmax_i, source, clamp_fired


_STAPLES = frozenset({"salt", "water", "oil"})
"""CP2 decision E: pantry staples two steps can both draw on without one needing the
other's output. Deliberately closed and narrow. Matched per whole word token, so "Sea
salt" and "olive oil" count (and, accepted tradeoff, so do "chilli oil" and "water
chestnut"); "Saltine" does not."""

_STAPLE_TOKEN_RE = re.compile(r"[a-z]+")


def _is_staple(name: str, produced_labels: frozenset[str]) -> bool:
    """Whether a consumed name is a pantry staple for the independence check.

    A name that is exactly some step's `produces_component` label is never a staple,
    whatever its words: it is that step's output, not a pantry item.
    """
    lowered = name.lower()
    if lowered in produced_labels:
        return False
    return any(token in _STAPLES for token in _STAPLE_TOKEN_RE.findall(lowered))


def _produced_labels(steps: list[NormalizedStep]) -> frozenset[str]:
    return frozenset(
        step.produces_component.lower()
        for step in steps
        if step.produces_component and step.produces_component.strip()
    )


def _shares_ingredient(
    a: NormalizedStep, b: NormalizedStep, produced_labels: frozenset[str]
) -> bool:
    """Whether `a` and `b` name a common ingredient other than a pantry staple."""
    a_names = {name.lower() for name in a.consumes_ingredients}
    b_names = {name.lower() for name in b.consumes_ingredients}
    return any(not _is_staple(name, produced_labels) for name in a_names & b_names)


def _consumes_others_product(a: NormalizedStep, b: NormalizedStep) -> bool:
    """Whether `a` consumes something `b` produces, or vice versa."""
    a_consumes = {name.lower() for name in a.consumes_ingredients}
    b_consumes = {name.lower() for name in b.consumes_ingredients}
    if b.produces_component and b.produces_component.lower() in a_consumes:
        return True
    return bool(a.produces_component and a.produces_component.lower() in b_consumes)


def _verify_independence(
    previous: NormalizedStep, current: NormalizedStep, produced_labels: frozenset[str]
) -> bool:
    """LOCKED DECISION 7 / design doc §4.7.

    Both conditions must hold to honor a `depends_on_previous=False` claim: no shared
    ingredient, no produces/consumes link between this step and the immediately
    preceding one. A shared pantry staple (`_STAPLES`) is not a shared ingredient for
    this test (CP2 decision E); a produced component never counts as a staple, and the
    produces/consumes link is never exempt.
    """
    if _shares_ingredient(previous, current, produced_labels):
        return False
    return not _consumes_others_product(previous, current)


def _depends_transitively(node: Node, target_id: str, nodes_by_id: dict[str, Node]) -> bool:
    """Whether `node` depends on `target_id`, directly or through other nodes (B3).

    Mirrors `validate._depends_transitively` (kept separate: this runs during
    construction, before a `CookingGraph` exists to hand to that module).
    """
    seen: set[str] = set()
    stack = list(node.depends_on)
    while stack:
        dep = stack.pop()
        if dep == target_id:
            return True
        if dep in seen:
            continue
        seen.add(dep)
        dep_node = nodes_by_id.get(dep)
        if dep_node is not None:
            stack.extend(dep_node.depends_on)
    return False


def _sequential_source(step_text: str) -> ProvenanceSource:
    stripped = step_text.strip().lower()
    first_word = stripped.split(" ", 1)[0].rstrip(",.;:") if stripped else ""
    return "extracted" if first_word in _SEQUENCE_CONNECTIVES else "inferred"


def _stage_for(index: int, total: int, kind: NodeKind) -> str:
    if index == total - 1:
        return "finish"
    if kind == "prep":
        return "prep"
    return "cook"


_STAGE_LABELS = {"prep": "Prep", "cook": "Cook", "finish": "Finish"}


def build_graph(
    recipe: NormalizedRecipe,
    raw_source_text: str,
    *,
    graph_id: str,
    source: SourceRef,
    force_linear: bool = False,
) -> GraphBuildResult:
    """`NormalizedRecipe` -> `CookingGraph`, or a refusal.

    Args:
        recipe: The normalized recipe. Must have `recipe.steps` non-empty — this is
            re-checked here even though `normalize.py`'s Tier 0 gate should already
            guarantee it (§10.C: never rely on a caller remembering the gate).
        raw_source_text: The original acquisition text (description + blog JSON-LD +
            transcript), used to verify `attention_cue`/`freshness_cue` are real
            substrings of the source, not the model's paraphrase.
        graph_id: Stable id for the resulting `CookingGraph`.
        source: Where this recipe came from.
        force_linear: Tier 1 degrade mode (`repair.py`, design doc §4.2 row 1 /
            `COOKING_GRAPH.md` §5 "degrade to a linear chain"). Discards every
            structural claim beyond stated order — independence claims, produces/
            consumes branching, and freshness structural steering — so the result is
            guaranteed to pass invariants 1-4 by construction. Attention, duration,
            and freshness verification are untouched: only graph *structure*
            (parallelism) is discarded, never grounded content. Also guarantees
            invariants 5/6 by dropping (never inventing) an assertion the content
            can't support: an ingredient no step consumes is marked `optional`; a
            node's `produces` is never asserted (nothing downstream is claimed to
            consume it in linear mode). Invariant 8 (`stated_total_min`) is dropped
            the same way regardless of `force_linear` — see below; a marketing total
            ("15 min") next to long verified passive steps must not force an
            otherwise structurally valid graph into this branch (M2.10 s18 F1).
            Invariant 9 is guaranteed too, but not by anything `force_linear` itself
            does: this branch never touches `attention` or `kind`, so a source whose
            final, grounded instruction is genuinely unattended ("let cool slightly
            before serving") still forces `kind="finish"` (line ~454) with
            `attention="unattended"` — invalid before B2, valid after it
            (`COOKING_GRAPH.md` §5.9 allows `finish` in the unattended set). The
            guarantee holds only because that relaxation exists, not because
            `force_linear` does anything special for it.

    Returns:
        A `GraphBuildResult`. `.graph` is None only when `recipe.steps` is empty —
        callers must treat that identically to `normalize.py`'s own Tier 0 gate.
    """
    if not recipe.steps:
        return GraphBuildResult(graph=None, warnings=["No steps to build a graph from."])

    corpus = _verification_corpus(raw_source_text)
    warnings: list[str] = []
    review_recommended = False

    # -- Ingredients --------------------------------------------------------------
    ingredients: list[Ingredient] = []
    seen_ing_ids: set[str] = set()
    name_to_ids: dict[str, list[str]] = {}
    for norm_ing in recipe.ingredients:
        base_id = f"ing_{_slugify(norm_ing.name, max_words=3)}"
        ing_id = base_id
        suffix = 2
        while ing_id in seen_ing_ids:
            ing_id = f"{base_id}_{suffix}"
            suffix += 1
        seen_ing_ids.add(ing_id)
        # A name can legitimately repeat (design doc §10.C, real data: "Garlic
        # chopped" listed once for the base and again under "Tempering"). Keep every
        # id sharing a name, not just the last one written -- a single dict[name, id]
        # made an earlier occurrence permanently unconsumable regardless of what any
        # step claimed, a real bug found running repair.py against a real recipe.
        name_to_ids.setdefault(norm_ing.name.lower(), []).append(ing_id)
        ingredients.append(
            Ingredient(
                id=ing_id,
                name=norm_ing.name,
                qty=_parse_qty(norm_ing.qty),
                qty_text=norm_ing.qty,
                unit=norm_ing.unit,
                prep_note=norm_ing.prep_note,
                group=norm_ing.group,
                optional=False,
            )
        )

    def _ingredient_ids(names: list[str]) -> list[str]:
        ids = []
        for name in names:
            matched = name_to_ids.get(name.lower())
            if matched is None:
                # Soft fallback: substring match against known ingredient names.
                for known_name, known_ids in name_to_ids.items():
                    if name.lower() in known_name or known_name in name.lower():
                        matched = known_ids
                        break
            if matched is not None:
                ids.extend(matched)
            else:
                warnings.append(
                    f'Step references ingredient "{name}", not found in the ingredient list.'
                )
        return list(dict.fromkeys(ids))  # de-dupe, preserve order

    # -- Nodes ----------------------------------------------------------------------
    steps = recipe.steps
    total = len(steps)
    node_ids: list[str] = []
    seen_node_ids: set[str] = set()
    for step in steps:
        base_id = f"step_{_slugify(step.text)}"
        node_id = base_id
        suffix = 2
        while node_id in seen_node_ids:
            node_id = f"{base_id}_{suffix}"
            suffix += 1
        seen_node_ids.add(node_id)
        node_ids.append(node_id)

    nodes: list[Node] = []
    decisions: list[NodeDecision] = []
    depends_on_previous_verified: list[bool] = []
    produced_labels = _produced_labels(steps)

    for index, step in enumerate(steps):
        attention, attention_source = _verify_attention(step, corpus)
        kind = "finish" if index == total - 1 else _infer_kind(step.text, attention)
        dmin, dtyp, dmax, duration_source, clamp_fired = _resolve_duration(step, kind, attention)
        freshness, freshness_cue, max_lead_min = _verify_freshness(step, corpus)

        if index == 0:
            sequential = True
            dep_source: ProvenanceSource = "extracted"
        elif force_linear or step.depends_on_previous:
            sequential = True
            dep_source = _sequential_source(step.text)
        else:
            honored = _verify_independence(steps[index - 1], step, produced_labels)
            sequential = not honored
            dep_source = "inferred" if honored else "defaulted"
        depends_on_previous_verified.append(sequential)

        default_interruptible = {"prep": True, "active": False, "finish": False}
        interruptible = default_interruptible.get(kind, step.interruptible)

        if clamp_fired:
            warnings.append(
                f'Step "{step.text[:60]}..." duration was inferred (not stated); '
                f"clamped to its low end ({dmin} min) per the window-host rule."
            )
        if freshness == "stated_unbounded":
            warnings.append(
                f'"{step.text[:60]}..." must be done fresh (source: "{freshness_cue}"); '
                "no time limit is stated, so it is scheduled right before it's needed."
            )
            review_recommended = True
        if dep_source == "defaulted":
            review_recommended = True
        if duration_source in ("inferred", "defaulted") and attention in ("periodic", "unattended"):
            review_recommended = True

        nodes.append(
            Node(
                id=node_ids[index],
                stage=_stage_for(index, total, kind),
                label=_label(step.text),
                instruction=step.text,
                kind=kind,
                attention=attention,
                duration_min=dmin,
                duration_typical=dtyp,
                duration_max=dmax,
                station=step.station,
                depends_on=[],  # filled below, once every node id is known
                consumes=_ingredient_ids(step.consumes_ingredients),
                produces=(
                    None
                    if force_linear or not step.produces_component
                    else f"comp_{_slugify(step.produces_component)}"
                ),
                interruptible=interruptible,
                max_lead_min=max_lead_min,
                doneness_cue=_clean_cue(step.doneness_cue),
                tip=None,
            )
        )
        decisions.append(
            NodeDecision(
                node_id=node_ids[index],
                attention_source=attention_source,
                duration_source=duration_source,
                depends_on_previous_source=dep_source,
                freshness=freshness,
                freshness_cue=freshness_cue,
            )
        )

    # -- Edges: base chain, with fork/join for honored independence (B1) ------------
    # `open_deps` is the set of node ids a NEW sequential step must join on -- every
    # node that forked off since the last sequential join point and has not yet been
    # re-joined. A sequential step depends on the whole open set (the join) and then
    # becomes the new, sole open member. An honored-independent step never invents a
    # dependency: it copies its immediate predecessor's own `depends_on` (a sibling
    # may start whenever that predecessor could start, never earlier) and is added to
    # the open set so a later join includes it. A chain of only sequential steps is
    # byte-identical to the old `[nodes[index - 1].id]` chain (each join's open set
    # has exactly one member); edges only ever point to already-built nodes, so no
    # cycle can be introduced.
    open_deps: list[str] = []
    for index, node in enumerate(nodes):
        if depends_on_previous_verified[index]:
            node.depends_on = list(open_deps)
            open_deps = [node.id]
        else:
            node.depends_on = list(nodes[index - 1].depends_on)
            open_deps.append(node.id)

    # -- Edges: produces -> consumer, wherever a LATER step names the same product --
    # Strictly later only: a step can't consume something a step after it produces,
    # and matching in both directions is exactly how this created a real dependency
    # cycle the first time (found live at the M2.9 s15 checkpoint). Skipped entirely
    # in force_linear mode -- Tier 1 discards structure, not just this one shortcut.
    if not force_linear:
        nodes_by_id = {node.id: node for node in nodes}
        for index, step in enumerate(steps):
            if step.produces_component is None:
                continue
            producer = nodes[index]
            produced_name = step.produces_component.lower()
            consumer_found = False
            for other_index, other_step in enumerate(steps):
                if other_index <= index:
                    continue
                names_lower = (name.lower() for name in other_step.consumes_ingredients)
                if any(produced_name in name or name in produced_name for name in names_lower):
                    consumer_found = True
                    consumer = nodes[other_index]
                    if producer.id not in consumer.depends_on:
                        consumer.depends_on.append(producer.id)
                    # invariant 6 checks `producer.produces in consumer.consumes` --
                    # without this, no consumer's `consumes` ever contains a `comp_*`
                    # id and the invariant fails unconditionally regardless of the
                    # edge above (a real bug found preparing repair.py's test case).
                    if producer.produces is not None and producer.produces not in consumer.consumes:
                        consumer.consumes.append(producer.produces)

            # B3: nothing named this component by id. Pre-B1 this was always a
            # violation worth repairing (the graph was a strict chain, so the "is it
            # redundant" question never came up). Post-B1 a produces edge can be the
            # *only* connector between two siblings (§6 B3) -- dropping on sight would
            # silently discard real ordering information. Only drop, with a warning,
            # when every strictly-later node already depends on the producer
            # transitively through some other edge: in that case a repair call could
            # only ever add a redundant edge, so there is nothing to fix and no
            # violation is worth spending a repair call on. Otherwise leave `produces`
            # set and let invariant 6 fire -- exactly the case a repair pass earns its
            # cost fixing.
            if not consumer_found:
                later_nodes = nodes[index + 1 :]
                if later_nodes and all(
                    _depends_transitively(later, producer.id, nodes_by_id) for later in later_nodes
                ):
                    warnings.append(
                        f'Step "{step.text[:60]}..." was marked as producing '
                        f'"{step.produces_component}", but no later step names it; '
                        "dropped -- every later step already depends on it, so nothing "
                        "downstream loses ordering information."
                    )
                    producer.produces = None

        # -- Edges: freshness structural steering (§4.6) -----------------------------
        for index, decision in enumerate(decisions):
            if decision.freshness != "stated_unbounded":
                continue
            fresh_node = nodes[index]
            if index + 1 >= len(nodes):
                continue  # last node is its own "consumer" position; already terminal
            consumer = nodes[index + 1]
            for dep in consumer.depends_on:
                if dep != fresh_node.id and dep not in fresh_node.depends_on:
                    fresh_node.depends_on.append(dep)

    # -- Stages ----------------------------------------------------------------------
    used_stage_ids = list(dict.fromkeys(node.stage for node in nodes))
    stages = [
        Stage(id=sid, label=_STAGE_LABELS.get(sid, sid.title()), color_key=sid)
        for sid in used_stage_ids
    ]

    servings = recipe.servings if recipe.servings is not None else 4
    if recipe.servings is None:
        warnings.append("Servings not stated in the source; defaulted to 4.")

    stated_total_min = recipe.stated_total_min
    if stated_total_min is not None:
        # Invariant 8, dropped here (not just in force_linear) so an otherwise
        # structurally valid non-linear graph is never forced into force_linear
        # solely because a marketing total ("15 min") doesn't match verified,
        # cue-grounded passive-step durations (M2.10 s18 F1). Never invented to
        # close the gap -- only ever dropped.
        serial_min = sum(node.duration_typical for node in nodes)
        if abs(serial_min - stated_total_min) > 0.4 * stated_total_min:
            warnings.append(
                f"Dropped the source's stated total time ({stated_total_min} min): "
                f"the verified step durations sum to {serial_min:.0f} min, too far "
                "off to assert both — never invented a number to close the gap."
            )
            stated_total_min = None
            review_recommended = True

    if force_linear:
        # Guarantee invariants 5/6 by DROPPING an assertion the content can't
        # support -- never by inventing one. Invariant 6 needs no action: `produces`
        # is never set above in force_linear mode, so no node claims a component
        # nothing consumes.
        consumed_ids = {c for node in nodes for c in node.consumes}
        for ingredient in ingredients:
            if ingredient.id not in consumed_ids:
                ingredient.optional = True

    graph = CookingGraph(
        id=graph_id,
        title=recipe.title,
        servings=servings,
        cuisine=recipe.cuisine,
        source=source,
        ingredients=ingredients,
        nodes=nodes,
        stages=stages,
        stated_total_min=stated_total_min,
    )

    return GraphBuildResult(
        graph=graph,
        node_decisions=decisions,
        warnings=warnings,
        review_recommended=review_recommended,
    )


def build_linear_graph(
    recipe: NormalizedRecipe, raw_source_text: str, *, graph_id: str, source: SourceRef
) -> GraphBuildResult:
    """The Tier 1 degrade: `build_graph(..., force_linear=True)`.

    `COOKING_GRAPH.md` §5: "degrade to a linear ... chain from the raw steps". Named
    separately from `build_graph` so `repair.py`'s call sites read as what they are —
    the guaranteed-safe last resort, never the primary path.
    """
    return build_graph(recipe, raw_source_text, graph_id=graph_id, source=source, force_linear=True)
