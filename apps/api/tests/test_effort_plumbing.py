"""A4: reasoning effort is a plumbed constant, default unchanged (provider default)."""

from __future__ import annotations

from dataclasses import dataclass, field

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.adapters.openai import _EFFORT_MAP
from abc_cook.extract.import_pipeline import run_import
from abc_cook.extract.normalize import EXTRACTION_EFFORT, normalize
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep


@dataclass
class _Recorder:
    efforts: list[object] = field(default_factory=list)

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
        self.efforts.append(effort)
        return ExtractResult(recipe=_recipe())


def _recipe() -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Dal",
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note=None)],
        steps=[
            NormalizedStep(
                text="Heat oil, add onion, cook until golden, serve hot.",
                attention="hands_on",
                duration_stated=False,
                consumes_ingredients=["Onion"],
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )


RAW = RawAcquisition(
    source_url="https://youtu.be/t", title="Dal", description="1 onion. Heat oil, add onion."
)


def test_production_default_sends_no_effort_at_all() -> None:
    assert EXTRACTION_EFFORT is None
    recorder = _Recorder()
    normalize(RAW, recorder)
    assert recorder.efforts == [None]


def test_normalize_passes_an_explicit_effort_to_the_adapter() -> None:
    recorder = _Recorder()
    normalize(RAW, recorder, effort="low")
    assert recorder.efforts == ["low"]


def test_run_import_threads_extraction_effort_to_normalize() -> None:
    recorder = _Recorder()
    run_import(
        "https://youtu.be/t",
        recorder,
        graph_id="g_effort",
        acquire_fn=lambda url: RAW,
        extraction_effort="minimal",
    )
    assert recorder.efforts == ["minimal"]


def test_openai_adapter_can_send_minimal() -> None:
    assert _EFFORT_MAP["minimal"] == "minimal"
    assert _EFFORT_MAP["max"] == "high"  # unchanged capping
