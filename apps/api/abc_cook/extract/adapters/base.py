"""Provider-agnostic contract for a single structured extraction call.

See docs/M2.9-youtube-import-design.md §4.1/§7/§10.C. LOCKED DECISION 2: any model
returned through this boundary is a proposal, never authoritative scheduler input —
`normalize.py` and `graph.py` independently verify every scheduling-relevant field. An
adapter's only job is turning a prompt + source text into a candidate structured
value, or reporting that it could not.

Generic over the output type (`normalize.py` asks for a full `NormalizedRecipe`;
`repair.py` asks for a much smaller `RepairProposal`, since a repair response only
ever needs three fields per step, not the whole recipe echoed back — see repair.py's
module docstring for why that distinction is load-bearing, not cosmetic).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import pydantic

EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]
"""Reasoning-effort hint (design doc §6.2: "adaptive thinking at effort: low" for the
repair pass). Optional and provider-dependent — an adapter that has no such concept
simply ignores it."""


@dataclass(frozen=True)
class ExtractResult[T: pydantic.BaseModel]:
    """One extraction attempt's outcome.

    `recipe` is None whenever no usable structure came back. `truncated=True` means
    the provider cut the response off before it finished (output-token budget too
    small — §10.C finding 5); callers treat this as retry-eligible the same way they
    treat any other unparseable response. `error` carries a short diagnostic for logs;
    never shown to the end user.
    """

    recipe: T | None
    truncated: bool = False
    error: str | None = None


class LLMAdapter(Protocol):
    """The provider boundary. Callers never import a provider SDK directly."""

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
        """Run one structured-extraction call.

        Args:
            prompt: The system/instruction prompt.
            source_text: The rendered input text.
            model: Provider model id, e.g. "claude-haiku-4-5-20251001".
            max_tokens: Output token budget for this attempt.
            output_type: The Pydantic model the response must validate against.
            effort: Optional reasoning-effort hint; ignored by an adapter/model that
                has no such concept.

        Returns:
            An `ExtractResult[output_type]`. Implementations must not raise for a
            provider-side failure (network error, rate limit, malformed response) —
            report it as `ExtractResult(recipe=None, error=...)` instead, so a
            caller's retry-once-then-degrade logic has one uniform shape to handle
            regardless of provider.
        """
        ...
