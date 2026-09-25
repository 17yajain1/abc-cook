"""extract/graph.py -- independent verification of everything an LLM claims.

Per docs/M2.9-youtube-import-design.md §8.1 and the M2.9 locked decisions: these tests
build small, synthetic `NormalizedRecipe`s that each isolate one verification rule
(attention cue grounding, freshness cue grounding, the window-host duration clamp, the
depends_on_previous safety test), and check `build_graph`'s output against the raw
source text independently of whatever the fake "model" claimed.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.graph import (
    GraphBuildResult,
    _clean_cue,
    _is_staple,
    _label,
    _parse_qty,
    _produced_labels,
    _verify_independence,
    build_graph,
)
from abc_cook.extract.normalize import render_source_text
from abc_cook.extract.validate import validate
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": False,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _recipe(steps: list[NormalizedStep], **overrides: object) -> NormalizedRecipe:
    defaults: dict[str, object] = {
        "title": "Test",
        "method_grounded": True,
        "ingredients": [NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None)],
        "steps": steps,
    }
    defaults.update(overrides)
    return NormalizedRecipe(**defaults)  # type: ignore[arg-type]


def _build(recipe: NormalizedRecipe, source_text: str) -> GraphBuildResult:
    return build_graph(recipe, source_text, graph_id="g_test", source=SOURCE)


# ---------------------------------------------------------------------------
# Tier 0 refusal, defensively re-checked (§10.C: never rely on a caller's gate).
# ---------------------------------------------------------------------------


def test_refuses_with_no_steps() -> None:
    recipe = _recipe(steps=[])
    result = _build(recipe, "some text")
    assert result.graph is None


# ---------------------------------------------------------------------------
# LOCKED DECISION 4 -- attention verification.
# ---------------------------------------------------------------------------


def test_unattended_claim_honored_when_cue_is_grounded() -> None:
    source_text = "Let the dough rest for 30 minutes covered with a damp cloth."
    steps = [
        _step(
            text="Let the dough rest.",
            attention="unattended",
            attention_cue="rest for 30 minutes",
            duration_min=25,
            duration_typical_min=30,
            duration_max=35,
            duration_stated=True,
        ),
        _step(text="Shape and bake the rolls until golden.", attention="hands_on"),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    first = result.graph.nodes[0]
    assert first.attention == "unattended"
    decision = result.node_decisions[0]
    assert decision.attention_source == "extracted"


def test_unattended_claim_rejected_without_a_grounded_cue() -> None:
    """§10.C finding 2: the model claimed unattended with a cue that doesn't actually
    appear in the source -- must be forced back to hands_on."""
    source_text = "Heat about 100 grams of oil in the pan and add the spices."
    steps = [
        _step(
            text="Heat about 100 grams of oil in the pan and add the spices.",
            attention="unattended",
            attention_cue="let it cook untouched",  # not actually in source_text
        ),
        _step(text="Serve hot."),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    first = result.graph.nodes[0]
    assert first.attention == "hands_on"
    assert result.node_decisions[0].attention_source == "defaulted"
    assert result.review_recommended is False  # nothing to review; no window was ever claimed


def test_unattended_claim_rejected_when_no_cue_given_at_all() -> None:
    steps = [
        _step(text="Cook the dal.", attention="unattended", attention_cue=None),
        _step(text="Serve hot."),
    ]
    result = _build(_recipe(steps), "Cook the dal. Serve hot.")
    assert result.graph is not None
    assert result.graph.nodes[0].attention == "hands_on"


# ---------------------------------------------------------------------------
# LOCKED DECISION 5 -- freshness verification.
# ---------------------------------------------------------------------------


def test_stated_unbounded_honored_with_genuine_immediacy_marker() -> None:
    source_text = "Add fresh cream just before serving and mix well. Serve with rice."
    steps = [
        _step(text="Add fresh cream and mix well.", attention="hands_on"),
        _step(
            text="Add fresh cream just before serving and mix well.",
            freshness="stated_unbounded",
            freshness_cue="just before serving",
        ),
        _step(text="Serve with rice."),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    decision = result.node_decisions[1]
    assert decision.freshness == "stated_unbounded"
    assert result.review_recommended is True
    assert any("must be done fresh" in w for w in result.warnings)


def test_bare_serve_is_not_an_immediacy_marker() -> None:
    """§10.C finding 3: plain "Serve" must not trigger stated_unbounded."""
    source_text = "Serve it with rice or roti."
    steps = [
        _step(text="Cook the dal until soft."),
        _step(
            text="Serve it with rice or roti.",
            freshness="stated_unbounded",
            freshness_cue="Serve",
        ),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    assert result.node_decisions[1].freshness == "none"


def test_freshness_cue_not_grounded_in_source_is_rejected() -> None:
    source_text = "Add the garnish and serve."
    steps = [
        _step(text="Prep the garnish."),
        _step(
            text="Add the garnish and serve.",
            freshness="stated_unbounded",
            freshness_cue="use immediately after opening",  # not in source_text
        ),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    assert result.node_decisions[1].freshness == "none"


def test_stated_numeric_without_a_number_downgrades_to_unbounded() -> None:
    """Never invent a numeric max_lead_min (design doc §4.6/§5)."""
    source_text = "Use it immediately once mixed."
    steps = [
        _step(text="Mix the batter."),
        _step(
            text="Use it immediately once mixed.",
            freshness="stated_numeric",
            freshness_cue="immediately",
            max_lead_min=None,
        ),
    ]
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    node = result.graph.nodes[1]
    assert node.max_lead_min is None
    assert result.node_decisions[1].freshness == "stated_unbounded"


# ---------------------------------------------------------------------------
# LOCKED DECISION 6 -- duration verification / clamping.
# ---------------------------------------------------------------------------


def test_window_host_duration_clamps_typical_to_min() -> None:
    """§10.C finding 4: an inferred (not stated) unattended duration must have
    duration_typical == duration_min, regardless of what the model returned."""
    steps = [
        _step(
            text="Let it rise in a warm place.",
            attention="unattended",
            attention_cue="rise in a warm place",
            duration_stated=False,
            duration_min=1,
            duration_typical_min=2,  # model's bug: typical != min
            duration_max=4,
        ),
        _step(text="Bake until golden."),
    ]
    source_text = "Let it rise in a warm place. Bake until golden."
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    node = result.graph.nodes[0]
    assert node.duration_min == node.duration_typical == 1
    assert node.duration_max == 4
    assert any("clamped" in w for w in result.warnings)


def test_stated_duration_is_not_clamped() -> None:
    steps = [
        _step(
            text="Simmer covered for 10 minutes.",
            attention="unattended",
            attention_cue="Simmer covered",
            duration_stated=True,
            duration_min=9,
            duration_typical_min=10,
            duration_max=12,
        ),
        _step(text="Serve."),
    ]
    source_text = "Simmer covered for 10 minutes. Serve."
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    node = result.graph.nodes[0]
    assert (node.duration_min, node.duration_typical, node.duration_max) == (9, 10, 12)


def test_missing_duration_falls_back_to_deterministic_default() -> None:
    steps = [_step(text="Chop the onions."), _step(text="Cook everything together.")]
    result = _build(_recipe(steps), "Chop the onions. Cook everything together.")
    assert result.graph is not None
    node = result.graph.nodes[0]
    assert node.duration_min <= node.duration_typical <= node.duration_max
    assert result.node_decisions[0].duration_source == "defaulted"


# ---------------------------------------------------------------------------
# LOCKED DECISION 7 -- independence / parallelism safety test.
# ---------------------------------------------------------------------------


def test_independence_claim_honored_with_no_shared_ingredient_or_component() -> None:
    steps = [
        _step(text="Chop the onions.", consumes_ingredients=["Onion"]),
        _step(
            text="Meanwhile, preheat the oven.",
            attention="unattended",
            attention_cue="preheat the oven",
            depends_on_previous=False,
            consumes_ingredients=[],
        ),
        _step(text="Bake everything together."),
    ]
    source_text = "Chop the onions. Meanwhile, preheat the oven. Bake everything together."
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    chop, preheat, bake = result.graph.nodes
    assert preheat.depends_on == []  # independence claim honored -> true parallel source
    # B1: the honored-independent sibling must still be safely joined back in by the
    # next sequential step -- not left as a second, orphaned sink (this exact shape
    # used to fail single_finish_sink/no_orphans before B1's fork/join construction;
    # docs/cooking-plan-investigation.md §5 B1, "verdict B").
    assert set(bake.depends_on) == {chop.id, preheat.id}
    assert validate(result.graph) == []


def test_independence_claim_rejected_when_ingredient_shared() -> None:
    steps = [
        _step(text="Chop the onions.", consumes_ingredients=["Onion"]),
        _step(
            text="Fry the chopped onions.",
            depends_on_previous=False,  # false claim: this obviously needs the chopped onion
            consumes_ingredients=["Onion"],
        ),
    ]
    result = _build(_recipe(steps), "Chop the onions. Fry the chopped onions.")
    assert result.graph is not None
    fry = result.graph.nodes[1]
    assert fry.depends_on == [result.graph.nodes[0].id]
    assert result.node_decisions[1].depends_on_previous_source == "defaulted"
    assert result.review_recommended is True


def test_independence_claim_rejected_when_consumes_others_product() -> None:
    steps = [
        _step(text="Fry the onions until golden.", produces_component="fried onions"),
        _step(
            text="Add the fried onions to the gravy.",
            depends_on_previous=False,
            consumes_ingredients=["fried onions"],
        ),
    ]
    result = _build(_recipe(steps), "Fry the onions until golden. Add to the gravy.")
    assert result.graph is not None
    second = result.graph.nodes[1]
    assert result.graph.nodes[0].id in second.depends_on


# ---------------------------------------------------------------------------
# B1 -- fork/join edge construction (docs/cooking-plan-investigation.md §5 B1).
# ---------------------------------------------------------------------------


def test_fork_join_two_independent_siblings_converge_at_next_sequential_step() -> None:
    """Two steps independently forked off the same join point (mirrors
    `homemade-donuts`' `fry_donuts <- {proof, heat_oil}` shape) must both be picked up
    by the next sequential step's `depends_on` -- not just the last-opened sibling --
    and the result must be a single, valid sink."""
    steps = [
        _step(text="Mix and knead the dough.", consumes_ingredients=["Flour"]),
        _step(
            text="Let the dough proof.",
            attention="unattended",
            attention_cue="proof",
            depends_on_previous=False,
        ),
        _step(
            text="Heat the oil to 180C.",
            attention="unattended",
            attention_cue="heat the oil",
            depends_on_previous=False,
        ),
        _step(text="Fry the donuts in the hot oil."),
    ]
    source_text = (
        "Mix and knead the dough. Let the dough proof. Heat the oil to 180C. Fry the donuts."
    )
    flour = NormalizedIngredient(name="Flour", qty="2", unit="cups", prep_note=None)
    recipe = _recipe(steps, ingredients=[flour])
    result = _build(recipe, source_text)
    assert result.graph is not None
    knead, proof, heat_oil, fry = result.graph.nodes
    # Both siblings start exactly where knead could start -- never earlier, never
    # invented: each copies knead's own (empty) depends_on rather than depending on
    # knead's id, matching the spec's "sibling of the previous step" rule.
    assert proof.depends_on == knead.depends_on == []
    assert heat_oil.depends_on == proof.depends_on
    # The join: fry is sequential, so it depends on the whole open set, not just the
    # immediately preceding sibling.
    assert set(fry.depends_on) == {knead.id, proof.id, heat_oil.id}
    assert validate(result.graph) == []


def test_chain_of_only_sequential_steps_is_byte_identical_to_old_construction() -> None:
    """No independence claim anywhere -> every node depends on exactly its
    predecessor, same as the pre-B1 base-chain loop (`docs/cooking-plan-
    investigation.md` §5 B1: "a chain of only sequential steps is byte-identical")."""
    steps = [
        _step(text="Chop the onions.", consumes_ingredients=["Onion"]),
        _step(text="Fry the onions."),
        _step(text="Serve hot."),
    ]
    result = _build(_recipe(steps), "Chop the onions. Fry the onions. Serve hot.")
    assert result.graph is not None
    chop, fry, serve = result.graph.nodes
    assert chop.depends_on == []
    assert fry.depends_on == [chop.id]
    assert serve.depends_on == [fry.id]


# ---------------------------------------------------------------------------
# B2 -- unattended final-finish invariant (docs/cooking-plan-investigation.md §5 B2).
# ---------------------------------------------------------------------------


def test_unattended_final_step_produces_a_valid_finish_sink() -> None:
    """A grounded unattended final instruction ("let it cool slightly before
    serving") must not make the graph invalid: kind=finish + attention=unattended is
    now allowed (COOKING_GRAPH.md §5.9). The node is NOT converted to hands_on."""
    steps = [
        _step(text="Bake for 20 minutes."),
        _step(
            text="Let it cool slightly before serving.",
            attention="unattended",
            attention_cue="cool slightly before serving",
        ),
    ]
    source_text = "Bake for 20 minutes. Let it cool slightly before serving."
    result = _build(_recipe(steps, ingredients=[]), source_text)
    assert result.graph is not None
    sink = result.graph.nodes[-1]
    assert sink.kind == "finish"
    assert sink.attention == "unattended"  # never forced back to hands_on
    assert validate(result.graph) == []


def test_build_linear_graph_validates_even_with_an_unattended_finish_sink() -> None:
    """`build_linear_graph`'s "guaranteed to pass all ten invariants by construction"
    claim (repair.py) now actually holds for invariant 9 too -- it never touches
    attention/kind, so it depends entirely on the B2 relaxation."""
    from abc_cook.extract.graph import build_linear_graph

    steps = [
        _step(text="Bake for 20 minutes."),
        _step(
            text="Let it cool slightly before serving.",
            attention="unattended",
            attention_cue="cool slightly before serving",
        ),
    ]
    source_text = "Bake for 20 minutes. Let it cool slightly before serving."
    result = build_linear_graph(
        _recipe(steps, ingredients=[]), source_text, graph_id="g_test", source=SOURCE
    )
    assert result.graph is not None
    assert validate(result.graph) == []


# ---------------------------------------------------------------------------
# B3 -- produces/consumes, re-evaluated post-B1 (docs/cooking-plan-investigation.md
# §5 B3). "Drop only when provably transitively redundant, never on sight."
# ---------------------------------------------------------------------------


def test_fork_produces_is_the_only_connector_and_must_be_retained() -> None:
    """Producer and consumer are siblings separated by an unrelated sibling -- the
    two-condition independence test only ever looks at the immediately preceding
    step, so nothing but the produces edge orders producer before consumer (both
    would otherwise be unordered siblings of "Chop", not of each other). Dropping it
    here would silently lose real ordering information; it must be retained and the
    consumer must end up depending on the producer. A final sequential step joins
    every open branch (chop/fry/toast/add_onions) so the graph is otherwise valid --
    isolating produces_consumed as the only thing under test."""
    steps = [
        _step(text="Chop the onions.", consumes_ingredients=["Onion"]),
        _step(
            text="Fry the onions until golden.",
            attention="unattended",
            attention_cue="fry the onions",
            depends_on_previous=False,  # sibling of chop: no shared ingredient/component
            produces_component="fried onions",
        ),
        _step(
            text="Toast the spices.",
            attention="unattended",
            attention_cue="toast the spices",
            depends_on_previous=False,  # sibling of fry: no shared ingredient/component
        ),
        _step(
            text="Add the fried onions to the gravy.",
            depends_on_previous=False,  # sibling of toast: doesn't share w/ toast directly
            consumes_ingredients=["fried onions"],
        ),
        _step(text="Serve."),  # sequential -- joins every still-open branch
    ]
    source_text = (
        "Chop the onions. Fry the onions until golden. Toast the spices. "
        "Add the fried onions to the gravy. Serve."
    )
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    chop, fry, toast, add_onions, serve = result.graph.nodes
    assert fry.produces is not None  # retained, never dropped
    assert fry.id in add_onions.depends_on  # the produces edge is the real connector
    assert set(serve.depends_on) == {chop.id, fry.id, toast.id, add_onions.id}
    assert validate(result.graph) == []


def test_unconsumed_produces_without_redundant_dependency_stays_a_violation() -> None:
    """A produces claim nothing ever names, where later nodes do NOT all transitively
    depend on the producer (a genuine sibling fork) -- must NOT be silently dropped.
    The whole point of B3 is that a repair call here would earn its cost. A final
    sequential step joins every branch so the only remaining violation is the
    produces claim itself."""
    steps = [
        _step(text="Chop the onions.", consumes_ingredients=["Onion"]),
        _step(
            text="Fry the onions until golden.",
            attention="unattended",
            attention_cue="fry the onions",
            depends_on_previous=False,  # sibling of chop
            produces_component="fried onions",  # never named by any later step
        ),
        _step(
            text="Toast the spices.",
            attention="unattended",
            attention_cue="toast the spices",
            depends_on_previous=False,  # sibling of fry -- does NOT depend on fry
        ),
        _step(text="Serve."),  # sequential -- joins chop/fry/toast, but not via fry for toast
    ]
    source_text = "Chop the onions. Fry the onions until golden. Toast the spices. Serve."
    result = _build(_recipe(steps), source_text)
    assert result.graph is not None
    fry = result.graph.nodes[1]
    assert fry.produces is not None  # kept, not dropped -- toast never depends on fry
    violations = validate(result.graph)
    assert violations == [
        v for v in violations if v.rule == "produces_consumed"
    ]  # the ONLY violation
    assert violations != []


def test_unconsumed_produces_in_a_pure_chain_is_safely_dropped_with_a_warning() -> None:
    """No independence claim anywhere -> a strict chain, exactly the pizza-dough
    replay's shape. Every later node transitively depends on the producer purely by
    being downstream in the chain, so an unconsumed produces claim is provably
    redundant and safely dropped, never invented, mirroring force_linear's own
    drop-never-invent rule."""
    steps = [
        _step(text="Mix the dough.", produces_component="mixed dough"),
        _step(text="Knead the dough."),
        _step(text="Bake the dough."),
    ]
    result = _build(
        _recipe(steps, ingredients=[]), "Mix the dough. Knead the dough. Bake the dough."
    )
    assert result.graph is not None
    mix = result.graph.nodes[0]
    assert mix.produces is None  # dropped
    assert any("dropped" in w.lower() for w in result.warnings)
    assert validate(result.graph) == []


# ---------------------------------------------------------------------------
# Structural shape: exactly one finish sink, invariants hold.
# ---------------------------------------------------------------------------


def test_last_node_is_always_the_finish_sink() -> None:
    steps = [
        _step(text="Chop vegetables.", consumes_ingredients=["Onion"]),
        _step(text="Cook."),
        _step(text="Plate and serve."),
    ]
    result = _build(_recipe(steps), "Chop vegetables. Cook. Plate and serve.")
    assert result.graph is not None
    assert result.graph.nodes[-1].kind == "finish"
    violations = validate(result.graph)
    assert violations == []


def test_produces_consumer_wiring_never_points_backward() -> None:
    """Found live at the M2.9 s15 checkpoint: matching a produced label against every
    OTHER step's consumes_ingredients (not just later ones) created a real cycle when
    an earlier step's consumed-ingredient text happened to overlap with a LATER step's
    produced label. A producer may only be wired to a strictly later consumer."""
    steps = [
        _step(
            text="Add the tomatoes to the dal.",
            consumes_ingredients=["cooked dal"],  # overlaps with a LATER step's produces
        ),
        _step(text="Cook the dal mixture for 30 minutes.", produces_component="cooked dal mixture"),
        _step(text="Serve hot."),
    ]
    result = _build(_recipe(steps), "Add the tomatoes to the dal. Cook. Serve hot.")
    assert result.graph is not None
    first = result.graph.nodes[0]
    # The natural sequential edge (index 1 depends on index 0) must survive, but the
    # producer at index 1 must never end up back in index 0's dependencies.
    assert result.graph.nodes[1].id not in first.depends_on
    violations = validate(result.graph)
    assert not any(v.rule == "acyclic" for v in violations)


def test_ingredient_reference_matched_case_insensitively() -> None:
    steps = [
        _step(text="Add the onion.", consumes_ingredients=["onion"]),
        _step(text="Serve."),
    ]
    recipe = _recipe(
        steps,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None)],
    )
    result = _build(recipe, "Add the onion. Serve.")
    assert result.graph is not None
    assert result.graph.nodes[0].consumes == ["ing_onion"]


def test_duplicate_ingredient_names_are_both_consumable() -> None:
    """Real bug found running repair.py against a real recipe: two ingredients named
    "Butter" (once in the main list, once under "Tempering") used to collapse into a
    single name->id mapping, so whichever was written first could never be matched by
    any step's consumes_ingredients, regardless of what the step actually said --
    invariant 5 failed unconditionally for it. A step naming "Butter" must now be able
    to satisfy both entries between the two steps that reference it."""
    recipe = _recipe(
        [
            _step(text="Melt some butter in a pan.", consumes_ingredients=["Butter"]),
            _step(text="Stir in more butter and serve.", consumes_ingredients=["Butter"]),
        ],
        ingredients=[
            NormalizedIngredient(name="Butter", qty="100", unit="g", prep_note=None, group=None),
            NormalizedIngredient(
                name="Butter", qty="2", unit="tbsp", prep_note=None, group="Tempering"
            ),
        ],
    )
    result = _build(recipe, "Melt some butter in a pan. Stir in more butter and serve.")
    assert result.graph is not None
    assert len(result.graph.ingredients) == 2
    consumed_ids = {c for node in result.graph.nodes for c in node.consumes}
    assert consumed_ids == {ing.id for ing in result.graph.ingredients}
    violations = validate(result.graph)
    assert not any(v.rule == "ingredients_consumed" for v in violations)


# ---------------------------------------------------------------------------
# A2 -- mixed fractions, unicode vulgar fractions, ranges. Conservative: never
# invents a number the source didn't give.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("qty", "expected"),
    [
        ("1 1/4", 1.25),
        ("1-1/4", 1.25),
        ("3 1/3", pytest.approx(3 + 1 / 3)),
        ("½", 0.5),
        ("1½", 1.5),
        ("¼", 0.25),
        ("2-3", 2.0),
        ("2 to 3", 2.0),
        (f"2{chr(0x2013)}3", 2.0),  # en dash, as real recipe sites write ranges
        ("1/2", 0.5),
        ("2", 2.0),
        ("2.5", 2.5),
        ("a pinch", None),
        ("a little less than 2", None),
        (None, None),
        ("", None),
    ],
)
def test_parse_qty(qty: str | None, expected: float | None) -> None:
    assert _parse_qty(qty) == expected


def test_qty_text_populated_alongside_parsed_qty() -> None:
    recipe = _recipe(
        [_step(text="Do something.")],
        ingredients=[
            NormalizedIngredient(name="Flour", qty="1 1/4", unit="cups", prep_note=None),
            NormalizedIngredient(name="Salt", qty="a pinch", unit=None, prep_note=None),
        ],
    )
    result = _build(recipe, "Do something.")
    assert result.graph is not None
    flour, salt = result.graph.ingredients
    assert flour.qty == 1.25
    assert flour.qty_text == "1 1/4"
    assert salt.qty is None
    assert salt.qty_text == "a pinch"


# ---------------------------------------------------------------------------
# A3 -- "until until": doneness_cue is stored without a leading until/till.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("cue", "expected"),
    [
        ("until golden", "golden"),
        ("Until golden brown", "golden brown"),
        ("till doubled in size", "doubled in size"),
        ("doubled in bulk, holds a dimple", "doubled in bulk, holds a dimple"),  # no leading until
        (None, None),
        ("until", "until"),  # bare "until" with no condition following: nothing to strip
    ],
)
def test_clean_cue(cue: str | None, expected: str | None) -> None:
    assert _clean_cue(cue) == expected


def test_doneness_cue_stripped_of_leading_until_on_build() -> None:
    recipe = _recipe([_step(text="Bake until golden.", doneness_cue="until golden")])
    result = _build(recipe, "Bake until golden.")
    assert result.graph is not None
    assert result.graph.nodes[0].doneness_cue == "golden"


# ---------------------------------------------------------------------------
# A4 -- deterministic label cleanup: whole number/fraction tokens, never ends on a
# function word, still <= 4 words.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Measure 3 1/3 cups flour into a bowl.", "Measure 3 1/3 cups"),
        ("Place pizza stone or inverted baking sheet in oven.", "Place pizza stone"),
        ("Form ball in your hands and set aside.", "Form ball"),
        ("PREP: Measure flour and sugar.", "Measure flour and sugar"),
        ("Chop the onion.", "Chop the onion"),
    ],
)
def test_label(text: str, expected: str) -> None:
    assert _label(text) == expected


# ---------------------------------------------------------------------------
# A1.1 -- generalizable label cleanup regression: the six real pizza-import labels
# that were still broken after A4 (trailing prepositions the A4 function-word set
# didn't cover, and a trailing bare number fragment), plus leading function words.
# The fix is a general word-class rule (trim leading/trailing function words, drop a
# trailing bare number), not a lookup table keyed to these six strings -- the
# synthetic cases below use different words/numbers to prove that.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        # The six real pizza-dough labels flagged in the Phase A review.
        (
            "When dough is about room temperature and oven is preheated, transfer 1 piece.",
            "When dough is",
        ),
        ("Lift the dough over both knuckles and roll.", "Lift the dough"),
        ("Slide pizza onto the preheated pizza stone and bake.", "Slide pizza"),
        ("Knead by hand 2 minutes (dough will be sticky).", "Knead by hand"),
        ("Remove the dough 1 hour before using to let it relax.", "Remove the dough"),
        ("In a small bowl, stir together water, honey, and salt.", "Small bowl stir together"),
        # Synthetic cases, NOT among the six above, exercising the same general rules.
        ("Simmer covered for 5 more minutes on low heat.", "Simmer covered"),
        ("Drizzle the sauce over the top before serving.", "Drizzle the sauce"),
        ("On the stovetop, heat oil until shimmering.", "Stovetop heat oil"),
    ],
)
def test_label_generalized_trim(text: str, expected: str) -> None:
    assert _label(text) == expected


def test_label_never_ends_on_bare_number_or_function_word_via_build_graph() -> None:
    """A1.1: exercise the fix through build_graph(), not just the private helper, and
    pin Node.instruction == original step.text through the label/cue transformations
    (CLAUDE.md: the LLM's claim is a hint; instruction must still be the verbatim
    step text the scheduler and Cooking Mode render)."""
    texts = [
        "In a small bowl, stir together water, honey, and salt then sprinkle yeast.",
        "Knead by hand 2 minutes (dough will be sticky).",
        "Remove the dough 1 hour before using to let it relax.",
        "When dough is about room temperature, transfer to a floured surface.",
        "Lift the dough over both knuckles and roll your knuckles under.",
        "Slide pizza onto the preheated pizza stone and bake until golden.",
    ]
    steps = [_step(text=t) for t in texts]
    result = _build(_recipe(steps), " ".join(texts))
    assert result.graph is not None
    assert [n.instruction for n in result.graph.nodes] == texts
    function_words = {
        "in", "on", "or", "and", "with", "to", "your", "the", "a", "of", "for",
        "until", "then", "about", "onto", "over",
    }
    for node in result.graph.nodes:
        last_word = node.label.rsplit(" ", 1)[-1].lower()
        assert last_word not in function_words
        assert not last_word.isdigit()


# ---------------------------------------------------------------------------
# CP2-A characterization: the legacy (`depends_on_previous`) build of both captured
# real-recipe `NormalizedRecipe` replay fixtures, pinned edge for edge. Recorded before
# any CP2-B builder change. CP2-B adds an explicit-dependency path and a staple rule;
# neither may alter what a recipe with no `depends_on_steps` builds to. If one of these
# fails, the legacy path moved -- surface it rather than re-recording the expectation.
# ---------------------------------------------------------------------------

_IMPORT_FIXTURES = Path(__file__).parent / "fixtures" / "import"

_PIZZA_DOUGH_EDGES: dict[str, list[str]] = {
    "step_in_a_small_bowl_stir_together": [],
    "step_measure_3_1_3_cups_flour": ["step_in_a_small_bowl_stir_together"],
    "step_knead_by_hand_2_minutes_dough": ["step_measure_3_1_3_cups_flour"],
    "step_cover_the_bowl_with_plastic_wrap": ["step_knead_by_hand_2_minutes_dough"],
    "step_transfer_dough_to_a_floured_surface": ["step_cover_the_bowl_with_plastic_wrap"],
    "step_cover_and_refrigerate_overnight_18_hours": ["step_transfer_dough_to_a_floured_surface"],
    "step_remove_the_dough_1_hour_before": [
        "step_cover_and_refrigerate_overnight_18_hours",
        "step_transfer_dough_to_a_floured_surface",
    ],
    "step_place_a_pizza_stone_or_inverted": ["step_remove_the_dough_1_hour_before"],
    "step_lightly_flour_a_pizza_peel_and": ["step_place_a_pizza_stone_or_inverted"],
    "step_when_dough_is_about_room_temperature": ["step_lightly_flour_a_pizza_peel_and"],
    "step_lift_the_dough_over_both_knuckles": ["step_when_dough_is_about_room_temperature"],
    "step_spread_on_desired_pizza_sauce_and": ["step_lift_the_dough_over_both_knuckles"],
    "step_slide_pizza_onto_the_preheated_pizza": ["step_spread_on_desired_pizza_sauce_and"],
    "step_transfer_the_pizza_to_a_cutting": ["step_slide_pizza_onto_the_preheated_pizza"],
}

_DAL_MAKHNI_EDGES: dict[str, list[str]] = {
    "step_soak_the_dal_and_rajma_together": [],
    "step_scrub_the_soaked_dal_and_rajma": ["step_soak_the_dal_and_rajma_together"],
    "step_add_5_cups_water_and_boil": ["step_scrub_the_soaked_dal_and_rajma"],
    "step_roughly_cut_the_tomatoes_and_puree": ["step_scrub_the_soaked_dal_and_rajma"],
    "step_in_a_pan_melt_butter_and": ["step_scrub_the_soaked_dal_and_rajma"],
    "step_add_the_kashmiri_chilli_powder_and": [
        "step_add_5_cups_water_and_boil",
        "step_roughly_cut_the_tomatoes_and_puree",
        "step_in_a_pan_melt_butter_and",
    ],
    "step_immediately_add_the_tomato_puree": ["step_add_the_kashmiri_chilli_powder_and"],
    "step_cook_the_tomatoes_till_they_turn": ["step_immediately_add_the_tomato_puree"],
    "step_add_the_tomatoes_to_the_dal": [
        "step_cook_the_tomatoes_till_they_turn",
        "step_add_5_cups_water_and_boil",
    ],
    "step_cook_the_dal_for_30_minutes": ["step_add_the_tomatoes_to_the_dal"],
    "step_in_a_separate_pan_heat_oil": ["step_add_the_tomatoes_to_the_dal"],
    "step_brown_the_garlic_and_add_it": [
        "step_cook_the_dal_for_30_minutes",
        "step_in_a_separate_pan_heat_oil",
    ],
    "step_add_some_more_butter_along_with": ["step_brown_the_garlic_and_add_it"],
    "step_remove_and_serve_hot": ["step_add_some_more_butter_along_with"],
}


def _legacy_edges(recipe: NormalizedRecipe, source_text: str) -> dict[str, list[str]]:
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert validate(result.graph) == []
    return {node.id: node.depends_on for node in result.graph.nodes}


def test_characterization_pizza_dough_legacy_edges_unchanged() -> None:
    recipe = NormalizedRecipe.model_validate_json(
        (_IMPORT_FIXTURES / "pizza-dough.normalized.json").read_text(encoding="utf-8")
    )
    raw = RawAcquisition.model_validate_json(
        (_IMPORT_FIXTURES / "pizza-dough.raw.json").read_text(encoding="utf-8")
    )
    assert all(step.depends_on_steps is None for step in recipe.steps)  # legacy input
    assert _legacy_edges(recipe, render_source_text(raw)) == _PIZZA_DOUGH_EDGES


def test_characterization_dal_makhni_legacy_edges_unchanged() -> None:
    """The one real capture that exercises the legacy fork/join path (three
    `depends_on_previous=False` claims)."""
    recipe = NormalizedRecipe.model_validate_json(
        (_IMPORT_FIXTURES / "dal-makhni-multibranch.normalized.json").read_text(encoding="utf-8")
    )
    source_text = (_IMPORT_FIXTURES / "dal-makhni-multibranch.source_text.txt").read_text(
        encoding="utf-8"
    )
    assert all(step.depends_on_steps is None for step in recipe.steps)  # legacy input
    assert sum(not step.depends_on_previous for step in recipe.steps) == 3
    assert _legacy_edges(recipe, source_text) == _DAL_MAKHNI_EDGES


# ---------------------------------------------------------------------------
# CP2-B (E) -- staple-aware independence. A shared pantry staple (salt, water, oil)
# is not a dependency; a shared non-staple still vetoes, and a produced component is
# never staple-exempt, whatever it is called.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Salt", True),
        ("Sea salt", True),
        ("olive oil", True),
        ("chilli oil", True),  # accepted tradeoff of whole-token matching
        ("Water", True),
        ("water chestnut", True),  # accepted tradeoff of whole-token matching
        ("Saltine", False),
        ("Onion", False),
    ],
)
def test_staple_tokenizer(name: str, expected: bool) -> None:
    assert _is_staple(name, frozenset()) is expected


def test_produced_component_named_like_a_staple_is_never_a_staple() -> None:
    assert _is_staple("Oil", frozenset({"oil"})) is False
    assert _is_staple("garlic oil", frozenset({"garlic oil"})) is False


@pytest.mark.parametrize("staple", ["Salt", "Oil", "Water"])
def test_shared_staple_alone_does_not_veto_independence(staple: str) -> None:
    a = _step(text="Whisk the eggs.", consumes_ingredients=["Egg", staple])
    b = _step(text="Rinse the rice.", consumes_ingredients=["Rice", staple])
    assert _verify_independence(a, b, frozenset()) is True


def test_shared_non_staple_still_vetoes_independence() -> None:
    a = _step(text="Whisk the eggs.", consumes_ingredients=["Egg", "Salt", "Onion"])
    b = _step(text="Rinse the rice.", consumes_ingredients=["Rice", "Salt", "Onion"])
    assert _verify_independence(a, b, frozenset()) is False


def test_produced_component_named_oil_keeps_its_product_link() -> None:
    """A step that makes "oil" (an infused oil) and a step that uses it are linked,
    even though "oil" alone would be a staple."""
    infuse = _step(text="Infuse the oil with garlic.", produces_component="oil")
    drizzle = _step(text="Drizzle the oil over the bread.", consumes_ingredients=["oil"])
    labels = _produced_labels([infuse, drizzle])
    assert _verify_independence(infuse, drizzle, labels) is False


def test_legacy_independence_honored_when_only_salt_is_shared() -> None:
    steps = [
        _step(text="Whisk the eggs with salt.", consumes_ingredients=["Egg", "Salt"]),
        _step(
            text="Rinse the rice with salt.",
            depends_on_previous=False,
            consumes_ingredients=["Rice", "Salt"],
        ),
        _step(text="Cook everything together.", consumes_ingredients=["Egg", "Rice"]),
    ]
    ingredients = [
        NormalizedIngredient(name=name, qty="1", unit=None, prep_note=None)
        for name in ("Egg", "Rice", "Salt")
    ]
    result = _build(
        _recipe(steps, ingredients=ingredients),
        "Whisk the eggs with salt. Rinse the rice with salt. Cook everything together.",
    )
    assert result.graph is not None
    whisk, rinse, cook = result.graph.nodes
    assert rinse.depends_on == []  # honored: salt is a staple, not a dependency
    assert result.node_decisions[1].depends_on_previous_source == "inferred"
    assert set(cook.depends_on) == {whisk.id, rinse.id}
    assert validate(result.graph) == []


def test_legacy_independence_still_vetoed_by_a_shared_non_staple() -> None:
    steps = [
        _step(text="Chop the onion with salt.", consumes_ingredients=["Onion", "Salt"]),
        _step(
            text="Fry the onion with salt.",
            depends_on_previous=False,
            consumes_ingredients=["Onion", "Salt"],
        ),
    ]
    ingredients = [
        NormalizedIngredient(name=name, qty="1", unit=None, prep_note=None)
        for name in ("Onion", "Salt")
    ]
    result = _build(
        _recipe(steps, ingredients=ingredients), "Chop the onion with salt. Fry the onion."
    )
    assert result.graph is not None
    chop, fry = result.graph.nodes
    assert fry.depends_on == [chop.id]
    assert result.node_decisions[1].depends_on_previous_source == "defaulted"


# ---------------------------------------------------------------------------
# CP2-B (B) -- optional/alternative steps become verbatim notes on the step they
# modify, never mandatory nodes, never deleted. Honored only with a grounded cue that
# carries a closed-list marker.
# ---------------------------------------------------------------------------

_TOAST_SOURCE = (
    "Toast the bread. Spread the butter on the toast. "
    "If you like, sprinkle the toast with cinnamon. Serve warm."
)


def _toast_recipe(**optional_overrides: object) -> NormalizedRecipe:
    optional: dict[str, object] = {
        "text": "If you like, sprinkle the toast with cinnamon.",
        "role": "optional",
        "role_cue": "If you like",
        "attach_to_step": 1,
        "consumes_ingredients": ["Cinnamon"],
    }
    optional.update(optional_overrides)
    steps = [
        _step(text="Toast the bread.", consumes_ingredients=["Bread"]),
        _step(text="Spread the butter on the toast.", consumes_ingredients=["Butter"]),
        _step(**optional),
        _step(text="Serve warm."),
    ]
    ingredients = [
        NormalizedIngredient(name=name, qty="1", unit=None, prep_note=None)
        for name in ("Bread", "Butter", "Cinnamon")
    ]
    return _recipe(steps, ingredients=ingredients)


def test_grounded_optional_step_becomes_a_note_not_a_node() -> None:
    result = _build(_toast_recipe(), _TOAST_SOURCE)
    assert result.graph is not None
    _toast, spread, serve = result.graph.nodes
    assert [n.instruction for n in result.graph.nodes] == [
        "Toast the bread.",
        "Spread the butter on the toast.",
        "Serve warm.",
    ]
    assert spread.tip == "Optional: If you like, sprinkle the toast with cinnamon."
    assert serve.depends_on == [spread.id]  # the chain skips the note
    cinnamon = next(i for i in result.graph.ingredients if i.name == "Cinnamon")
    assert cinnamon.optional is True  # only the note uses it
    assert all(not i.optional for i in result.graph.ingredients if i.name != "Cinnamon")
    assert any(w.startswith('Kept "If you like') for w in result.warnings)
    assert validate(result.graph) == []


def test_optional_step_duration_is_not_counted() -> None:
    timed = {"duration_min": 5, "duration_typical_min": 5, "duration_max": 5}
    with_note = _build(_toast_recipe(duration_stated=True, **timed), _TOAST_SOURCE)
    as_required = _build(_toast_recipe(role="required", role_cue=None, **timed), _TOAST_SOURCE)
    assert with_note.graph is not None
    assert as_required.graph is not None
    serial_with_note = sum(n.duration_typical for n in with_note.graph.nodes)
    serial_as_required = sum(n.duration_typical for n in as_required.graph.nodes)
    assert serial_as_required - serial_with_note == 5


def test_alternative_step_gets_the_alternative_prefix() -> None:
    source = "Warm the milk on the stove. Microwave method: heat the milk for 1 minute. Serve."
    steps = [
        _step(text="Warm the milk on the stove.", station="burner"),
        _step(
            text="Microwave method: heat the milk for 1 minute.",
            role="alternative",
            role_cue="Microwave method:",
            attach_to_step=0,
        ),
        _step(text="Serve."),
    ]
    result = _build(_recipe(steps, ingredients=[]), source)
    assert result.graph is not None
    warm, _serve = result.graph.nodes
    assert warm.tip == "Alternative: Microwave method: heat the milk for 1 minute."
    assert validate(result.graph) == []


def test_note_prefix_is_not_doubled() -> None:
    source = "Mix the batter. Optional: fold in some berries. Bake."
    steps = [
        _step(text="Mix the batter."),
        _step(
            text="Optional: fold in some berries.",
            role="optional",
            role_cue="Optional:",
            attach_to_step=0,
        ),
        _step(text="Bake."),
    ]
    result = _build(_recipe(steps, ingredients=[]), source)
    assert result.graph is not None
    assert result.graph.nodes[0].tip == "Optional: fold in some berries."


def test_optional_claim_with_ungrounded_cue_stays_required() -> None:
    result = _build(_toast_recipe(role_cue="If you fancy it"), _TOAST_SOURCE)
    assert result.graph is not None
    assert len(result.graph.nodes) == 4
    assert all(n.tip is None for n in result.graph.nodes)
    assert result.review_recommended is True
    assert any("kept as a required step" in w for w in result.warnings)


def test_optional_claim_with_grounded_cue_but_no_marker_stays_required() -> None:
    result = _build(_toast_recipe(role_cue="sprinkle the toast"), _TOAST_SOURCE)
    assert result.graph is not None
    assert len(result.graph.nodes) == 4
    assert result.review_recommended is True


def test_last_step_optional_makes_previous_required_step_the_finish() -> None:
    source = "Cook the pasta. Drain and serve. If desired, top with parmesan."
    steps = [
        _step(text="Cook the pasta.", station="burner"),
        _step(text="Drain and serve."),
        _step(
            text="If desired, top with parmesan.",
            role="optional",
            role_cue="If desired",
            attach_to_step=1,
        ),
    ]
    result = _build(_recipe(steps, ingredients=[]), source)
    assert result.graph is not None
    cook, serve = result.graph.nodes
    assert serve.kind == "finish"
    assert serve.stage == "finish"
    assert cook.stage != "finish"
    assert serve.tip == "Optional: If desired, top with parmesan."
    assert validate(result.graph) == []


def test_all_steps_optional_keeps_them_all_required() -> None:
    source = "If you like, add lemon. If desired, add mint."
    steps = [
        _step(text="If you like, add lemon.", role="optional", role_cue="If you like"),
        _step(text="If desired, add mint.", role="optional", role_cue="If desired"),
    ]
    result = _build(_recipe(steps, ingredients=[]), source)
    assert result.graph is not None
    assert len(result.graph.nodes) == 2
    assert result.graph.nodes[-1].kind == "finish"
    assert all(n.tip is None for n in result.graph.nodes)
    assert any("kept them all as required" in w for w in result.warnings)
    assert validate(result.graph) == []


_ATTACH_SOURCE = (
    "Boil the water. Cook the noodles. If you like, add chilli flakes. "
    "Alternatively, use rice noodles. Serve."
)
_BOTH_NOTES = (
    "Optional: If you like, add chilli flakes. Alternative: Alternatively, use rice noodles."
)


def _attach_recipe(first_attach: int | None, second_attach: int | None) -> NormalizedRecipe:
    steps = [
        _step(text="Boil the water.", station="burner"),
        _step(text="Cook the noodles.", station="burner"),
        _step(
            text="If you like, add chilli flakes.",
            role="optional",
            role_cue="If you like",
            attach_to_step=first_attach,
        ),
        _step(
            text="Alternatively, use rice noodles.",
            role="alternative",
            role_cue="Alternatively",
            attach_to_step=second_attach,
        ),
        _step(text="Serve."),
    ]
    return _recipe(steps, ingredients=[])


def _tips(result: GraphBuildResult) -> list[str | None]:
    assert result.graph is not None
    return [n.tip for n in result.graph.nodes]


@pytest.mark.parametrize(
    ("first_attach", "second_attach"),
    [
        (99, None),  # out of range / missing -> nearest preceding required step
        (2, 3),  # each points at itself
        (3, 2),  # a cycle through two optional steps
    ],
)
def test_invalid_attach_falls_back_to_nearest_preceding_required(
    first_attach: int | None, second_attach: int | None
) -> None:
    result = _build(_attach_recipe(first_attach, second_attach), _ATTACH_SOURCE)
    assert _tips(result) == [None, _BOTH_NOTES, None]
    assert sum("did not name a valid step" in w for w in result.warnings) == 2


def test_attach_follows_a_chain_of_optional_steps_to_a_required_one() -> None:
    result = _build(_attach_recipe(3, 0), _ATTACH_SOURCE)
    assert _tips(result) == [_BOTH_NOTES, None, None]
    assert not any("did not name a valid step" in w for w in result.warnings)


def test_leading_optional_with_no_preceding_step_attaches_forward() -> None:
    source = "If you like, warm the plates. Cook the eggs. Serve."
    steps = [
        _step(text="If you like, warm the plates.", role="optional", role_cue="If you like"),
        _step(text="Cook the eggs.", station="burner"),
        _step(text="Serve."),
    ]
    result = _build(_recipe(steps, ingredients=[]), source)
    assert _tips(result) == ["Optional: If you like, warm the plates.", None]


def test_legacy_previous_step_skips_an_optional_note() -> None:
    """On the legacy path, "the previous step" is the previous *required* step."""
    result = _build(_toast_recipe(), _TOAST_SOURCE)
    assert result.graph is not None
    toast, spread, serve = result.graph.nodes
    assert spread.depends_on == [toast.id]
    assert serve.depends_on == [spread.id]


def test_force_linear_leaves_optional_steps_out_as_notes() -> None:
    from abc_cook.extract.graph import build_linear_graph

    result = build_linear_graph(_toast_recipe(), _TOAST_SOURCE, graph_id="g_test", source=SOURCE)
    assert result.graph is not None
    toast, spread, serve = result.graph.nodes
    assert spread.depends_on == [toast.id]
    assert serve.depends_on == [spread.id]
    assert spread.tip is not None
    assert spread.tip.startswith("Optional: ")
    assert validate(result.graph) == []


# ---------------------------------------------------------------------------
# CP2-B (A) -- explicit `depends_on_steps`: sanitize, producer edges, descendant
# closure, pairwise verification, same-heat-station guard, dangling-sink join. The
# builder only ever adds edges.
# ---------------------------------------------------------------------------


def _ings(*names: str) -> list[NormalizedIngredient]:
    return [NormalizedIngredient(name=name, qty="1", unit=None, prep_note=None) for name in names]


def _explicit_build(steps: list[NormalizedStep], *ingredients: str) -> GraphBuildResult:
    source = " ".join(step.text for step in steps)
    return _build(_recipe(steps, ingredients=_ings(*ingredients)), source)


def _deps_by_label(result: GraphBuildResult) -> dict[str, list[str]]:
    assert result.graph is not None
    label_of = {node.id: node.instruction for node in result.graph.nodes}
    return {
        node.instruction: [label_of[dep] for dep in node.depends_on]
        for node in result.graph.nodes
    }


def test_explicit_empty_claim_is_a_source_and_list_claim_is_exact() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Grate the cheese.", depends_on_steps=[], consumes_ingredients=["Cheese"]),
        _step(text="Whisk the eggs.", depends_on_steps=[], consumes_ingredients=["Egg"]),
        _step(text="Combine the onion and eggs.", depends_on_steps=[0, 2]),
        _step(text="Serve with the cheese.", depends_on_steps=[1, 3]),
    ]
    result = _explicit_build(steps, "Onion", "Cheese", "Egg")
    deps = _deps_by_label(result)
    assert deps["Grate the cheese."] == []
    assert deps["Whisk the eggs."] == []
    assert deps["Combine the onion and eggs."] == ["Chop the onion.", "Whisk the eggs."]
    assert deps["Serve with the cheese."] == ["Grate the cheese.", "Combine the onion and eggs."]
    assert [d.depends_on_previous_source for d in result.node_decisions] == ["extracted"] * 5
    assert result.review_recommended is False
    assert result.graph is not None
    assert validate(result.graph) == []


def test_explicit_none_claim_defaults_to_the_previous_step() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Grate the cheese.", depends_on_steps=[], consumes_ingredients=["Cheese"]),
        _step(text="Serve.", depends_on_steps=None),
    ]
    result = _explicit_build(steps, "Onion", "Cheese")
    deps = _deps_by_label(result)
    assert deps["Serve."][0] == "Grate the cheese."
    assert result.node_decisions[2].depends_on_previous_source == "defaulted"
    assert result.review_recommended is True


def test_explicit_invalid_indices_are_dropped_with_a_warning() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Grate the cheese.", depends_on_steps=[], consumes_ingredients=["Cheese"]),
        _step(text="Stir in the onion.", depends_on_steps=[0, 2, 3]),  # self, future
        _step(text="Serve.", depends_on_steps=[1, 2]),
    ]
    result = _explicit_build(steps, "Onion", "Cheese")
    deps = _deps_by_label(result)
    assert deps["Stir in the onion."] == ["Chop the onion."]
    assert result.node_decisions[2].depends_on_previous_source == "extracted"
    assert sum("is not an earlier step" in w for w in result.warnings) == 2


def test_explicit_claim_that_sanitizes_to_empty_falls_back_to_previous() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Grate the cheese.", depends_on_steps=[], consumes_ingredients=["Cheese"]),
        _step(text="Stir everything.", depends_on_steps=[2, 7, -1]),
        _step(text="Serve.", depends_on_steps=[0, 2]),
    ]
    result = _explicit_build(steps, "Onion", "Cheese")
    deps = _deps_by_label(result)
    assert deps["Stir everything."] == ["Grate the cheese."]
    assert result.node_decisions[2].depends_on_previous_source == "defaulted"
    assert result.review_recommended is True
    assert any("named no usable earlier step" in w for w in result.warnings)


def test_explicit_reference_to_an_optional_step_passes_through_to_its_target() -> None:
    steps = [
        _step(text="Toast the bread.", depends_on_steps=[], consumes_ingredients=["Bread"]),
        _step(text="Spread the butter on the toast.", depends_on_steps=[0],
              consumes_ingredients=["Butter"]),
        _step(text="If you like, sprinkle the toast with cinnamon.", role="optional",
              role_cue="If you like", attach_to_step=1, depends_on_steps=[1]),
        _step(text="Serve warm.", depends_on_steps=[2]),
    ]
    result = _explicit_build(steps, "Bread", "Butter")
    deps = _deps_by_label(result)
    assert deps["Serve warm."] == ["Spread the butter on the toast."]
    assert result.node_decisions[2].depends_on_previous_source == "extracted"


def test_explicit_reference_to_an_optional_note_on_a_later_step_is_dropped() -> None:
    steps = [
        _step(text="Boil the water.", depends_on_steps=[], station="counter"),
        _step(text="If you like, add a bay leaf.", role="optional", role_cue="If you like",
              attach_to_step=2),
        _step(text="Cook the rice.", depends_on_steps=[1], consumes_ingredients=["Rice"]),
    ]
    result = _explicit_build(steps, "Rice")
    deps = _deps_by_label(result)
    assert deps["Cook the rice."] == ["Boil the water."]  # conservative fallback
    assert result.node_decisions[1].depends_on_previous_source == "defaulted"
    assert any("attached to a later step" in w for w in result.warnings)


def test_t_depth_descendant_closure_follows_continuation_of_the_claimed_work() -> None:
    """T-depth: shape claims only [mix]; chill and rest continue mix's work with no
    named product, so shape must wait for all three."""
    steps = [
        _step(text="Mix the dough.", depends_on_steps=[], consumes_ingredients=["Flour"]),
        _step(text="Chill the dough for 30 minutes.", depends_on_steps=[0],
              attention="unattended", attention_cue="Chill the dough for 30 minutes",
              station="fridge"),
        _step(text="Let the dough rest for 10 minutes.", depends_on_steps=[1],
              attention="unattended", attention_cue="rest for 10 minutes", station="none"),
        _step(text="Shape the dough into rounds.", depends_on_steps=[0]),
    ]
    result = _explicit_build(steps, "Flour")
    deps = _deps_by_label(result)
    assert set(deps["Shape the dough into rounds."]) >= {
        "Mix the dough.",
        "Chill the dough for 30 minutes.",
        "Let the dough rest for 10 minutes.",
    }
    # The closure follows the extraction's own claims: no review, still "extracted".
    assert result.node_decisions[3].depends_on_previous_source == "extracted"
    assert result.graph is not None
    assert validate(result.graph) == []


def _siblings_steps(*, rub_produces: str | None) -> list[NormalizedStep]:
    marinate_consumes = ["coated chicken"] if rub_produces else []
    return [
        _step(text="Grind the spice paste.", depends_on_steps=[],
              consumes_ingredients=["Spices"], produces_component="spice paste"),
        _step(text="Rub the chicken with the spice paste.", depends_on_steps=[0],
              consumes_ingredients=["Chicken", "spice paste"], produces_component=rub_produces),
        _step(text="Marinate the chicken for 1 hr.", depends_on_steps=[1],
              attention="unattended", attention_cue="Marinate the chicken for 1 hr",
              station="fridge", consumes_ingredients=marinate_consumes),
        _step(text="Whisk the yogurt with salt.", depends_on_steps=[],
              consumes_ingredients=["Yogurt", "Salt"]),
        _step(text="Rinse the rice with salt and water.", depends_on_steps=[],
              consumes_ingredients=["Rice", "Salt", "Water"]),
        _step(text="Stir the remaining spice paste into the yogurt.", depends_on_steps=[0, 3],
              consumes_ingredients=["spice paste", "Yogurt"]),
        _step(text="Cook the chicken and rice and serve with the yogurt.",
              depends_on_steps=[2, 4, 5], station="burner"),
    ]


_SIBLING_INGREDIENTS = ("Spices", "Chicken", "Yogurt", "Salt", "Rice", "Water")


def test_t_siblings_a_product_boundary_stops_the_closure() -> None:
    """T-siblings (a): rub produces "coated chicken", which marinate consumes -- a
    branch boundary. The yogurt step claims [grind, whisk]; it must not inherit the
    chicken branch. Salt and the shared component "spice paste" don't veto."""
    result = _explicit_build(_siblings_steps(rub_produces="coated chicken"),
                             *_SIBLING_INGREDIENTS)
    deps = _deps_by_label(result)
    stir = deps["Stir the remaining spice paste into the yogurt."]
    assert set(stir) == {"Grind the spice paste.", "Whisk the yogurt with salt."}
    assert "Rub the chicken with the spice paste." not in stir
    assert "Marinate the chicken for 1 hr." not in stir
    assert deps["Rinse the rice with salt and water."] == []
    assert deps["Whisk the yogurt with salt."] == []
    assert result.graph is not None
    assert validate(result.graph) == []


def test_t_siblings_b_unnamed_product_falls_back_to_conservative_closure() -> None:
    """T-siblings (b): same recipe, but rub names no product -- so rub and marinate
    read as continuation of grind, and the yogurt step waits for them. Rice is still
    independent."""
    result = _explicit_build(_siblings_steps(rub_produces=None), *_SIBLING_INGREDIENTS)
    deps = _deps_by_label(result)
    stir = deps["Stir the remaining spice paste into the yogurt."]
    assert {"Rub the chicken with the spice paste.", "Marinate the chicken for 1 hr."} <= set(stir)
    assert deps["Rinse the rice with salt and water."] == []
    assert result.graph is not None
    assert validate(result.graph) == []


def test_explicit_pairwise_shared_non_staple_forces_an_edge() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Boil the pasta.", depends_on_steps=[],
              consumes_ingredients=["Pasta", "Water", "Salt"]),
        _step(text="Fry the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Serve.", depends_on_steps=[1, 2]),
    ]
    result = _explicit_build(steps, "Onion", "Pasta", "Water", "Salt")
    deps = _deps_by_label(result)
    assert deps["Fry the onion."] == ["Chop the onion."]
    assert result.node_decisions[2].depends_on_previous_source == "inferred"
    assert result.review_recommended is True


