"""extract/graph.py -- independent verification of everything an LLM claims.

Per docs/M2.9-youtube-import-design.md §8.1 and the M2.9 locked decisions: these tests
build small, synthetic `NormalizedRecipe`s that each isolate one verification rule
(attention cue grounding, freshness cue grounding, the window-host duration clamp, the
depends_on_previous safety test), and check `build_graph`'s output against the raw
source text independently of whatever the fake "model" claimed.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from abc_cook.extract.graph import (
    GraphBuildResult,
    _clean_cue,
    _label,
    _parse_qty,
    build_graph,
)
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
