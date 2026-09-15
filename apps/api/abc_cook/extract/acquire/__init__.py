"""Acquisition legs: turn a source URL into a `RawAcquisition`. No LLM anywhere here.

See docs/M2.9-youtube-import-design.md §4.4. `RawAcquisition` is the only thing
downstream (`normalize.py`) sees — it carries every field a future acquisition leg
could populate, each nullable, so adding a leg (captions, done in M2.10; audio
transcription/ASR, still deferred) means adding one producer function here, never a
downstream redesign.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from abc_cook.extract.acquire.transcript import TranscriptSegment
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
        description=(
            "Leg 3: flattened caption text (manual subtitles or auto-captions), when "
            "a track was found. None if the video has no caption track (leg 4, ASR, "
            "is deferred -- see the M2.10 plan)."
        ),
    )
    transcript_segments: list[TranscriptSegment] = Field(
        default_factory=list,
        description=(
            "Leg 3, timestamped. Transient -- not rendered to the LLM (that gets "
            "`transcript`, the flattened text) and not exposed by the API. Kept for a "
            "future duration-corroboration use, per the M2.10 plan."
        ),
    )
    transcript_kind: Literal["manual", "auto"] | None = Field(
        default=None,
        description="Whether `transcript` came from creator-uploaded or auto-generated captions.",
    )
    transcript_lang: str | None = Field(
        default=None,
        description='The caption track\'s language code, e.g. "en", "hi".',
    )

    acquisition_warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Non-fatal notes from acquisition (e.g. transcript truncated at the char "
            "cap), carried into ImportResult.warnings by import_pipeline.py."
        ),
    )
