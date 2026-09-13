"""Provider-agnostic contract for the one extraction call per import (decision 1).

See docs/M2.9-youtube-import-design.md §4.1/§7/§10.C. LOCKED DECISION 2: an adapter's
`NormalizedRecipe` is a proposal, never authoritative scheduler input — `normalize.py`
and `graph.py` independently verify every scheduling-relevant field. An adapter's only
job is turning a prompt + source text into a candidate `NormalizedRecipe`, or reporting
that it could not.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from abc_cook.schema.normalized import NormalizedRecipe


@dataclass(frozen=True)
class ExtractResult:
    """One extraction attempt's outcome.

    `recipe` is None whenever no usable structure came back. `truncated=True` means
    the provider cut the response off before it finished (output-token budget too
    small — §10.C finding 5); `normalize.py` treats this as retry-eligible the same
    way it treats any other unparseable response, per LOCKED DECISION 3. `error`
    carries a short diagnostic for logs; never shown to the end user.
    """

    recipe: NormalizedRecipe | None
    truncated: bool = False
    error: str | None = None


class LLMAdapter(Protocol):
    """The provider boundary. `normalize.py` never imports a provider SDK directly."""

    def extract(
        self, *, prompt: str, source_text: str, model: str, max_tokens: int
    ) -> ExtractResult:
        """Run one structured-extraction call.

        Args:
            prompt: The system/instruction prompt (`extract/prompts/v1.md`'s contents).
            source_text: The raw acquisition rendered as text (`normalize.py`'s job).
            model: Provider model id, e.g. "claude-haiku-4-5-20251001".
            max_tokens: Output token budget for this attempt.

        Returns:
            An `ExtractResult`. Implementations must not raise for a provider-side
            failure (network error, rate limit, malformed response) — report it as
            `ExtractResult(recipe=None, error=...)` instead, so `normalize.py`'s
            retry-once-then-degrade logic has one uniform shape to handle regardless
            of provider.
        """
        ...