def test_explicit_pairwise_shared_staples_do_not_force_an_edge() -> None:
    steps = [
        _step(text="Whisk the eggs.", depends_on_steps=[],
              consumes_ingredients=["Egg", "Salt", "Oil"]),
        _step(text="Rinse the rice.", depends_on_steps=[],
              consumes_ingredients=["Rice", "Salt", "Water", "Oil"]),
        _step(text="Serve.", depends_on_steps=[0, 1]),
    ]
    result = _explicit_build(steps, "Egg", "Rice", "Salt", "Water", "Oil")
    deps = _deps_by_label(result)
    assert deps["Rinse the rice."] == []
    assert result.review_recommended is False


def test_explicit_produced_component_named_oil_still_wires() -> None:
    steps = [
        _step(text="Infuse the oil with garlic.", depends_on_steps=[],
              consumes_ingredients=["Garlic"], produces_component="oil"),
        _step(text="Toast the bread.", depends_on_steps=[], consumes_ingredients=["Bread"]),
        _step(text="Drizzle the oil over the toast.", depends_on_steps=[1],
              consumes_ingredients=["oil"]),
    ]
    result = _explicit_build(steps, "Garlic", "Bread")
    assert result.graph is not None
    infuse, _toast, drizzle = result.graph.nodes
    assert infuse.id in drizzle.depends_on
    assert infuse.produces in drizzle.consumes
    assert validate(result.graph) == []


