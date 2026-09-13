"""extract/normalize.py -- the Tier 0 gate and the retry-once-then-degrade logic.

Offline: a fake `LLMAdapter` stands in for the provider, per
docs/M2.9-youtube-import-design.md §8.1 ("normalize.py without the LLM: the Tier 0
gate and chapter parsing are pure functions... tested as such"). The LLM-dependent
structuring itself is exercised at tier 3 (`@pytest.mark.llm`), not here.
"""

from __future__ import annotations

from dataclasses import dataclass

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.normalize import normalize, render_source_text
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep


def _raw(**overrides: object) -> RawAcquisition:
    defaults: dict[str, object] = {
        "source_url": "https://youtu.be/test",
        "title": "Test Recipe",
        "description": "1 onion, chopped. Heat oil, add onion, cook until golden. Serve hot.",
    }
    defaults.update(overrides)
    return RawAcquisition(**defaults)  # type: ignore[arg-type]


def _ingredients_only_recipe(*, method_grounded_claim: bool = True) -> NormalizedRecipe:
    """A recipe the model mis-self-reports as grounded despite an empty step list --
    the exact §10.C finding 1 shape this gate exists to catch."""
    return NormalizedRecipe(
        title="Test Recipe",
        method_grounded=method_grounded_claim,
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note="chopped")
        ],
        steps=[],
    )


def _grounded_recipe() -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test Recipe",
        method_grounded=True,
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note="chopped")
        ],
        steps=[
            NormalizedStep(
                text="Heat oil, add onion, cook until golden.",
                attention="hands_on",
                duration_stated=False,
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )


@dataclass
class _FakeAdapter:
    """Returns queued `ExtractResult`s in order, one per `.extract()` call."""

    results: list[ExtractResult]
    calls: int = 0

    def extract(
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type,
        effort: str | None = None,
    ) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


def test_render_source_text_includes_title_and_description() -> None:
    text = render_source_text(_raw())
    assert "Test Recipe" in text
    assert "onion" in text.lower()


def test_render_source_text_includes_blog_recipe_when_present() -> None:
    raw = _raw(blog_recipe={"@type": "Recipe", "recipeIngredient": ["1 onion"]})
    text = render_source_text(raw)
    assert "recipeIngredient" in text


def test_tier0_gate_ignores_models_own_method_grounded_claim() -> None:
    """§10.C finding 1: the model's structured method_grounded field is untrustworthy
    even when it claims True -- normalize.py must recompute from bool(steps)."""
    adapter = _FakeAdapter(
        results=[ExtractResult(recipe=_ingredients_only_recipe(method_grounded_claim=True))]
    )
    outcome = normalize(_raw(), adapter)
    assert outcome.method_grounded is False
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "method_not_grounded"
    assert outcome.tier0_result.ingredients[0].name == "Onion"
    assert outcome.tier0_result.graph is None
    assert outcome.recipe is None
    assert adapter.calls == 1  # exactly one LLM call for a grounded structural response


def test_grounded_recipe_passes_through() -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    outcome = normalize(_raw(), adapter)
    assert outcome.method_grounded is True
    assert outcome.recipe is not None
    assert outcome.tier0_result is None
    assert adapter.calls == 1


def test_truncated_first_attempt_retries_once() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, truncated=True, error="max_tokens"),
            ExtractResult(recipe=_grounded_recipe()),
        ]
    )
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.method_grounded is True


def test_two_failed_attempts_degrade_to_tier0() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, error="boom"),
            ExtractResult(recipe=None, error="boom again"),
        ]
    )
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2  # never a third attempt
    assert outcome.recipe is None
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "method_not_grounded"
    assert outcome.tier0_result.ingredients == []
    assert outcome.tier0_result.warnings  # explains why, for logs/debugging
