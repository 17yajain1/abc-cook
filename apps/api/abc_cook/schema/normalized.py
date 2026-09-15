"""The import pipeline's intermediate value: NormalizedRecipe, and its neighbours.

See docs/M2.9-youtube-import-design.md §4.1 and §7. `normalize.py` produces a
`NormalizedRecipe` from a raw acquisition; `graph.py` turns that into a `CookingGraph`
or a refusal. `NormalizedRecipe` is the real, inspectable value that crosses the seam
between the two — never a persisted `CookingGraph` written to directly.

Every field on `NormalizedStep` that the LLM classifies (`attention`, `duration_stated`,
`freshness`) is a HINT, not a fact. Verification B (design doc §10.C) found the model's
own self-reported classification cannot be trusted as emitted: in one observed case its
free-text reasoning correctly identified a Tier 0 case while the structured field it
returned said the opposite. `attention_cue` and `freshness_cue` exist so `graph.py` can
independently confirm a cue is actually present in the source text before trusting a
non-default classification — never take `attention`/`freshness` at face value alone.
"""

from typing import Literal

from pydantic import BaseModel, Field

from abc_cook.schema.graph import CookingGraph
from abc_cook.schema.node import Attention, Station
from abc_cook.schema.plan import CookingPlan, StageSpan

Freshness = Literal["none", "stated_unbounded", "stated_numeric"]
"""Three-valued freshness (design doc §4.6). Never collapse "unknown" into "none"."""

ProvenanceSource = Literal["extracted", "inferred", "defaulted"]
"""How a graph field's value was arrived at. Computed by `provenance.py`, never
self-reported by the LLM (design doc §10.C)."""

ImportStatus = Literal[
    "acquiring", "extracting", "validating", "done", "method_not_grounded", "failed"
]
"""Job status for `GET /import/{job_id}` (design doc §4.5)."""

ImportSource = Literal["description", "blog", "transcript"]
"""Which `RawAcquisition` legs actually fed a given import (M2.10 decision 6's
sibling: `ImportResult.sources` reports this so a report or a future UI hint can say
"grounded from the transcript" without a second round trip)."""


class NormalizedIngredient(BaseModel):
    """One ingredient line, structured but not yet graph-ready.

    `qty` stays a free-text string, not a float: real sources state quantities as
    "a little less than 2", "1/2", or ranges, which cannot be honestly forced into a
    single number here. `graph.py` does that best-effort conversion, not this model.
    """

    name: str = Field(description="As named in the source. Never invented.")
    qty: str | None = Field(description="Quantity as stated, verbatim or lightly normalized.")
    unit: str | None = Field(description='Unit, e.g. "cup", "tsp", "medium".')
    prep_note: str | None = Field(
        description='Stated on the ingredient line itself, e.g. "finely chopped".',
    )
    group: str | None = Field(
        default=None,
        description='Ingredient grouping, e.g. "For tadka", when the source states one.',
    )


class NormalizedChapter(BaseModel):
    """A YouTube chapter marker. Grounded, but stage-level — never a node duration.

    See design doc §0: a chapter delta measures how long the creator spent on screen,
    not how long the cook will spend. Used only by `corroborate.py`.
    """

    label: str = Field(description='Chapter title, e.g. "Marination".')
    start_sec: int = Field(description="Chapter start, in seconds from video start.")
    end_sec: int | None = Field(
        default=None,
        description="Chapter end, in seconds. Null for the last chapter if unknown.",
    )


