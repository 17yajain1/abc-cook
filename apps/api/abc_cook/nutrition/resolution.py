"""What the matcher decided for one ingredient line; the calculator's only link to `match.py`."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

FoodSource = Literal["cache", "alias", "exact", "llm"]
MissReason = Literal[
    "llm_none",  # the model said no shortlisted food fits
    "off_shortlist",  # the model named a food outside the line's shortlist; rejected
    "no_candidates",  # nothing in the table shares a word with the line
    "llm_failed",  # the call failed or returned nothing usable
    "spend_guard",  # the call was refused to stay under the ₹ cap
    "cached_none",  # an earlier run already found no food for this name
]


@dataclass(frozen=True)
class LineResolution:
    """A line's matched food (or why there is none) and an optional LLM gram estimate."""

    food_id: str | None = None
    food_source: FoodSource | None = None
    llm_grams: float | None = None
    miss: MissReason | None = None