@pytest.mark.parametrize("station", ["burner", "oven"])
def test_heat_guard_orders_same_heat_station_steps(station: str) -> None:
    steps = [
        _step(text="Fry the onion.", depends_on_steps=[], station=station,
              consumes_ingredients=["Onion"]),
        _step(text="Add the spices to the pan.", depends_on_steps=[], station=station,
              consumes_ingredients=["Spices"]),
    ]
    result = _explicit_build(steps, "Onion", "Spices")
    deps = _deps_by_label(result)
    assert deps["Add the spices to the pan."] == ["Fry the onion."]
    assert result.node_decisions[1].depends_on_previous_source == "inferred"
    assert result.review_recommended is True
    assert any(f"same {station}" in w for w in result.warnings)


def test_heat_guard_adds_nothing_when_the_earlier_step_is_already_reached() -> None:
    steps = [
        _step(text="Heat the pan.", depends_on_steps=[], station="burner"),
        _step(text="Chop the garlic.", depends_on_steps=[0], consumes_ingredients=["Garlic"]),
        _step(text="Fry the garlic.", depends_on_steps=[1], station="burner"),
    ]
    result = _explicit_build(steps, "Garlic")
    deps = _deps_by_label(result)
    assert deps["Fry the garlic."] == ["Chop the garlic."]
    assert result.node_decisions[2].depends_on_previous_source == "extracted"


