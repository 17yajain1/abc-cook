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
    preheat = result.graph.nodes[1]
    assert preheat.depends_on == []  # independence claim honored -> true parallel source


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
