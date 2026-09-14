"""Acquisition legs: turn a source URL into a `RawAcquisition`. No LLM anywhere here.

See docs/M2.9-youtube-import-design.md §4.4. `RawAcquisition` is the only thing
downstream (`normalize.py`) sees — it carries every field a future acquisition leg
could populate, each nullable, so adding a leg (captions, audio transcription) means
adding one producer function here, never a downstream redesign.
"""

from typing import Any

from pydantic import BaseModel, Field

from abc_cook.schema.normalized import NormalizedChapter


class RawAcquisition(BaseModel):
    """Everything acquired about a source, before any LLM call.

    Transient and extract-internal: never persisted, never returned by the API.
    `normalize.py` is the only consumer.
    """

    source_url: str = Field(description="The URL the import started from.")
    title: str = Field(description="Video or page title.")
    channel: str | None = Field(default=None, description="Channel or site name.")

    description: str | None = Field(
        default=None,
        description="Leg 1: the video description, verbatim. None if unavailable.",
    )
    chapters: list[NormalizedChapter] = Field(
        default_factory=list,
        description="Leg 1: chapter markers parsed from the description, if present.",
    )
    video_duration_sec: int | None = Field(
        default=None,
        description=(
            "Raw video runtime, for logging only. NEVER used to populate "
            "stated_total_min (design doc §5) — it includes talking and editing."
        ),
    )

    blog_recipe: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Leg 2: a schema.org Recipe node (raw parsed JSON-LD), when a "
            "description-linked blog carried one. Takes precedence over `description` "
            "for method text when present (design doc §4.4)."
        ),
    )

    transcript: str | None = Field(
        default=None,
        description="Leg 3/4 (captions/audio), postponed. Always None until built.",
    )
