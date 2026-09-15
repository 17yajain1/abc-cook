"""Dispatches one `LLMAdapter` call to the right provider adapter by model id.

Added M2.11: extraction moved to GPT-5-mini (OpenAI) while repair stays on Sonnet
(Anthropic) -- see `normalize.DEFAULT_MODEL` / `repair.REPAIR_MODEL`. `run_import` and
`repair_or_degrade` each take exactly one `adapter: LLMAdapter` (CLAUDE.md: "one
provider behind an adapter interface"); this module is what lets that stay a single
object end-to-end even though two real providers are now involved, so nothing in
`import_pipeline.py`, `normalize.py`, or `repair.py` needs to know that.

`build_default_adapter` is the one place production wiring and the `@pytest.mark.llm`
tests that exercise the real pipeline both construct it, so the two never drift apart.
"""

from __future__ import annotations

import pydantic

from abc_cook.extract.adapters.anthropic import AnthropicAdapter
from abc_cook.extract.adapters.base import EffortLevel, ExtractResult, LLMAdapter
from abc_cook.extract.adapters.openai import OpenAIAdapter


class RoutingAdapter:
    """Routes `.extract(model=...)` to whichever registered adapter owns that model id.

    An unregistered model is a caller/config bug, not a provider failure -- but per
    `LLMAdapter.extract`'s contract ("must not raise"), it is still reported as an
    `ExtractResult(recipe=None, error=...)`, the same uniform shape every other
    failure takes, rather than a raised exception.
    """

    def __init__(self, by_model: dict[str, LLMAdapter]) -> None:
        """Construct the router from a model id -> adapter mapping."""
        self._by_model = by_model

    def extract[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None = None,
    ) -> ExtractResult[T]:
        """See `LLMAdapter.extract`."""
        adapter = self._by_model.get(model)
        if adapter is None:
            return ExtractResult(
                recipe=None,
                error=f"RoutingAdapter: no adapter registered for model {model!r}",
            )
        return adapter.extract(
            prompt=prompt,
            source_text=source_text,
            model=model,
            max_tokens=max_tokens,
            output_type=output_type,
            effort=effort,
        )


def build_default_adapter() -> RoutingAdapter:
    """The real production wiring: GPT-5-mini extracts, Sonnet repairs.

    Reads `normalize.DEFAULT_MODEL` / `repair.REPAIR_MODEL` rather than repeating the
    model ids here, so this can't silently drift from the constants that actually
    control which model each stage requests.
    """
    from abc_cook.extract.normalize import DEFAULT_MODEL
    from abc_cook.extract.repair import REPAIR_MODEL

    return RoutingAdapter(
        {
            DEFAULT_MODEL: OpenAIAdapter(),
            REPAIR_MODEL: AnthropicAdapter(),
        }
    )