def test_heat_guard_does_not_force_counter_then_burner() -> None:
    steps = [
        _step(text="Chop the onion.", depends_on_steps=[], consumes_ingredients=["Onion"]),
        _step(text="Boil the water.", depends_on_steps=[], station="burner"),
        _step(text="Serve.", depends_on_steps=[0, 1]),
    ]
    result = _explicit_build(steps, "Onion")
    deps = _deps_by_label(result)
    assert deps["Boil the water."] == []


def test_dangling_sink_is_joined_into_the_finish() -> None:
    steps = [
        _step(text="Chop the parsley.", depends_on_steps=[], consumes_ingredients=["Parsley"]),
        _step(text="Cook the pasta.", depends_on_steps=[], station="burner"),
        _step(text="Serve the pasta.", depends_on_steps=[1]),
    ]
    result = _explicit_build(steps, "Parsley")
    deps = _deps_by_label(result)
    assert deps["Serve the pasta."] == ["Cook the pasta.", "Chop the parsley."]
    assert result.node_decisions[2].depends_on_previous_source == "inferred"
    assert result.review_recommended is True
    assert any("the final step now waits for it" in w for w in result.warnings)
    assert result.graph is not None
    assert validate(result.graph) == []


def test_explicit_producer_consumer_wiring_is_present() -> None:
    steps = [
        _step(text="Make the tomato sauce.", depends_on_steps=[],
              consumes_ingredients=["Tomato"], produces_component="tomato sauce"),
        _step(text="Boil the pasta.", depends_on_steps=[], consumes_ingredients=["Pasta"]),
        _step(text="Toss the pasta in the tomato sauce.", depends_on_steps=[1],
              consumes_ingredients=["tomato sauce"]),
    ]
    result = _explicit_build(steps, "Tomato", "Pasta")
    assert result.graph is not None
    sauce, _boil, toss = result.graph.nodes
    assert sauce.id in toss.depends_on
    assert sauce.produces in toss.consumes
    assert result.node_decisions[2].depends_on_previous_source == "extracted"
    assert validate(result.graph) == []