class NormalizedStep(BaseModel):
    """One candidate node, before `graph.py` decides how to build it.

    Mirrors the shape of `Node` closely enough that `graph.py` is mostly a direct
    translation, but stays looser where real sources are messy (`duration_*` as
    `float | None` rather than required ints) and adds the hint/verification fields
    §10.C's independent-verification rule needs.
    """

    text: str = Field(description="The step, lightly normalized. Never invented.")

    attention: Attention = Field(
        description=(
            "The model's classification. MUST default to hands_on when no explicit "
            "cue is present (design doc §5) — graph.py re-checks this via "
            "attention_cue before trusting periodic/unattended."
        ),
    )
    attention_cue: str | None = Field(
        default=None,
        description=(
            "Verbatim source phrase justifying periodic/unattended. Null when "
            "attention is hands_on. graph.py must confirm this string actually "
            "appears in the source text before honoring a non-hands_on attention."
        ),
    )

    duration_typical_min: float | None = Field(default=None)
    duration_min: float | None = Field(default=None)
    duration_max: float | None = Field(default=None)
    duration_stated: bool = Field(
        description=(
            "True only if a number was written in the source text; False if this is "
            "a plausible estimate from a vague-but-present cue (\"cook until golden\"). "
            "graph.py applies the §4.7 low-end clamp (duration_typical = duration_min) "
            "to window-host nodes when this is False."
        ),
    )

    depends_on_previous: bool = Field(
        default=True,
        description=(
            "Consecutive stated steps default to sequential (§4.7). False only when "
            "the model asserts genuine independence; graph.py still applies the "
            "two-condition test (no shared ingredient/component, no produces/consumes "
            "link) before honoring False."
        ),
    )
    consumes_ingredients: list[str] = Field(
        default_factory=list,
        description="Ingredient names (matching NormalizedIngredient.name) this step uses.",
    )
    produces_component: str | None = Field(
        default=None,
        description="Freeform label for what this step yields, if a later step needs it.",
    )

    station: Station = Field(description="Explicit if stated; else the §4.7 verb-based default.")
    interruptible: bool = Field(
        description="Almost never stated; §4.7 default is prep=true, active/finish=false.",
    )

    freshness: Freshness = Field(
        description="See module docstring: never invent a number for stated_unbounded.",
    )
    freshness_cue: str | None = Field(
        default=None,
        description=(
            "Verbatim source phrase, when freshness != none. graph.py should require "
            "this to carry a genuine immediacy marker (\"immediately\", \"just before "
            "serving\") before trusting stated_unbounded — a bare \"serve\" is not "
            "one (§10.C finding 3)."
        ),
    )
    max_lead_min: int | None = Field(
        default=None,
        description="ONLY populated for stated_numeric. Never a guessed number.",
    )
    doneness_cue: str | None = Field(
        default=None,
        description='A qualitative phrase, only if textually present, e.g. "until golden".',
    )


class NormalizedRecipe(BaseModel):
    """The real, inspectable value that crosses the normalize -> graph seam.

    `method_grounded` is the model's own claim and MUST NOT be trusted as-is
    (§10.C finding 1): `normalize.py`'s Tier 0 gate recomputes it as `bool(steps)`
    before any caller acts on it.
    """

    title: str = Field(description="Source title, e.g. the video title.")
    channel: str | None = Field(default=None, description="Source channel/site name.")

    method_grounded: bool = Field(
        description=(
            "The model's own claim about whether method text existed. A hint only — "
            "callers must independently verify via `bool(steps)`."
        ),
    )

    servings: int | None = Field(default=None)
    servings_source: Literal["stated", "defaulted"] = Field(default="defaulted")
    cuisine: str | None = Field(default=None)
    stated_total_min: int | None = Field(
        default=None,
        description="ONLY an explicit stated total-time claim. Never derived from video duration.",
    )

    ingredients: list[NormalizedIngredient] = Field(default_factory=list)
    steps: list[NormalizedStep] = Field(default_factory=list)
    chapters: list[NormalizedChapter] = Field(default_factory=list)

    notes: list[str] = Field(
        default_factory=list,
        description="Free-text notes for a human reviewer: ambiguities, translation doubts, etc.",
    )


class NodeProvenance(BaseModel):
    """Per-node provenance: how each field's value was arrived at, plus freshness."""

    fields: dict[str, ProvenanceSource] = Field(
        default_factory=dict,
        description="Field name -> extracted/inferred/defaulted.",
    )
    freshness: Freshness = Field(default="none")
    freshness_cue: str | None = Field(default=None)


class GraphProvenance(BaseModel):
    """Sibling record to a `CookingGraph`, keyed by node id.

    Deliberately not a field on `Node` (design doc §5, "Where confidence/provenance
    lives") — computed by `provenance.py` alongside `graph.py`'s output, so `Node` and
    the golden fixtures stay byte-identical.
    """

    nodes: dict[str, NodeProvenance] = Field(default_factory=dict)


class ImportResult(BaseModel):
    """The `/import` response payload.

    A separate envelope from `RecipePlanResponse` (design doc §9 decision 3) — that
    response stays the frozen contract for the fixture path.
    """

    status: ImportStatus
    source_title: str | None = Field(default=None)
    ingredients: list[NormalizedIngredient] = Field(
        default_factory=list,
        description="Present even at Tier 0 — a shopping list is real recovered information.",
    )
    graph: CookingGraph | None = Field(default=None)
    plan: CookingPlan | None = Field(default=None)
    stages: list[StageSpan] | None = Field(default=None)
    provenance: GraphProvenance | None = Field(default=None)
    review_recommended: bool = Field(default=False)
    warnings: list[str] = Field(default_factory=list)
    sources: list[ImportSource] = Field(
        default_factory=list,
        description=(
            "Which RawAcquisition legs were non-empty for this import (M2.10). Set on "
            "both Tier 0 and `done` results — a Tier 0 screen can say 'no captions on "
            "this video' without another round trip."
        ),
    )