def test_explicit_producer_consumer_wiring_never_points_backward() -> None:
    steps = [
        _step(text="Add the tomatoes to the dal.", depends_on_steps=[],
              consumes_ingredients=["cooked dal"]),
        _step(text="Cook the dal mixture for 30 minutes.", depends_on_steps=[0],
              produces_component="cooked dal mixture"),
        _step(text="Serve hot.", depends_on_steps=[1]),
    ]
    result = _explicit_build(steps)
    assert result.graph is not None
    first, second, _serve = result.graph.nodes
    assert second.id not in first.depends_on
    assert not any(v.rule == "acyclic" for v in validate(result.graph))


def test_explicit_path_end_to_end_prep_fits_in_the_chill_window() -> None:
    """build_graph -> validate -> the unchanged scheduler: two independent preps land
    in the chill window, and shaping (claiming only [mix]) waits for the chill."""
    from abc_cook.schedule import schedule

    def timed(minutes: int) -> dict[str, object]:
        return {
            "duration_min": minutes,
            "duration_typical_min": minutes,
            "duration_max": minutes,
            "duration_stated": True,
        }

    steps = [
        _step(text="Mix the dough.", depends_on_steps=[],
              consumes_ingredients=["Flour", "Butter"], **timed(5)),
        _step(text="Chill the dough in the fridge for 30 minutes.", depends_on_steps=[0],
              attention="unattended", attention_cue="in the fridge for 30 minutes",
              station="fridge", **timed(30)),
        _step(text="Chop the herbs.", depends_on_steps=[], consumes_ingredients=["Herbs"],
              **timed(5)),
        _step(text="Grate the cheese.", depends_on_steps=[], consumes_ingredients=["Cheese"],
              **timed(5)),
        _step(text="Shape the dough into a round.", depends_on_steps=[0], **timed(5)),
        _step(text="Top with the herbs and cheese and bake.", depends_on_steps=[2, 3, 4],
              consumes_ingredients=["Herbs", "Cheese"], station="oven", **timed(20)),
    ]
    result = _explicit_build(steps, "Flour", "Butter", "Herbs", "Cheese")
    assert result.graph is not None
    assert validate(result.graph) == []
    plan = schedule(result.graph)
    assert plan.saved_min > 0

    mix, chill, chop, grate, shape, _bake = result.graph.nodes
    placed = {s.node_id: s for s in plan.scheduled}
    chill_windows = [w for w in plan.windows if w.host_node_id == chill.id]
    assert len(chill_windows) == 1
    assert {chop.id, grate.id} <= set(chill_windows[0].assigned)
    assert placed[shape.id].start_min >= placed[chill.id].end_min
    assert mix.id in shape.depends_on


def test_none_versus_empty_claim_regression() -> None:
    """`None` = not provided -> the conservative previous-step default. `[]` = a claim
    of no dependencies -> no default edge, only the safety edges the guards add."""

    def build(
        claim: list[int] | None,
        *,
        nuts_produce: str | None = None,
        station: str = "counter",
        consumes: tuple[str, ...] = ("Vinegar",),
    ) -> GraphBuildResult:
        steps = [
            _step(text="Toast the nuts.", depends_on_steps=[], station=station,
                  consumes_ingredients=["Nuts"], produces_component=nuts_produce),
            _step(text="Whisk the dressing.", depends_on_steps=claim, station=station,
                  consumes_ingredients=list(consumes)),
            _step(text="Serve the salad.", depends_on_steps=[0, 1]),
        ]
        return _explicit_build(steps, "Nuts", "Vinegar")

    as_none = build(None)
    assert _deps_by_label(as_none)["Whisk the dressing."] == ["Toast the nuts."]
    assert as_none.node_decisions[1].depends_on_previous_source == "defaulted"

    as_empty = build([])
    assert _deps_by_label(as_empty)["Whisk the dressing."] == []
    assert as_empty.node_decisions[1].depends_on_previous_source == "extracted"

    # `[]` still receives the safety edges -- and only those.
    with_product = build([], nuts_produce="toasted nuts", consumes=("Vinegar", "toasted nuts"))
    assert _deps_by_label(with_product)["Whisk the dressing."] == ["Toast the nuts."]
    assert with_product.node_decisions[1].depends_on_previous_source == "extracted"

    on_one_burner = build([], station="burner")
    assert _deps_by_label(on_one_burner)["Whisk the dressing."] == ["Toast the nuts."]
    assert on_one_burner.node_decisions[1].depends_on_previous_source == "inferred"
