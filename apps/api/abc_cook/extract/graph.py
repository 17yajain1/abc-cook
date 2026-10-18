"""`NormalizedRecipe` -> `CookingGraph`. THE seam (design doc §4.1).

This is where every "the model's claim is a hint, not a fact" rule in
docs/M2.9-youtube-import-design.md §4.6/§4.7 and the M2.9 locked decisions actually
gets enforced in code:

- `attention`: honored only when `attention_cue` is a real substring of the source
  text; otherwise forced to `hands_on` (decision 4).
- `freshness`: `stated_unbounded`/`stated_numeric` honored only when `freshness_cue`
  carries a genuine immediacy marker AND is grounded in the source text; otherwise
  forced to `none` (decision 5).
- Duration: window-host durations (unattended/periodic, not explicitly stated) are
  clamped so `duration_typical == duration_min` (decision 6, §4.7); missing durations
  get a deterministic, clearly-`defaulted` fallback, never an invented "plausible"
  number attributed to the model.
- `depends_on_previous=False` is honored only when the §4.7 two-condition safety test
  passes: no shared ingredient with the immediately preceding step, and neither
  consumes a component the other produces. Otherwise: sequential, no exceptions.
  A shared pantry staple (salt, water, oil) is not a shared ingredient (CP2 E).
- `depends_on_steps` (CP2 A), when any required step states it: claims are sanitized,
  extended by producer edges and the descendant closure, verified pairwise against
  every earlier step they don't reach, guarded against same-heat-station reordering,
  and any leftover dangling node is joined into the finish. Edges are only added.
- `role` (CP2 B): an optional/alternative step with a grounded, marker-bearing
  `role_cue` becomes a verbatim note in the `tip` of the step it modifies.

`graph.py` refuses (returns `outcome.graph is None`) if handed a recipe with no steps,
even though `normalize.py`'s Tier 0 gate should already have stopped the pipeline
before this is ever called — per §10.C's rule, this must not depend on every future
caller remembering the gate.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field, replace
from typing import Literal

from abc_cook.schema.graph import CookingGraph, SourceRef, Stage
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Attention, Node, NodeKind
from abc_cook.schema.normalized import Freshness, NormalizedRecipe, NormalizedStep, ProvenanceSource

_logger = logging.getLogger(__name__)

_IMMEDIACY_MARKERS = (
    "immediately",
    "right before",
    "just before",
    "right away",
    "at the last moment",
    "just prior",
    "last minute",
    "last-minute",
)
"""§10.C finding 3: a bare "serve" is not an immediacy marker. Only these phrases are."""

_OPTIONAL_MARKERS = (
    "if you",
    "if desired",
    "optional",
    "alternatively",
    "instead",
    "or you can",
    "method:",
    # FGC-4: a substitution, or several ways to serve, is a note on the step it modifies.
    "can be replaced",
    "replaced with",
    "replace with",
    "substitute",
    "in place of",
    "different ways",
    "another way",
    "ways to eat",
    "ways to serve",
    "की जगह",
    "ki jagah",
    "चाहें तो",
    "chahe to",
)
"""CP2 decision B: an optional/alternative role is honored only when its grounded
`role_cue` carries one of these. Same closed-list pattern as `_IMMEDIACY_MARKERS`.
Deliberately no "note:" / "tip:": a "Note: soak overnight" demoted to a tip would drop a
required wait."""

_ROLE_TIP_PREFIX = {"optional": "Optional: ", "alternative": "Alternative: "}

_SEQUENCE_CONNECTIVES = ("then", "once", "after", "next", "now", "meanwhile")

_PREP_VERBS = (
    "chop", "dice", "mince", "peel", "grate", "wash", "rinse", "slice", "knead",
    "measure", "whisk", "beat", "wisk",
)
_UNATTENDED_PASSIVE_VERBS = (
    "bake", "roast", "simmer", "boil", "steam", "fry", "cook", "rise", "prove",
    "rest", "cool", "chill", "marinate", "soak", "preheat", "ferment",
)
_COMBINE_VERBS = ("mix", "combine", "fold", "toss", "add", "stir together", "blend")

_DEFAULT_DURATION_MIN = {
    "prep": (3, 5, 8),
    "combine": (2, 3, 5),
    "active": (5, 8, 12),
    "passive": (10, 15, 20),
    "finish": (1, 2, 3),
}
"""Deterministic fallback (min, typical, max) by kind, used only when the model gave
no numbers at all. Always recorded as `defaulted` in provenance — never presented as
an estimate the model made."""


@dataclass(frozen=True)
class NodeDecision:
    """What graph.py decided for one node, and why. Input to `provenance.py`."""

    node_id: str
    attention_source: ProvenanceSource
    duration_source: ProvenanceSource
    depends_on_previous_source: ProvenanceSource
    freshness: Freshness
    freshness_cue: str | None
    origin: Literal["source", "added"] = "source"
    """`added` for a step ABC Cook added because the source skips it (FGC-3)."""


@dataclass(frozen=True)
class GraphBuildResult:
    """`graph.py`'s full output: the graph, plus what provenance.py needs."""

    graph: CookingGraph | None
    node_decisions: list[NodeDecision] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    review_recommended: bool = False


def _slugify(text: str, *, max_words: int = 6) -> str:
    words = re.findall(r"[a-z0-9]+", text.lower())[:max_words]
    return "_".join(words) if words else "x"


_LABEL_VULGAR_FRACTIONS = "¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞"
_LABEL_TOKEN_RE = re.compile(
    rf"\d+(?:/\d+)?|[{_LABEL_VULGAR_FRACTIONS}]|[A-Za-z][A-Za-z']*"
)
_LABEL_PREFIX_RE = re.compile(r"^[A-Za-z]+:\s+")
_LABEL_FUNCTION_WORDS = {
    "in", "on", "or", "and", "with", "to", "your", "the", "a", "of", "for",
    "until", "then", "about", "onto", "over",
}
"""Closed-class prepositions/conjunctions/articles a label must not start or end on
(A1.1) -- a label ending or opening on one of these reads as a truncated fragment
rather than a phrase, regardless of which specific words the source used."""
_LABEL_BARE_NUMBER_RE = re.compile(r"^\d+$")
"""A trailing token that is a bare integer (no unit, no fraction) is almost always a
duration/quantity fragment truncated by max_words (e.g. "...2" of "2 minutes"), not a
meaningful label ending -- drop it (A1.1)."""

_LABEL_TRAILING_TRIM_WORDS = _LABEL_FUNCTION_WORDS | {
    "from", "while", "into", "at", "by", "as", "if", "when", "before", "after", "till",
}
"""P1 #5 §R4: the fallback's trailing trim is widened beyond `_LABEL_FUNCTION_WORDS` --
a truncated 4-word cut lands on one of these often enough to matter ("Remove the pan
from", "Add melted butter while...", dal's "Cook the tomatoes till") -- but the
LEADING skip stays on the narrower set; a label legitimately starting mid-clause on
"while"/"if"/etc. is not the same failure as ending on one."""


def _label(text: str, *, max_words: int = 4) -> str:
    body = _LABEL_PREFIX_RE.sub("", text)
    all_tokens = _LABEL_TOKEN_RE.findall(body)

    start = 0
    while start < len(all_tokens) - 1 and all_tokens[start].lower() in _LABEL_FUNCTION_WORDS:
        start += 1

    tokens = all_tokens[start : start + max_words]
    while tokens and (
        tokens[-1].lower() in _LABEL_TRAILING_TRIM_WORDS
        or _LABEL_BARE_NUMBER_RE.fullmatch(tokens[-1])
    ):
        tokens.pop()
    label = " ".join(tokens)
    return (label[:1].upper() + label[1:]) if label else text[:40]


_LABEL_OPENING_MARKERS = {"if", "when", "as", "optional", "alternatively"}
"""A model-written label opening on one of these reads as a condition or an aside, not
a task name (§R2) -- distinct from `_LABEL_FUNCTION_WORDS`, which guards the fallback
trimmer's own leading/trailing cuts, not the model's free-form label."""


def _accept_label(label: str | None, text: str) -> str:
    """P1 #5 §R2: shape-only acceptance of the model's own `NormalizedStep.label`.

    Accepted when it has 1-4 word tokens, doesn't open on a conditional/optional
    marker, and doesn't end on a (widened) function word. Deliberately never checked
    against the step's own text for topical match -- that would reject as many good
    summaries ("Whisk the eggs..." -> "Mix marinade", "Cover and leave..." -> "First
    rise") as it would catch a fluent-but-wrong one (§R2 calibration: any overlap
    threshold throws away 14-57% of human-quality labels). Falls back to `_label(text)`
    otherwise -- including when the model gave no label at all (every pre-P1-5 replay
    fixture takes this path, since their captured `NormalizedStep`s have no `label`).
    """
    if label is None:
        return _label(text)
    stripped = label.strip()
    tokens = _LABEL_TOKEN_RE.findall(stripped)
    if not (1 <= len(tokens) <= 4):
        return _label(text)
    if tokens[0].lower() in _LABEL_OPENING_MARKERS:
        return _label(text)
    if tokens[-1].lower() in _LABEL_TRAILING_TRIM_WORDS:
        return _label(text)
    return stripped[:1].upper() + stripped[1:]


_UNTIL_PREFIX_RE = re.compile(r"^(?:until|till)\s+", re.IGNORECASE)


def _clean_cue(cue: str | None) -> str | None:
    """Strip a leading "until"/"till" so cue text is the bare condition (A3).

    The prompt's own examples ("until golden") teach the model to include it, but
    every golden fixture's `doneness_cue` is stored *without* it -- the UI convention
    (`StageCard.tsx`, `WaitWindowBlock`) is "cue = the condition", prepending "until"
    itself. One strip point here keeps golden data and UI unchanged.
    """
    if cue is None:
        return None
    stripped = _UNTIL_PREFIX_RE.sub("", cue.strip())
    return stripped or None


_QTY_VULGAR_FRACTIONS = {
    "¼": 0.25, "½": 0.5, "¾": 0.75,
    "⅓": 1 / 3, "⅔": 2 / 3,
    "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
    "⅙": 1 / 6, "⅚": 5 / 6,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
}
_QTY_MIXED_FRACTION_RE = re.compile(r"^(\d+)\s*[-\s]\s*(\d+)\s*/\s*(\d+)$")
_QTY_PLAIN_FRACTION_RE = re.compile(r"^(\d+)\s*/\s*(\d+)$")
_QTY_DECIMAL_RE = re.compile(r"^\d+(?:\.\d+)?$")
_QTY_VULGAR_RE = re.compile(rf"^(\d+)?\s*([{''.join(_QTY_VULGAR_FRACTIONS)}])$")
_RANGE_DASHES = chr(0x2013) + chr(0x2014)  # en dash, em dash -- ASCII-safe in source (RUF001)
_QTY_RANGE_RE = re.compile(rf"^(\d+(?:\.\d+)?)\s*(?:-|[{_RANGE_DASHES}]|to)\s*(\d+(?:\.\d+)?)$")


def _parse_qty(qty: str | None) -> float | None:
    """Parse a source quantity to a single number, conservatively (A2).

    Mixed fractions ("1 1/4", "1-1/4") and unicode vulgar fractions ("½", "1½") parse
    exactly. Ranges ("2-3", "2 to 3", or an en/em-dash range) resolve to their **low
    end** -- the range text itself is never lost, since `Ingredient.qty_text` carries
    it verbatim. Vague phrases ("a pinch", "a little less than 2") return `None`; they
    too survive via `qty_text`. Never invents a number the source didn't give.
    """
    if qty is None:
        return None
    text = qty.strip()
    if not text:
        return None

    match = _QTY_MIXED_FRACTION_RE.match(text)
    if match:
        whole, numerator, denominator = (int(group) for group in match.groups())
        return whole + numerator / denominator if denominator else None

    match = _QTY_VULGAR_RE.match(text)
    if match:
        whole_text, frac_char = match.groups()
        whole = int(whole_text) if whole_text else 0
        return whole + _QTY_VULGAR_FRACTIONS[frac_char]

    match = _QTY_PLAIN_FRACTION_RE.match(text)
    if match:
        numerator, denominator = int(match.group(1)), int(match.group(2))
        return numerator / denominator if denominator else None

    if _QTY_DECIMAL_RE.match(text):
        return float(text)

    match = _QTY_RANGE_RE.match(text)
    if match:
        return float(match.group(1))  # low end -- conservative, never invents

    return None


def _verification_corpus(raw_text: str) -> str:
    return raw_text.lower()


def _is_grounded_substring(cue: str | None, corpus: str) -> bool:
    if not cue or not cue.strip():
        return False
    return cue.strip().lower() in corpus


def _verify_attention(step: NormalizedStep, corpus: str) -> tuple[Attention, ProvenanceSource]:
    """LOCKED DECISION 4.

    hands_on is trusted directly; a non-hands_on claim must carry a cue that's
    actually present in the source text, or it's forced back.
    """
    if step.attention == "hands_on":
        return "hands_on", "extracted"
    if _is_grounded_substring(step.attention_cue, corpus):
        return step.attention, "extracted"
    return "hands_on", "defaulted"


def _verify_freshness(
    step: NormalizedStep, corpus: str
) -> tuple[Freshness, str | None, int | None]:
    """LOCKED DECISION 5.

    Never invent a numeric max_lead_min; never trust stated_unbounded/stated_numeric
    without a genuine, grounded immediacy marker.
    """
    if step.freshness == "none":
        return "none", None, None
    cue = step.freshness_cue or ""
    has_marker = any(marker in cue.lower() for marker in _IMMEDIACY_MARKERS)
    grounded = has_marker and _is_grounded_substring(cue, corpus)
    if not grounded:
        return "none", None, None
    if step.freshness == "stated_numeric" and step.max_lead_min is not None:
        return "stated_numeric", cue, step.max_lead_min
    return "stated_unbounded", cue, None


SERVINGS_DEFAULTED_WARNING = "Servings not stated in the source; defaulted to 4."
"""P1 #5 §R4 hardening: one exported constant, pinned by a pytest here and asserted
against verbatim by a Vitest on `lib/servings.ts`'s own copy — a saved recipe's
`import_meta.warnings` is the only way a legacy (pre-`servings_stated`) import's
default is detectable without a migration (§R5), so this exact string is load-bearing
on both sides and must never drift silently."""

_YIELD_NUMBER_RE = re.compile(r"\d+")
_YIELD_PEOPLE_WORDS = ("serves", "servings", "people", "persons", "portions")
"""§R4 PC5 guard: naming one of these is what makes a yield count a people count."""


def _yield_first_number(yield_text: str) -> str | None:
    match = _YIELD_NUMBER_RE.search(yield_text)
    return match.group() if match else None


def _verify_yield(yield_text: str | None, corpus: str) -> str | None:
    """§R4: keep `yield_text` only if a number in it also appears in the source text.

    Never invents a number-free description either — a yield with no digit at all
    ("Makes a dozen") is dropped, not guessed at (documented limitation,
    COOKING_GRAPH.md).
    """
    if not yield_text or not yield_text.strip():
        return None
    number = _yield_first_number(yield_text)
    if number is None or number not in corpus:
        return None
    return yield_text.strip()


def _yield_names_people(yield_text: str) -> bool:
    lowered = yield_text.lower()
    return any(word in lowered for word in _YIELD_PEOPLE_WORDS)


_TRANSCRIPT_MARKER_RE = re.compile(r"transcript \([^)]*\):", re.IGNORECASE)

_HINDI_NUMBER_WORDS = {
    1: ("एक", "ek"),
    2: ("दो", "do"),
    3: ("तीन", "teen", "tin"),
    4: ("चार", "chaar", "char"),
    5: ("पांच", "पाँच", "paanch", "panch"),
    6: ("छह", "छः", "chhah", "chhe"),
    7: ("सात", "saat", "sat"),
    8: ("आठ", "aath", "ath"),
    9: ("नौ", "nau"),
    10: ("दस", "das"),
    11: ("ग्यारह", "gyarah"),
    12: ("बारह", "barah"),
}
"""1-12, Devanagari plus the most common romanized spelling(s) -- for `_verify_servings`
only, same narrow purpose as `_NUMBER_WORDS`, not a general transliteration table.
Checkpoint fix: replaces a blanket "the source looks non-English, so accept anything"
bypass, which accepted an unstated OR contradicted claim just as readily as a genuinely
grounded one. Deliberately small and un-fuzzy -- exactly the forms actually observed
in this codebase's fixtures, not every possible spelling. Known limitation: a short
romanized form ("char", "do", "das") is matched as a plain substring, same as the
English words above, so it can accidentally match inside an unrelated English word
("character", "dosa", "date") -- a false accept, not a false reject, and one this
narrow table doesn't try to solve without adding word-boundary/fuzzy machinery."""


def _non_transcript_corpus(corpus: str) -> str:
    """The corpus up to (not including) the transcript section, if any.

    `normalize.render_source_text` always precedes a transcript with a literal
    "Transcript (kind, lang):" label, so this reliably isolates the structured
    metadata (title, channel, blog JSON-LD, description) from a spoken/captioned
    transcript, which is not reliable digit-grounding text (its own digit, if any,
    could coincidentally match a stated duration or an ingredient count instead of
    the servings claim).
    """
    match = _TRANSCRIPT_MARKER_RE.search(corpus)
    return corpus[: match.start()] if match else corpus


def _verify_servings(claimed_servings: int, corpus: str) -> bool:
    """Independent grounding for a bare `servings` claim (checkpoint fix).

    `servings` previously had no grounding of its own at all — trusted verbatim,
    the one field in this file without the never-trust-the-claim discipline
    `attention_cue`/`freshness_cue`/`role_cue` all get elsewhere. Grounded when:

    - the digit appears in the source excluding the transcript
      (`_non_transcript_corpus`), or
    - an English or Hindi number word for it ("four", "चार", "chaar") appears
      anywhere, transcript included.

    A claim backed by none of these is not grounded — including a source that's
    silent on servings entirely, AND a source that only ever states a *different*
    number: neither ever contains evidence for the claimed number specifically, so
    both come out the same way here (not stated) without this function ever
    comparing the claim against a second, contradicting number as such. Pizza,
    rasgulla and "Makes a dozen" (§R4/PC5) are unaffected: none of those servings
    claims are ever silent like this.
    """
    if str(claimed_servings) in _non_transcript_corpus(corpus):
        return True
    words = (
        _NUMBER_WORDS_REVERSE.get(claimed_servings),
        *_HINDI_NUMBER_WORDS.get(claimed_servings, ()),
    )
    return any(word is not None and word in corpus for word in words)


def _resolve_servings(
    claimed_servings: int | None, verified_yield_text: str | None, corpus: str
) -> tuple[int, bool]:
    """A claimed `servings` becomes stated only if independently grounded, then §R4's PC5 guard.

    `_verify_servings` first: an ungrounded claim (nothing backing it anywhere in
    the source) is treated as not stated at all. Then PC5: discard a "stated"
    servings claim that's really just an echoed yield count — the same number as
    `yield_text`'s own, with `yield_text` naming no people word. Returns
    `(servings, servings_stated)`; `servings` defaults to 4 whenever
    `servings_stated` comes back False, exactly like the pre-P1-5 default (never
    invented — 4 is the existing fallback, not a new guess).
    """
    stated = claimed_servings is not None and _verify_servings(claimed_servings, corpus)
    if stated and verified_yield_text is not None:
        yield_number = _yield_first_number(verified_yield_text)
        if (
            yield_number is not None
            and claimed_servings is not None
            and str(claimed_servings) == yield_number
            and not _yield_names_people(verified_yield_text)
        ):
            stated = False
    if not stated or claimed_servings is None:
        return 4, False
    return claimed_servings, True


@dataclass(frozen=True)
class _Roles:
    """The role pass's result, in original step positions."""

    required: list[int]
    """Positions of the steps that become nodes, ascending. Never empty."""
    attach: dict[int, int]
    """Honored optional/alternative position -> the required position it annotates."""


_CUE_TOKEN_RE = re.compile(r"\w+")
_OWN_CUE_MIN_TOKENS = 3
_OWN_CUE_COVERAGE = 0.8


def _role_honored(step: NormalizedStep, corpus: str) -> bool:
    cue = step.role_cue or ""
    has_marker = any(marker in cue.lower() for marker in _OPTIONAL_MARKERS)
    return has_marker and _is_grounded_substring(cue, corpus)


def _cue_is_own(step: NormalizedStep) -> bool:
    """Whether `step.role_cue` is grounded in `step`'s own text.

    Not just somewhere in the corpus (§6 item 2b, the owner's borrowed-cue
    addendum). An exact substring, or (FGC-4) a cue of at least `_OWN_CUE_MIN_TOKENS`
    word tokens whose tokens the step's text covers by `_OWN_CUE_COVERAGE`: the model
    lightly rewrites a quoted cue ("There is" -> "There are"), which an exact match
    would call borrowed.
    """
    text = step.text.lower()
    if _is_grounded_substring(step.role_cue, text):
        return True
    tokens = _CUE_TOKEN_RE.findall((step.role_cue or "").lower())
    if len(tokens) < _OWN_CUE_MIN_TOKENS:
        return False
    text_tokens = set(_CUE_TOKEN_RE.findall(text))
    return sum(token in text_tokens for token in tokens) / len(tokens) >= _OWN_CUE_COVERAGE


def _borrowed_cue_honored(
    step: NormalizedStep, index: int, steps: list[NormalizedStep], honored: set[int]
) -> bool:
    """§6 item 2b: whether a `role_cue` borrowed from elsewhere is still honored.

    A cue not found in the step's own text may only demote THIS step if it is
    chained to the specific optional/alternative parent that cue actually belongs
    to -- never any other unrelated optional wording in the source. All three
    must hold:

    - `attach_to_step` is a valid, EARLIER index (steps are resolved in index
      order, so the parent must already be decided);
    - that target was already honored (so it is itself non-required); and
    - the cue is grounded in the TARGET's own text, not just the corpus.

    `_role_honored`'s marker-and-corpus check is unchanged and still runs first;
    this is a narrower, additional condition for the specific case where the cue
    doesn't come from the step's own words.
    """
    target = step.attach_to_step
    if target is None or not (0 <= target < index):
        return False
    if target not in honored:
        return False
    return _is_grounded_substring(step.role_cue, steps[target].text.lower())


_BACKSTOP_MARKER_RE = re.compile(
    r"^(?:if you\b|optional\b|alternatively\b|(?:\w+\s+){1,3}method:)",
    re.IGNORECASE,
)
"""§6 item 2: the same marker families as `_OPTIONAL_MARKERS`, but matched only at
the very START of a step's text -- a much narrower, purely textual check used to
flag (never demote) a required step that reads as optional/conditional/alternative."""


def _opens_with_optional_wording(text: str) -> bool:
    return bool(_BACKSTOP_MARKER_RE.match(text.strip()))


def _resolve_roles(
    steps: list[NormalizedStep], corpus: str, warnings: list[str]
) -> tuple[_Roles, bool]:
    """CP2 decision B: which steps are mandatory work, and where the rest attach.

    A non-required role is honored only with a grounded, marker-bearing `role_cue`;
    otherwise the step stays required (never silently dropped). When that cue isn't
    in the step's own text, it is "borrowed" from elsewhere in the recipe, and is
    honored only when it chains to the specific already-honored parent it belongs to
    (§6 item 2b) -- an unrelated optional cue elsewhere must never demote a step on
    its own. If nothing would be left required, every step is kept required -- the
    app must never build an empty graph.

    §6 item 2 backstop: a step the model marked `required` outright is never
    demoted based on its wording -- but if its text itself opens with an optional
    marker ("If you", "Optional", "Alternatively", "<word(s)> method:"), that's
    flagged for human review anyway. A required conditional-doneness instruction
    ("If you see bubbles, flip") still stays required and still gets the warning --
    the warning is a review nudge, never a demotion signal.

    Returns the roles and whether a human review is recommended.
    """
    review = False
    honored: set[int] = set()
    for index, step in enumerate(steps):
        if step.role == "required":
            if _opens_with_optional_wording(step.text):
                warnings.append(
                    f'Step "{step.text[:60]}..." is marked required, but its wording '
                    "opens like an optional or alternative instruction; kept required "
                    "-- flagged for review, never demoted automatically."
                )
                review = True
            continue
        if not _role_honored(step, corpus):
            warnings.append(
                f'Step "{step.text[:60]}..." was marked {step.role}, but its cue '
                f'"{step.role_cue}" is not a grounded optional/alternative phrase; '
                "kept as a required step."
            )
            review = True
            continue
        if _cue_is_own(step) or _borrowed_cue_honored(step, index, steps, honored):
            honored.add(index)
        else:
            warnings.append(
                f'Step "{step.text[:60]}..." was marked {step.role}, but its cue '
                f'"{step.role_cue}" is borrowed from elsewhere in the recipe and does '
                "not chain to that instruction via attach_to_step; kept as a "
                "required step."
            )
            review = True

    if len(honored) == len(steps):
        warnings.append(
            "Every step was marked optional or alternative; kept them all as required steps."
        )
        honored = set()

    required = [index for index in range(len(steps)) if index not in honored]
    required_set = set(required)
    attach: dict[int, int] = {}
    for index in sorted(honored):
        target = steps[index].attach_to_step
        visited = {index}
        resolved: int | None = None
        while target is not None and 0 <= target < len(steps) and target not in visited:
            if target in required_set:
                resolved = target
                break
            visited.add(target)
            target = steps[target].attach_to_step
        if resolved is None:
            preceding = [r for r in required if r < index]
            resolved = preceding[-1] if preceding else next(r for r in required if r > index)
            warnings.append(
                f'Optional step "{steps[index].text[:60]}..." did not name a valid step '
                "to attach to; attached to the nearest step instead."
            )
        attach[index] = resolved
    return _Roles(required=required, attach=attach), review


def _role_note(step: NormalizedStep) -> str:
    prefix = _ROLE_TIP_PREFIX.get(step.role, "Optional: ")
    text = step.text.strip()
    if text.lower().startswith(prefix.strip().lower()):
        return text
    return f"{prefix}{text}"


def _infer_kind(text: str, attention: Attention) -> NodeKind:
    lowered = text.lower()
    if attention == "unattended":
        if any(verb in lowered for verb in _UNATTENDED_PASSIVE_VERBS):
            return "passive"
        return "prep"
    if any(verb in lowered for verb in _PREP_VERBS):
        return "prep"
    if any(verb in lowered for verb in _COMBINE_VERBS):
        return "combine"
    return "active"


_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
}
"""Transcripts say "five minutes" as often as "5 minutes" (§4)."""

_NUMBER_WORDS_REVERSE = {v: k for k, v in _NUMBER_WORDS.items()}
"""int -> the English word a transcript might spell it as ("four" for 4) -- for
`_verify_servings`'s grounding check, reusing this word list rather than a second
one."""

_VULGAR_FRACTION_MINUTES = {"¼": 0.25, "½": 0.5, "¾": 0.75}

_DURATION_UNIT_SECONDS = ("sec", "secs", "second", "seconds", "सेकंड")
_DURATION_UNIT_MINUTES = ("min", "mins", "minute", "minutes", "मिनट")
_DURATION_UNIT_HOURS = ("hr", "hrs", "hour", "hours", "घंटा", "घंटे", "ghanta", "ghante")

_OFFSET_PRECEDING_MARKERS = ("after", "in", "within", "every", "at")
_OFFSET_HEDGES = (
    "about", "around", "approximately", "approx.", "approx", "roughly", "nearly",
    "another", "a further", "some",
)
_OFFSET_FOLLOWING_MARKERS = ("later", "after", "into", "baad", "बाद")
_LEAD_TIME_MARKERS = ("before", "pehle", "पहले")
"""An offset says WHEN a step starts ("after 1 hour", "5 minutes later", "1 घंटे बाद"),
never how long it takes, so it is dropped and must not ground a stated duration. A
"N before" phrase is a lead time: the wait itself on an unattended/periodic step, an
offset on a hands-on one."""

_CEILING_PHRASES = ("up to", "at most", "no more than")
"""§4: a ceiling on how long something may sit, never a step's own duration."""

_PER_SIDE_MARKERS = ("per side", "each side", "a side")
_PER_UNIT_MARKERS = ("per batch", "each batch", "per piece", "in batches")
"""§4: per-unit qualifiers. A per-*side* number is doubled (both sides); the other
per-unit phrasings only floor the estimate at the single-unit number -- there's no
batch/piece count to multiply by, so prompt v4 rule (b) is what actually fixes the
number. This is a safety net, not the correction."""

_DURATION_NUMBER_RE = r"(?:\d+(?:\.\d+)?|[¼½¾]|" + "|".join(_NUMBER_WORDS) + ")"
_DURATION_UNIT_RE = "|".join(
    _DURATION_UNIT_SECONDS + _DURATION_UNIT_MINUTES + _DURATION_UNIT_HOURS
)
_DURATION_CEILING_RE = "|".join(_CEILING_PHRASES)
_HEDGE_RE = r"(?:(?:" + "|".join(re.escape(h) for h in _OFFSET_HEDGES) + r")\s+)?"
_OFFSET_BEFORE_RE = re.compile(
    r"(?<!\w)(?:"
    # "after|once" + up to 3 words with no clause punctuation: "after soaking for 1 hour".
    r"(?:after|once)\s+(?:[^\s,.;:!?()]+\s+){0,3}"
    # "in|within|every|at" [hedge] N.
    r"|(?:" + "|".join(_OFFSET_PRECEDING_MARKERS) + r")\s+" + _HEDGE_RE
    + r")$",
    re.IGNORECASE,
)
_FOR_BEFORE_RE = re.compile(r"(?<!\w)for\s+" + _HEDGE_RE + r"$", re.IGNORECASE)
_OFFSET_AFTER_RE = re.compile(
    r"\s*(?:" + "|".join(_OFFSET_FOLLOWING_MARKERS) + r")(?!\w)", re.IGNORECASE
)
_LEAD_AFTER_RE = re.compile(
    r"\s*(?:" + "|".join(_LEAD_TIME_MARKERS) + r")(?!\w)", re.IGNORECASE
)
_DURATION_EXPR_RE = re.compile(
    rf"(?:(?P<ceiling>{_DURATION_CEILING_RE})\s+)?"
    rf"(?P<a>{_DURATION_NUMBER_RE})"
    rf"(?:\s*(?:-|[{_RANGE_DASHES}]|to|से)\s*(?P<b>{_DURATION_NUMBER_RE}))?"
    rf"\s*(?P<unit>{_DURATION_UNIT_RE})(?!\w)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class _DurationExpr:
    """One duration-shaped phrase found in a step's own text (§4), in minutes."""

    low_min: float
    high_min: float
    ceiling: bool
    """"Up to N" / "at most N" / "no more than N": a holding limit, never a typical
    duration and never grounds a stated claim on its own."""
    lead: bool = False
    """"N before" / "N pehle": a lead time. A duration only on a verified
    unattended/periodic step; see `_verify_duration`."""
    serving_anchored: bool = False
    """A `lead` whose anchor is serving ("10 minutes before serving", "परोसने से 10 मिनट
    पहले"). The only lead a hands-on step turns into a derived wait; see
    `_serving_wait_expr`."""


_SERVING_AFTER_RE = re.compile(r"\s*before\s+(?:serving|you\s+serve|eating)(?!\w)", re.IGNORECASE)
_SERVING_BEFORE_RE = re.compile(r"(?:परोसने\s+से|serve\s+karne\s+se)\s*$", re.IGNORECASE)
"""FGC-5: the closed list of serving anchors. English follows the number ("N min before
serving"); Hindi/Hinglish precede it ("परोसने से N मिनट पहले"). Anything else ("before the
end", "before baking") is not anchored and stays a dropped offset."""


def _is_serving_anchored(text: str, match: re.Match[str]) -> bool:
    return bool(
        _SERVING_AFTER_RE.match(text, match.end())
        or _SERVING_BEFORE_RE.search(text[: match.start()])
    )


def _duration_number(token: str) -> float:
    if token in _VULGAR_FRACTION_MINUTES:
        return _VULGAR_FRACTION_MINUTES[token]
    lowered = token.lower()
    if lowered in _NUMBER_WORDS:
        return float(_NUMBER_WORDS[lowered])
    return float(token)


def _duration_unit_factor(unit: str) -> float:
    lowered = unit.lower()
    if lowered in _DURATION_UNIT_SECONDS:
        return 1 / 60
    if lowered in _DURATION_UNIT_HOURS:
        return 60.0
    return 1.0


def _duration_role(text: str, match: re.Match[str]) -> str:
    """Whether a duration-shaped match is a "duration", a "lead" time or an "offset".

    Checked in order: preceding offset words, `for N` framing, following offset
    word, following lead-time word. Ambiguous cases fall on the safe side (offset).
    """
    before = text[: match.start()]
    if _OFFSET_BEFORE_RE.search(before):
        return "offset"
    if _FOR_BEFORE_RE.search(before):
        return "duration"
    if _OFFSET_AFTER_RE.match(text, match.end()):
        return "offset"
    if _LEAD_AFTER_RE.match(text, match.end()):
        return "lead"
    return "duration"


def _has_offset_phrase(text: str) -> bool:
    """Whether `text` has a duration-shaped phrase that is a start offset."""
    return any(
        _duration_role(text, match) == "offset" for match in _DURATION_EXPR_RE.finditer(text)
    )


def _duration_expressions(text: str) -> list[_DurationExpr]:
    """Parse duration-shaped phrases out of `text` (§4).

    Pure and ungrounded -- callers cross-check each match's own substring against
    the corpus, the same independent-verification pattern as every other cue in
    this module. Start offsets ("after 1 hour") are never returned; lead times
    ("1 hour before") are returned flagged `lead`.
    """
    exprs: list[_DurationExpr] = []
    for match in _DURATION_EXPR_RE.finditer(text):
        role = _duration_role(text, match)
        if role == "offset":
            continue
        factor = _duration_unit_factor(match.group("unit"))
        a = _duration_number(match.group("a")) * factor
        b_token = match.group("b")
        b = _duration_number(b_token) * factor if b_token else a
        low, high = (a, b) if a <= b else (b, a)
        ceiling = bool(match.group("ceiling"))
        exprs.append(
            _DurationExpr(
                low_min=low,
                high_min=high,
                ceiling=ceiling,
                lead=role == "lead",
                serving_anchored=role == "lead" and _is_serving_anchored(text, match),
            )
        )
    return exprs


def _serving_wait_expr(text: str, corpus: str) -> _DurationExpr | None:
    """FGC-5: the serving-anchored lead in a hands-on step's text, if the source says it.

    A hands-on step's lead is dropped as a duration (it says when to start, not how
    long the step takes), which silently lost "10 minutes before serving". The number
    is the source's own, so it is kept as a derived wait, but only when the step's
    phrase AND a source phrase are both serving-anchored and the source's interval
    contains the step's (the model rewrote the digits as a word and must not be able
    to invent the lead). Several: the longest wait binds.
    """
    source = [
        expr
        for expr in _duration_expressions(corpus)
        if expr.serving_anchored and not expr.ceiling
    ]
    grounded = [
        expr
        for expr in _duration_expressions(text)
        if expr.serving_anchored
        and not expr.ceiling
        and any(s.low_min <= expr.low_min and expr.high_min <= s.high_min for s in source)
    ]
    return max(grounded, key=lambda expr: expr.low_min, default=None)


def _grounded_duration_expressions(
    text: str, corpus: str, allow_lead: bool = False
) -> list[_DurationExpr]:
    """`_duration_expressions`, keeping only candidates grounded in the raw corpus.

    Grounded by PARSED VALUE, not literal substring: the corpus is parsed with the
    same function, so an equivalent spelling ("30mins" vs "30 minutes") already
    parses identically and needs no separate normalization. A candidate is
    grounded when the corpus contains a duration-shaped phrase whose interval
    CONTAINS the candidate's -- a single value grounds against a containing
    corpus range ("cook for 9 minutes" against "cook for 8-10 minutes"), and a
    range only grounds against an at-least-as-wide one. Ceiling-ness must match
    on both sides: a plain claim is never grounded by a corpus "up to N" (a
    holding limit, never a stated duration -- see the ceiling rule below), and a
    ceiling claim is never grounded by a corpus plain value/range. Lead-time-ness
    must match too (a corpus "1 hour before" grounds only a step's lead phrase), and
    the step's lead phrases are candidates only when `allow_lead`.
    """
    candidates = [
        expr for expr in _duration_expressions(text) if allow_lead or not expr.lead
    ]
    corpus_exprs = _duration_expressions(corpus)
    return [
        candidate
        for candidate in candidates
        if any(
            corpus_expr.ceiling == candidate.ceiling
            and corpus_expr.lead == candidate.lead
            and corpus_expr.low_min <= candidate.low_min
            and candidate.high_min <= corpus_expr.high_min
            for corpus_expr in corpus_exprs
        )
    ]


def _format_duration(expr: _DurationExpr) -> str:
    if expr.low_min == expr.high_min:
        return f"{expr.low_min:g} min"
    return f"{expr.low_min:g}-{expr.high_min:g} min"


def _per_unit_floor_multiplier(text: str) -> float | None:
    lowered = text.lower()
    if any(marker in lowered for marker in _PER_SIDE_MARKERS):
        return 2.0
    if any(marker in lowered for marker in _PER_UNIT_MARKERS):
        return 1.0
    return None


def _verify_duration(
    step: NormalizedStep, corpus: str, attention: Attention = "hands_on"
) -> tuple[float | None, float | None, float | None, bool, list[str], bool]:
    """§4: independently verify a step's duration claim against its own text.

    Returns `(min, typical, max, stated, warnings, review)`. `stated` is the
    VERIFIED stated-ness that `_resolve_duration`'s window-host clamp must act on
    next -- not necessarily what the model claimed. A `None` number means "no
    opinion"; the caller (feeding this into `_resolve_duration`) falls back to the
    model's own number, or the deterministic default when none exists at all.
    """
    warnings: list[str] = []
    review = False
    text = step.text

    grounded = _grounded_duration_expressions(
        text, corpus, allow_lead=attention in ("unattended", "periodic")
    )
    plain = [expr for expr in grounded if not expr.ceiling]
    ceilings = [expr for expr in grounded if expr.ceiling]

    dmin, dtyp, dmax, stated = (
        step.duration_min,
        step.duration_typical_min,
        step.duration_max,
        step.duration_stated,
    )

    if len(plain) == 1:
        expr = plain[0]
        new_typical = (
            min(max(dtyp, expr.low_min), expr.high_min) if dtyp is not None else expr.low_min
        )
        if new_typical != dtyp:
            warnings.append(
                f'Step "{text[:60]}..." states {_format_duration(expr)}; typical '
                f"duration corrected to {new_typical:g} min to match the text."
            )
        dtyp = new_typical
        if _per_unit_floor_multiplier(text) is None:
            # The stated floor: a time the source gives is the least this step takes, so the
            # minimum is raised to its low end (capped at the typical) and never left below it
            # -- "1 hour" cannot come back as min 55. The max keeps its headroom, which the
            # scheduler reads as the worst case, so widening upward is the conservative side.
            floor = expr.low_min if dmin is None else max(dmin, expr.low_min)
            dmin = min(floor, dtyp)
        else:
            dmin = min(dmin, expr.low_min) if dmin is not None else expr.low_min
        dmax = max(dmax, expr.high_min) if dmax is not None else expr.high_min
        stated = True
    elif not plain and stated and not ceilings:
        usable = [
            expr
            for expr in _duration_expressions(text)
            if not expr.lead or attention in ("unattended", "periodic")
        ]
        if usable:
            reason = "but that duration was not found in the source text"
        elif _has_offset_phrase(text) or _duration_expressions(text):
            reason = "but its only time phrase says when to start it, not how long it takes"
        else:
            reason = "but no duration phrase was found in its own text"
        warnings.append(
            f'Step "{text[:60]}..." claims a stated duration, {reason}; '
            "treated as an estimate, not a stated fact."
        )
        stated = False
    elif not plain and stated and ceilings:
        # A ceiling phrase alone can't ground a "stated" claim either (§4): it's a
        # holding limit, not how long the step itself takes.
        warnings.append(
            f'Step "{text[:60]}..." claims a stated duration, but its text only '
            'gives a holding limit ("up to"), not a duration; treated as an estimate.'
        )
        stated = False
    elif len(plain) > 1 and dtyp is not None and not any(
        expr.low_min <= dtyp <= expr.high_min for expr in plain
    ):
        warnings.append(
            f'Step "{text[:60]}..." names more than one duration; the typical '
            "duration matches none of them, so it was left unchanged."
        )

    for ceiling in ceilings:
        if dmax is not None and dmax > ceiling.high_min:
            dmax = ceiling.high_min
            if dtyp is not None and dtyp > dmax:
                dtyp = dmax
            review = True

    multiplier = _per_unit_floor_multiplier(text)
    if multiplier is not None and plain:
        base = min(expr.low_min for expr in plain)
        floor = base * multiplier
        if dtyp is None or dtyp < floor:
            dtyp = floor
        if dmax is None or dmax < dtyp:
            dmax = dtyp
        stated = False
        review = True
        warnings.append(
            f'Step "{text[:60]}..." gives a per-unit time ({base:g} min); the whole '
            f"step must take at least {floor:g} min across every unit, so the "
            "estimate was raised and flagged for review."
        )

    return dmin, dtyp, dmax, stated, warnings, review


def _resolve_duration(
    step: NormalizedStep, kind: NodeKind, attention: Attention
) -> tuple[int, int, int, ProvenanceSource, bool]:
    """LOCKED DECISION 6. Returns (min, typical, max, source, clamp_fired)."""
    has_values = (
        step.duration_min is not None
        and step.duration_typical_min is not None
        and step.duration_max is not None
    )
    if has_values:
        dmin = float(step.duration_min)  # type: ignore[arg-type]
        dtyp = float(step.duration_typical_min)  # type: ignore[arg-type]
        dmax = float(step.duration_max)  # type: ignore[arg-type]
        source: ProvenanceSource = "extracted" if step.duration_stated else "inferred"
    else:
        dmin, dtyp, dmax = _DEFAULT_DURATION_MIN.get(kind, (5, 8, 12))
        source = "defaulted"

    clamp_fired = False
    is_window_host = attention in ("periodic", "unattended")
    if is_window_host and not step.duration_stated and dtyp != dmin:
        dtyp = dmin
        clamp_fired = True

    # Defensive, deterministic ordering/positivity clamp — invariant 7 must hold
    # regardless of what the model returned.
    dmin_i = max(round(dmin), 1)
    dtyp_i = max(round(dtyp), dmin_i)
    dmax_i = max(round(dmax), dtyp_i)
    return dmin_i, dtyp_i, dmax_i, source, clamp_fired


_STAPLES = frozenset({"salt", "water", "oil"})
"""CP2 decision E: pantry staples two steps can both draw on without one needing the
other's output. Deliberately closed and narrow. Matched per whole word token, so "Sea
salt" and "olive oil" count (and, accepted tradeoff, so do "chilli oil" and "water
chestnut"); "Saltine" does not."""

_STAPLE_TOKEN_RE = re.compile(r"[a-z]+")


def _is_staple(name: str, produced_labels: frozenset[str]) -> bool:
    """Whether a consumed name is a pantry staple for the independence check.

    A name that is exactly some step's `produces_component` label is never a staple,
    whatever its words: it is that step's output, not a pantry item.
    """
    lowered = name.lower()
    if lowered in produced_labels:
        return False
    return any(token in _STAPLES for token in _STAPLE_TOKEN_RE.findall(lowered))


def _produced_labels(steps: list[NormalizedStep]) -> frozenset[str]:
    return frozenset(
        step.produces_component.lower()
        for step in steps
        if step.produces_component and step.produces_component.strip()
    )


def _name_candidates(name: str, name_to_ids: dict[str, list[str]]) -> list[str] | None:
    """Ingredient ids a step's ingredient `name` may refer to, or None if it matches none.

    Exact lowercase name first, else the first known name that contains or is contained
    in it (the soft fallback `build_graph` has always used).
    """
    lowered = name.lower()
    matched = name_to_ids.get(lowered)
    if matched is None:
        for known_name, known_ids in name_to_ids.items():
            if lowered in known_name or known_name in lowered:
                return known_ids
    return matched


def _resolve_step_ingredient_ids(
    step_names: list[list[str]],
    name_to_ids: dict[str, list[str]],
    group_of: dict[str, str | None],
) -> list[list[str]]:
    """Resolve each step's ingredient names to ids, choosing a portion by home group.

    A name can legitimately repeat across groups (the main list and a "Chutney" group
    both list cumin: two real portions). A step's *home group* is the most common group
    among its names that match exactly one id (ungrouped counts as a group; a tie or no
    such name means ungrouped). An ambiguous name then resolves to the ids in the home
    group, else the ungrouped ids, else all of them.

    No-orphan guard: an id that some step could have meant but that no step resolved to
    is restored to every step that had it as a candidate, so no ingredient is ever left
    unconsumed by this pass. A recipe without cross-group duplicates is returned
    unchanged. Quantities are never combined; only which portion a step uses is decided.

    Args:
        step_names: Per step, the ingredient names it claims to consume.
        name_to_ids: Lowercase ingredient name -> every id with that name, in list order.
        group_of: Ingredient id -> its group (None when ungrouped).

    Returns:
        Per step, the resolved ids in candidate order, de-duplicated.
    """
    candidates: list[list[list[str]]] = []
    resolved: list[list[list[str]]] = []
    for names in step_names:
        per_name = [_name_candidates(name, name_to_ids) or [] for name in names]
        exact_groups = [
            group_of[ids[0]]
            for name in dict.fromkeys(n.lower() for n in names)
            if len(ids := name_to_ids.get(name, [])) == 1
        ]
        home: str | None = None
        counts = Counter(exact_groups).most_common()
        if counts and (len(counts) == 1 or counts[0][1] > counts[1][1]):
            home = counts[0][0]
        step_resolved: list[list[str]] = []
        for ids in per_name:
            if len(ids) <= 1:
                step_resolved.append(list(ids))
                continue
            in_home = [i for i in ids if group_of[i] == home]
            ungrouped = [i for i in ids if group_of[i] is None]
            step_resolved.append(in_home or ungrouped or list(ids))
        candidates.append(per_name)
        resolved.append(step_resolved)

    picked = {i for step in resolved for ids in step for i in ids}
    orphans = {i for step in candidates for ids in step for i in ids} - picked
    out: list[list[str]] = []
    for step_candidates, step_resolved in zip(candidates, resolved, strict=True):
        keep = {i for ids in step_resolved for i in ids}
        ids_in_order: list[str] = []
        for ids in step_candidates:
            ids_in_order.extend(i for i in ids if i in keep or i in orphans)
        out.append(list(dict.fromkeys(ids_in_order)))
    return out


def _identity_keys(
    names: list[str],
    resolved_ids: list[str],
    name_to_ids: dict[str, list[str]],
    name_of: dict[str, str],
) -> dict[str, str]:
    """What a step's ingredients are, for the independence tests: key -> lowercase name.

    A resolved ingredient is keyed by its id, so two portions of the same name (main
    list vs a group) are different ingredients. A name that matches no ingredient (a
    component name) is keyed by the name itself, as it always was.
    """
    keys = {ing_id: name_of[ing_id] for ing_id in resolved_ids}
    for name in names:
        if _name_candidates(name, name_to_ids) is None:
            keys[f"name:{name.lower()}"] = name.lower()
    return keys


def _shared_names(
    a: NormalizedStep,
    b: NormalizedStep,
    a_keys: dict[str, str] | None,
    b_keys: dict[str, str] | None,
) -> set[str]:
    """Lowercase names of the ingredients both steps consume.

    With identity keys, "shared" means the same resolved id (or the same unresolved
    name); without them (a caller that has no ingredient list), the same step name.
    """
    if a_keys is None or b_keys is None:
        return {n.lower() for n in a.consumes_ingredients} & {
            n.lower() for n in b.consumes_ingredients
        }
    return {a_keys[key] for key in a_keys.keys() & b_keys.keys()}


def _shares_ingredient(
    a: NormalizedStep,
    b: NormalizedStep,
    produced_labels: frozenset[str],
    a_keys: dict[str, str] | None = None,
    b_keys: dict[str, str] | None = None,
) -> bool:
    """Whether `a` and `b` name a common ingredient other than a pantry staple."""
    return any(
        not _is_staple(name, produced_labels) for name in _shared_names(a, b, a_keys, b_keys)
    )


def _consumes_others_product(a: NormalizedStep, b: NormalizedStep) -> bool:
    """Whether `a` consumes something `b` produces, or vice versa."""
    a_consumes = {name.lower() for name in a.consumes_ingredients}
    b_consumes = {name.lower() for name in b.consumes_ingredients}
    if b.produces_component and b.produces_component.lower() in a_consumes:
        return True
    return bool(a.produces_component and a.produces_component.lower() in b_consumes)


def _verify_independence(
    previous: NormalizedStep,
    current: NormalizedStep,
    produced_labels: frozenset[str],
    previous_keys: dict[str, str] | None = None,
    current_keys: dict[str, str] | None = None,
) -> bool:
    """LOCKED DECISION 7 / design doc §4.7.

    Both conditions must hold to honor a `depends_on_previous=False` claim: no shared
    ingredient, no produces/consumes link between this step and the immediately
    preceding one. A shared pantry staple (`_STAPLES`) is not a shared ingredient for
    this test (CP2 decision E); a produced component never counts as a staple, and the
    produces/consumes link is never exempt.
    """
    if _shares_ingredient(previous, current, produced_labels, previous_keys, current_keys):
        return False
    return not _consumes_others_product(previous, current)


def _verify_independence_explicit(
    earlier: NormalizedStep,
    current: NormalizedStep,
    produced_labels: frozenset[str],
    earlier_keys: dict[str, str] | None = None,
    current_keys: dict[str, str] | None = None,
) -> bool:
    """§4.7's test, generalized to any earlier step (CP2 decision A).

    Fails on a shared ingredient that is neither a pantry staple nor exactly a
    produced-component label (producer->consumer wiring already orders those), or on
    a produces/consumes link between the two -- which is never exempt.
    """
    if any(
        name not in produced_labels and not _is_staple(name, produced_labels)
        for name in _shared_names(earlier, current, earlier_keys, current_keys)
    ):
        return False
    return not _consumes_others_product(earlier, current)


def _names_component(step: NormalizedStep, label: str) -> bool:
    """Whether `step` consumes the produced `label` (the producer pass's fuzzy match)."""
    produced_name = label.lower()
    return any(
        produced_name in name or name in produced_name
        for name in (name.lower() for name in step.consumes_ingredients)
    )


_HEAT_STATIONS = ("burner", "oven")


def _explicit_dependencies(
    all_steps: list[NormalizedStep],
    roles: _Roles,
    warnings: list[str],
    identity_keys: list[dict[str, str]] | None = None,
) -> tuple[list[list[int]], list[ProvenanceSource], bool]:
    """CP2 decision A: resolve `depends_on_steps` claims over the required steps.

    Every claim is sanitized, extended by producer edges and the descendant closure
    (the continuation of work a claimed step started), then verified pairwise against
    every earlier step it does not reach and guarded against same-heat-station
    reordering. The builder only ever adds edges; it never removes a claimed one.

    Args:
        all_steps: Every step, in source order (original positions).
        roles: The role pass's result; claims are remapped from original positions.
        warnings: Appended to for every dropped index and every guard edge.
        identity_keys: Per required position, the step's ingredient identity (see
            `_identity_keys`); None compares raw step names.

    Returns:
        Per required position: the dependency positions (claimed first, then added
        ones in index order), the provenance source, and whether review is advised.
    """
    required = roles.required
    steps = [all_steps[original] for original in required]
    position_of = {original: position for position, original in enumerate(required)}
    labels = _produced_labels(steps)
    count = len(steps)
    review = False

    def is_boundary(j: int) -> bool:
        # A branch/product boundary: j makes a named product some later step uses.
        # The closure neither includes it nor walks past it.
        label = steps[j].produces_component
        if not label or not label.strip():
            return False
        return any(_names_component(steps[k], label) for k in range(j + 1, count))

    resolved: list[set[int]] = []
    ordered: list[list[int]] = []
    sources: list[ProvenanceSource] = []

    def reach_of(deps: set[int]) -> set[int]:
        reach: set[int] = set()
        stack = list(deps)
        while stack:
            x = stack.pop()
            if x in reach:
                continue
            reach.add(x)
            stack.extend(resolved[x])
        return reach

    for i, step in enumerate(steps):
        original = required[i]
        claim = step.depends_on_steps
        source: ProvenanceSource = "extracted"
        claimed: list[int] = []
        if claim is None:
            if i > 0:
                claimed = [i - 1]
                source = "defaulted"
                review = True
        else:
            for k in claim:
                if k < 0 or k >= len(all_steps) or k >= original:
                    warnings.append(
                        f'Step "{step.text[:60]}..." named step {k} as a dependency, which '
                        "is not an earlier step; ignored."
                    )
                    continue
                if k in position_of:
                    position = position_of[k]
                else:
                    attached = roles.attach[k]
                    if attached >= original:
                        warnings.append(
                            f'Step "{step.text[:60]}..." named an optional note attached '
                            "to a later step as a dependency; ignored."
                        )
                        continue
                    position = position_of[attached]
                if position not in claimed:
                    claimed.append(position)
            if i == 0:
                claimed = []
            elif claim and not claimed:
                claimed = [i - 1]
                source = "defaulted"
                review = True
                warnings.append(
                    f'Step "{step.text[:60]}..." named no usable earlier step; it now '
                    "follows the previous step."
                )

        deps: set[int] = set(claimed)

        def closure(new_deps: list[int], deps: set[int] = deps, i: int = i) -> None:
            queue = list(new_deps)
            seen = set(deps)
            while queue:
                x = queue.pop()
                for j in range(x + 1, i):
                    if j in seen or x not in resolved[j]:
                        continue
                    seen.add(j)
                    if is_boundary(j):
                        continue
                    deps.add(j)
                    queue.append(j)

        # Producer edges: every earlier step whose named product this step consumes.
        for p in range(i):
            label = steps[p].produces_component
            if label and label.strip() and _names_component(step, label):
                deps.add(p)
        closure(list(deps))

        guard_added = False
        while True:
            reach = reach_of(deps)
            new: list[int] = []
            for j in range(i):
                if j in reach or _verify_independence_explicit(
                    steps[j],
                    step,
                    labels,
                    identity_keys[j] if identity_keys else None,
                    identity_keys[i] if identity_keys else None,
                ):
                    continue
                new.append(j)
                reach |= reach_of({j})
                warnings.append(
                    f'Step "{step.text[:60]}..." shares an ingredient or component with '
                    f'earlier step "{steps[j].text[:60]}..."; added that dependency.'
                )
            if step.station in _HEAT_STATIONS:
                same_station = [j for j in range(i) if steps[j].station == step.station]
                if same_station and same_station[-1] not in reach:
                    h = same_station[-1]
                    new.append(h)
                    warnings.append(
                        f'Step "{step.text[:60]}..." uses the same {step.station} as earlier '
                        f'step "{steps[h].text[:60]}..."; added that dependency.'
                    )
            if not new:
                break
            guard_added = True
            deps.update(new)
            closure(new)

        if guard_added:
            review = True
            if source == "extracted":
                source = "inferred"
        resolved.append(deps)
        ordered.append(claimed + sorted(deps - set(claimed)))
        sources.append(source)

    return ordered, sources, review


def _depends_transitively(node: Node, target_id: str, nodes_by_id: dict[str, Node]) -> bool:
    """Whether `node` depends on `target_id`, directly or through other nodes (B3).

    Mirrors `validate._depends_transitively` (kept separate: this runs during
    construction, before a `CookingGraph` exists to hand to that module).
    """
    seen: set[str] = set()
    stack = list(node.depends_on)
    while stack:
        dep = stack.pop()
        if dep == target_id:
            return True
        if dep in seen:
            continue
        seen.add(dep)
        dep_node = nodes_by_id.get(dep)
        if dep_node is not None:
            stack.extend(dep_node.depends_on)
    return False


def _sequential_source(step_text: str) -> ProvenanceSource:
    stripped = step_text.strip().lower()
    first_word = stripped.split(" ", 1)[0].rstrip(",.;:") if stripped else ""
    return "extracted" if first_word in _SEQUENCE_CONNECTIVES else "inferred"


def _stages_for(kinds: list[NodeKind]) -> list[str]:
    """P1 #5 §R3: monotonic stages, with a narrow trailing-finish rule for late garnish.

    `kinds[i]` is the existing per-step derivation (`"finish"` for the last step,
    otherwise `_infer_kind`) — this function only decides which of `prep`/`cook`/`finish`
    each step's `Node.stage` is, never `Node.kind` itself.

    A "cook-anchor" step is a non-last step whose kind isn't `prep` — exactly the steps
    the old `_stage_for` sent to `cook`. Between the first and last anchor, EVERY step
    (prep-kind or not) is `cook`: a prep step that reads as a discrete task but sits
    between two anchors (dal's "scrub the soaked dal" after "soak", the tadka's "add
    chopped garlic" between two pan steps) is cook-adjacent, not a separate prep phase.
    A prep-kind step after the last anchor is a trailing garnish/plating step and is
    `finish`, not `cook` — the one case monotonic-by-anchor alone would misfile.
    """
    total = len(kinds)
    last = total - 1
    anchors = [i for i in range(last) if kinds[i] != "prep"]

    stages: list[str] = []
    for i in range(total):
        if i == last:
            stages.append("finish")
        elif kinds[i] != "prep":
            stages.append("cook")
        elif not anchors or i < anchors[0]:
            stages.append("prep")
        elif i > anchors[-1]:
            stages.append("finish")
        else:
            stages.append("cook")
    return stages


_STAGE_LABELS = {"prep": "Prep", "cook": "Cook", "finish": "Finish"}


_TEMPERATURE_RE = re.compile(
    r"(?P<gas>gas\s*mark\s*(?P<gasn>\d+))"
    r"|(?P<num>\d+(?:\.\d+)?)\s*"
    r"(?:[\u00b0\u00ba]\s*(?P<deg>[CF])?(?![A-Za-z])"
    r"|degrees?(?:\s+(?P<word>celsius|fahrenheit))?(?![A-Za-z])"
    r"|(?P<bare>[CF])(?![A-Za-z])"
    r"|\u0921\u093f\u0917\u094d\u0930\u0940)",
    re.IGNORECASE,
)
"""FGC-3: a temperature in a step's text. A degree sign (with or without C/F), "degrees"
(optionally celsius/fahrenheit), a bare C/F after a number (only from 40, so a "1 c" of a
cup is not one; the source corpus is lower-cased, so the case is not checked), "gas mark N" and
the Hindi word for degrees. Used only to check that an added step does not state a temperature
the source does not."""


def _temperatures(text: str) -> list[tuple[float, str | None]]:
    """Each temperature in `text` as `(value, system)`; system is c, f, gas or None (unstated)."""
    found: list[tuple[float, str | None]] = []
    for match in _TEMPERATURE_RE.finditer(text):
        if match.group("gas"):
            found.append((float(match.group("gasn")), "gas"))
            continue
        value = float(match.group("num"))
        bare = match.group("bare")
        if bare and value < 40:
            continue
        letter = match.group("deg") or bare
        word = (match.group("word") or "").lower()
        system = letter.lower() if letter else ("c" if word == "celsius" else "f" if word else None)
        found.append((value, system))
    return found


def _ungrounded_temperature(text: str, corpus: str) -> bool:
    """Whether `text` states a temperature the source does not: same value, same unit system.

    A temperature whose system is not written ("180 degrees") matches the source's on the
    number alone.
    """
    source = _temperatures(corpus)
    return any(
        not any(
            value == other and (system is None or other_system is None or system == other_system)
            for other, other_system in source
        )
        for value, system in _temperatures(text)
    )


def _time_intervals(text: str) -> list[tuple[float, float]]:
    """Every duration-shaped phrase in `text` as `(low, high)` minutes, offsets and leads too."""
    out: list[tuple[float, float]] = []
    for match in _DURATION_EXPR_RE.finditer(text):
        factor = _duration_unit_factor(match.group("unit"))
        a = _duration_number(match.group("a")) * factor
        b_token = match.group("b")
        b = _duration_number(b_token) * factor if b_token else a
        out.append((min(a, b), max(a, b)))
    return out


def _ungrounded_time(text: str, corpus: str) -> bool:
    """Whether `text` states a time the source does not (an interval it contains nowhere)."""
    source = _time_intervals(corpus)
    return any(
        not any(low <= a and b <= high for low, high in source) for a, b in _time_intervals(text)
    )


def _added_step_problem(
    step: NormalizedStep, corpus: str, listed: dict[str, list[str]], labels: list[str]
) -> str | None:
    """Why an added step must be dropped (FGC-3), or None when it may stay.

    `listed` maps the lower-cased extracted ingredient names (what `_name_candidates` reads);
    `labels` are the products any step names, which a step may consume too.
    """
    if step.role != "required":
        return "it is not a required step"
    for name in step.consumes_ingredients:
        if _name_candidates(name, listed) is None and not any(
            _names_label([name], label) for label in labels
        ):
            return f'it uses "{name}", which the source does not list'
    if _ungrounded_time(step.text, corpus):
        return "it states a time the source does not"
    if _ungrounded_temperature(step.text, corpus):
        return "it states a temperature the source does not"
    return None


def _names_label(consumed: list[str], label: str) -> bool:
    """The producer pass's match: a consumed name contains, or is contained in, `label`."""
    produced = label.lower()
    return any(produced in name.lower() or name.lower() in produced for name in consumed)


def _prepare_added_steps(
    recipe: NormalizedRecipe, corpus: str, warnings: list[str]
) -> tuple[NormalizedRecipe, bool]:
    """FGC-3: apply the added-step guards, dropping what must not reach the plan.

    An added step is dropped when it is not required, it consumes an ingredient the source does not
    list, or its own text states a time or a temperature that the source does not. A kept added
    step's `produces_component` is cleared when no later step uses it. A dropped step's
    ingredients go to the step that needed its product (else the next step), so no ingredient is
    left unused, and every index a later step holds (`depends_on_steps`, `attach_to_step`) is
    remapped; a claim on a dropped step becomes
    the dropped step's own dependencies. A recipe with no added step is returned unchanged.

    Returns the recipe and whether a human review is advised.
    """
    steps = recipe.steps
    if not any(step.origin == "added" for step in steps):
        return recipe, False

    listed = {ing.name.lower(): [ing.name] for ing in recipe.ingredients}
    labels = [s.produces_component for s in steps if s.produces_component]
    drop: set[int] = set()
    for index, step in enumerate(steps):
        if step.origin != "added":
            continue
        problem = _added_step_problem(step, corpus, listed, labels)
        if problem is not None:
            drop.add(index)
            warnings.append(
                f'Dropped the step ABC Cook would have added, "{step.text[:60]}": {problem}.'
            )
    review = bool(drop)

    kept = [index for index in range(len(steps)) if index not in drop]
    new_index = {old: new for new, old in enumerate(kept)}
    updated = {index: steps[index] for index in kept}

    for index in kept:
        step = steps[index]
        label = step.produces_component
        if (
            step.origin == "added"
            and label
            and not any(
                _names_label(steps[later].consumes_ingredients, label)
                for later in kept
                if later > index
            )
        ):
            updated[index] = updated[index].model_copy(update={"produces_component": None})
            warnings.append(
                f'Cleared "{label}" from the added step "{step.text[:60]}": no later step uses it.'
            )

    for index in sorted(drop):
        gone = steps[index]
        label = gone.produces_component
        later = [k for k in kept if k > index]
        heir = next(
            (k for k in later if label and _names_label(steps[k].consumes_ingredients, label)),
            later[0] if later else max(k for k in kept if k < index),
        )
        consumed = [
            name
            for name in updated[heir].consumes_ingredients
            if not (label and _names_label([name], label))
        ]
        have = {name.lower() for name in consumed}
        consumed += [
            name
            for name in gone.consumes_ingredients
            if name.lower() not in have and not (label and name.lower() == label.lower())
        ]
        updated[heir] = updated[heir].model_copy(update={"consumes_ingredients": consumed})

    def bridged(claim: int, seen: frozenset[int] = frozenset()) -> list[int]:
        if claim not in drop:
            return [claim]
        own = steps[claim].depends_on_steps
        if own is None or claim in seen:
            return []
        return [k for dep in own for k in bridged(dep, seen | {claim})]

    def remap(claim: list[int]) -> list[int]:
        out: list[int] = []
        for k in claim:
            for resolved in bridged(k) if 0 <= k < len(steps) else [k]:
                in_range = 0 <= resolved < len(steps)
                mapped = new_index.get(resolved, resolved) if in_range else resolved
                if mapped not in out:
                    out.append(mapped)
        return out

    new_steps: list[NormalizedStep] = []
    for index in kept:
        step = updated[index]
        changes: dict[str, object] = {}
        if step.depends_on_steps is not None:
            changes["depends_on_steps"] = remap(step.depends_on_steps)
        target = step.attach_to_step
        if target is not None:
            changes["attach_to_step"] = (
                new_index.get(target) if 0 <= target < len(steps) and target not in drop else None
            )
        new_steps.append(step.model_copy(update=changes) if changes else step)
    return recipe.model_copy(update={"steps": new_steps}), review


def build_graph(
    recipe: NormalizedRecipe,
    raw_source_text: str,
    *,
    graph_id: str,
    source: SourceRef,
    force_linear: bool = False,
) -> GraphBuildResult:
    """`NormalizedRecipe` -> `CookingGraph`, or a refusal.

    Args:
        recipe: The normalized recipe. Must have `recipe.steps` non-empty — this is
            re-checked here even though `normalize.py`'s Tier 0 gate should already
            guarantee it (§10.C: never rely on a caller remembering the gate).
        raw_source_text: The original acquisition text (description + blog JSON-LD +
            transcript), used to verify `attention_cue`/`freshness_cue` are real
            substrings of the source, not the model's paraphrase.
        graph_id: Stable id for the resulting `CookingGraph`.
        source: Where this recipe came from.
        force_linear: Tier 1 degrade mode (`repair.py`, design doc §4.2 row 1 /
            `COOKING_GRAPH.md` §5 "degrade to a linear chain"). Discards every
            structural claim beyond stated order — independence claims, produces/
            consumes branching, and freshness structural steering — so the result is
            guaranteed to pass invariants 1-4 by construction. Attention, duration,
            and freshness verification are untouched: only graph *structure*
            (parallelism) is discarded, never grounded content. Also guarantees
            invariants 5/6 by dropping (never inventing) an assertion the content
            can't support: an ingredient no step consumes is marked `optional`; a
            node's `produces` is never asserted (nothing downstream is claimed to
            consume it in linear mode). Invariant 8 (`stated_total_min`) is dropped
            the same way regardless of `force_linear` — see below; a marketing total
            ("15 min") next to long verified passive steps must not force an
            otherwise structurally valid graph into this branch (M2.10 s18 F1).
            Invariant 9 is guaranteed too, but not by anything `force_linear` itself
            does: this branch never touches `attention` or `kind`, so a source whose
            final, grounded instruction is genuinely unattended ("let cool slightly
            before serving") still forces `kind="finish"` (line ~454) with
            `attention="unattended"` — invalid before B2, valid after it
            (`COOKING_GRAPH.md` §5.9 allows `finish` in the unattended set). The
            guarantee holds only because that relaxation exists, not because
            `force_linear` does anything special for it. Honored optional/alternative
            steps (CP2 decision B) are notes, not nodes, here too: the chain runs over
            required steps only.

    Returns:
        A `GraphBuildResult`. `.graph` is None only when `recipe.steps` is empty —
        callers must treat that identically to `normalize.py`'s own Tier 0 gate.
    """
    if not recipe.steps:
        return GraphBuildResult(graph=None, warnings=["No steps to build a graph from."])
    if not any(step.origin == "source" for step in recipe.steps):
        # FGC-3: steps the model added are not the source's method (the Tier 0 gate, re-checked).
        return GraphBuildResult(graph=None, warnings=["No steps from the source to build from."])

    corpus = _verification_corpus(raw_source_text)
    warnings: list[str] = []
    recipe, review_recommended = _prepare_added_steps(recipe, corpus, warnings)

    # -- Ingredients --------------------------------------------------------------
    ingredients: list[Ingredient] = []
    seen_ing_ids: set[str] = set()
    name_to_ids: dict[str, list[str]] = {}
    for norm_ing in recipe.ingredients:
        base_id = f"ing_{_slugify(norm_ing.name, max_words=3)}"
        ing_id = base_id
        suffix = 2
        while ing_id in seen_ing_ids:
            ing_id = f"{base_id}_{suffix}"
            suffix += 1
        seen_ing_ids.add(ing_id)
        # A name can legitimately repeat (design doc §10.C, real data: "Garlic
        # chopped" listed once for the base and again under "Tempering"). Keep every
        # id sharing a name, not just the last one written -- a single dict[name, id]
        # made an earlier occurrence permanently unconsumable regardless of what any
        # step claimed, a real bug found running repair.py against a real recipe.
        name_to_ids.setdefault(norm_ing.name.lower(), []).append(ing_id)
        ingredients.append(
            Ingredient(
                id=ing_id,
                name=norm_ing.name,
                qty=_parse_qty(norm_ing.qty),
                qty_text=norm_ing.qty,
                unit=norm_ing.unit,
                prep_note=norm_ing.prep_note,
                group=norm_ing.group,
                optional=False,
            )
        )

    def _ingredient_ids(names: list[str], *, warn: bool = True) -> list[str]:
        ids = []
        for name in names:
            matched = _name_candidates(name, name_to_ids)
            if matched is not None:
                ids.extend(matched)
            elif warn:
                warnings.append(
                    f'Step references ingredient "{name}", not found in the ingredient list.'
                )
        return list(dict.fromkeys(ids))  # de-dupe, preserve order

    # -- Roles (CP2 decision B): optional/alternative steps become notes, not nodes --
    # Runs first, on every path including force_linear: a degraded graph must not turn
    # optional work into mandatory work either. From here on `steps` holds only the
    # required steps, so node ids, positions and the finish sink are all computed over
    # them; a recipe whose steps are all required builds exactly as before.
    roles, roles_review = _resolve_roles(recipe.steps, corpus, warnings)
    review_recommended = review_recommended or roles_review
    steps = [recipe.steps[index] for index in roles.required]
    total = len(steps)

    # -- Nodes ----------------------------------------------------------------------
    node_ids: list[str] = []
    seen_node_ids: set[str] = set()
    for step in steps:
        base_id = f"step_{_slugify(step.text)}"
        node_id = base_id
        suffix = 2
        while node_id in seen_node_ids:
            node_id = f"{base_id}_{suffix}"
            suffix += 1
        seen_node_ids.add(node_id)
        node_ids.append(node_id)

    nodes: list[Node] = []
    decisions: list[NodeDecision] = []
    depends_on_previous_verified: list[bool] = []
    produced_labels = _produced_labels(steps)

    # -- Ingredient ids per step, by home group (D3). The "not found" warnings stay in
    # the node loop below so their order doesn't change.
    group_of = {ing.id: ing.group for ing in ingredients}
    step_ingredient_ids = _resolve_step_ingredient_ids(
        [step.consumes_ingredients for step in steps], name_to_ids, group_of
    )
    name_of = {ing.id: ing.name.lower() for ing in ingredients}
    identity_keys = [
        _identity_keys(step.consumes_ingredients, step_ingredient_ids[index], name_to_ids, name_of)
        for index, step in enumerate(steps)
    ]

    # -- Path selection (CP2 decision A) -------------------------------------------
    # Explicit path: at least one required step states `depends_on_steps` (even
    # `[]`). A `None` claim then means "not provided" and defaults to the previous
    # required step. Legacy path: every claim is `None`; today's `depends_on_previous`
    # fork/join runs unchanged. force_linear ignores every claim.
    explicit = not force_linear and any(step.depends_on_steps is not None for step in steps)
    explicit_deps: list[list[int]] = []
    explicit_sources: list[ProvenanceSource] = []
    if explicit:
        explicit_deps, explicit_sources, explicit_review = _explicit_dependencies(
            recipe.steps, roles, warnings, identity_keys
        )
        review_recommended = review_recommended or explicit_review

    # -- Attention, kind and stage (§R3) -- computed for every step up front, before
    # the main per-node loop below, because the stage rule needs to see every step's
    # kind at once (it looks for the first/last cook-anchor across the whole recipe,
    # not just what came before the current step).
    attentions: list[Attention] = []
    attention_sources: list[ProvenanceSource] = []
    kinds: list[NodeKind] = []
    for index, step in enumerate(steps):
        attention: Attention
        attention_source: ProvenanceSource
        if step.origin == "added":
            # An added step never hosts a wait window or opens parallelism (FGC-3).
            attention, attention_source = "hands_on", "inferred"
        else:
            attention, attention_source = _verify_attention(step, corpus)
        attentions.append(attention)
        attention_sources.append(attention_source)
        kinds.append("finish" if index == total - 1 else _infer_kind(step.text, attention))
    stages_for_steps = _stages_for(kinds)

    for index, step in enumerate(steps):
        attention, attention_source = attentions[index], attention_sources[index]
        kind = kinds[index]

        # §4/§6 item 1: verify the duration claim against the step's own text
        # BEFORE the window-host clamp, so the clamp acts on the verified
        # stated-ness rather than the model's raw self-report.
        duration_warnings: list[str]
        if step.origin == "added":
            # An added step's duration is ABC Cook's estimate, never a stated fact (FGC-3).
            vmin, vtyp, vmax = step.duration_min, step.duration_typical_min, step.duration_max
            vstated, duration_warnings, duration_review = False, [], False
        else:
            vmin, vtyp, vmax, vstated, duration_warnings, duration_review = _verify_duration(
                step, corpus, attention
            )
        warnings.extend(duration_warnings)
        review_recommended = review_recommended or duration_review
        verified_step = step.model_copy(
            update={
                "duration_min": vmin if vmin is not None else step.duration_min,
                "duration_typical_min": vtyp if vtyp is not None else step.duration_typical_min,
                "duration_max": vmax if vmax is not None else step.duration_max,
                "duration_stated": vstated,
            }
        )
        dmin, dtyp, dmax, duration_source, clamp_fired = _resolve_duration(
            verified_step, kind, attention
        )
        freshness, freshness_cue, max_lead_min = (
            ("none", None, None) if step.origin == "added" else _verify_freshness(step, corpus)
        )
        _ingredient_ids(step.consumes_ingredients)  # emits the not-found warnings only

        if explicit:
            sequential = True  # unused: the explicit path wires its own edges below
            dep_source: ProvenanceSource = explicit_sources[index]
        elif index == 0:
            sequential = True
            dep_source = "extracted"
        elif force_linear or step.depends_on_previous:
            sequential = True
            dep_source = _sequential_source(step.text)
        else:
            honored = _verify_independence(
                steps[index - 1],
                step,
                produced_labels,
                identity_keys[index - 1],
                identity_keys[index],
            )
            sequential = not honored
            dep_source = "inferred" if honored else "defaulted"
        depends_on_previous_verified.append(sequential)

        default_interruptible = {"prep": True, "active": False, "finish": False}
        interruptible = default_interruptible.get(kind, step.interruptible)

        if clamp_fired:
            warnings.append(
                f'Step "{step.text[:60]}..." duration was inferred (not stated); '
                f"clamped to its low end ({dmin} min) per the window-host rule."
            )
        if freshness == "stated_unbounded":
            warnings.append(
                f'"{step.text[:60]}..." must be done fresh (source: "{freshness_cue}"); '
                "no time limit is stated, so it is scheduled right before it's needed."
            )
            review_recommended = True
        if dep_source == "defaulted":
            review_recommended = True
        if duration_source in ("inferred", "defaulted") and attention in ("periodic", "unattended"):
            review_recommended = True

        nodes.append(
            Node(
                id=node_ids[index],
                stage=stages_for_steps[index],
                label=_accept_label(step.label, step.text),
                instruction=step.text,
                kind=kind,
                attention=attention,
                duration_min=dmin,
                duration_typical=dtyp,
                duration_max=dmax,
                station=step.station,
                depends_on=[],  # filled below, once every node id is known
                consumes=step_ingredient_ids[index],
                produces=(
                    None
                    if force_linear or not step.produces_component
                    else f"comp_{_slugify(step.produces_component)}"
                ),
                interruptible=interruptible,
                max_lead_min=max_lead_min,
                doneness_cue=_clean_cue(step.doneness_cue),
                tip=None,
            )
        )
        decisions.append(
            NodeDecision(
                node_id=node_ids[index],
                attention_source=attention_source,
                duration_source=duration_source,
                depends_on_previous_source=dep_source,
                freshness=freshness,
                freshness_cue=freshness_cue,
                origin=step.origin,
            )
        )

    # -- Optional/alternative notes onto the step they modify (CP2 decision B) -------
    # Verbatim, prefixed, never deleted: the Plan renders `Node.tip`.
    position_of = {original: position for position, original in enumerate(roles.required)}
    for original in sorted(roles.attach):
        target = nodes[position_of[roles.attach[original]]]
        note = _role_note(recipe.steps[original])
        target.tip = note if target.tip is None else f"{target.tip} {note}"
        warnings.append(
            f'Kept "{recipe.steps[original].text}" as an optional note on "{target.label}".'
        )

    # -- Edges: base chain, with fork/join for honored independence (B1) ------------
    # `open_deps` is the set of node ids a NEW sequential step must join on -- every
    # node that forked off since the last sequential join point and has not yet been
    # re-joined. A sequential step depends on the whole open set (the join) and then
    # becomes the new, sole open member. An honored-independent step never invents a
    # dependency: it copies its immediate predecessor's own `depends_on` (a sibling
    # may start whenever that predecessor could start, never earlier) and is added to
    # the open set so a later join includes it. A chain of only sequential steps is
    # byte-identical to the old `[nodes[index - 1].id]` chain (each join's open set
    # has exactly one member); edges only ever point to already-built nodes, so no
    # cycle can be introduced.
    if explicit:
        for index, node in enumerate(nodes):
            node.depends_on = [nodes[position].id for position in explicit_deps[index]]
    else:
        open_deps: list[str] = []
        for index, node in enumerate(nodes):
            if depends_on_previous_verified[index]:
                node.depends_on = list(open_deps)
                open_deps = [node.id]
            else:
                node.depends_on = list(nodes[index - 1].depends_on)
                open_deps.append(node.id)

    # -- Edges: produces -> consumer, wherever a LATER step names the same product --
    # Strictly later only: a step can't consume something a step after it produces,
    # and matching in both directions is exactly how this created a real dependency
    # cycle the first time (found live at the M2.9 s15 checkpoint). Skipped entirely
    # in force_linear mode -- Tier 1 discards structure, not just this one shortcut.
    if not force_linear:
        nodes_by_id = {node.id: node for node in nodes}
        for index, step in enumerate(steps):
            if step.produces_component is None:
                continue
            producer = nodes[index]
            produced_name = step.produces_component.lower()
            consumer_found = False
            for other_index, other_step in enumerate(steps):
                if other_index <= index:
                    continue
                names_lower = (name.lower() for name in other_step.consumes_ingredients)
                if any(produced_name in name or name in produced_name for name in names_lower):
                    consumer_found = True
                    consumer = nodes[other_index]
                    if producer.id not in consumer.depends_on:
                        consumer.depends_on.append(producer.id)
                    # invariant 6 checks `producer.produces in consumer.consumes` --
                    # without this, no consumer's `consumes` ever contains a `comp_*`
                    # id and the invariant fails unconditionally regardless of the
                    # edge above (a real bug found preparing repair.py's test case).
                    if producer.produces is not None and producer.produces not in consumer.consumes:
                        consumer.consumes.append(producer.produces)

            # B3: nothing named this component by id. Pre-B1 this was always a
            # violation worth repairing (the graph was a strict chain, so the "is it
            # redundant" question never came up). Post-B1 a produces edge can be the
            # *only* connector between two siblings (§6 B3) -- dropping on sight would
            # silently discard real ordering information. Only drop, with a warning,
            # when every strictly-later node already depends on the producer
            # transitively through some other edge: in that case a repair call could
            # only ever add a redundant edge, so there is nothing to fix and no
            # violation is worth spending a repair call on. Otherwise leave `produces`
            # set and let invariant 6 fire -- exactly the case a repair pass earns its
            # cost fixing.
            if not consumer_found:
                later_nodes = nodes[index + 1 :]
                if not later_nodes:
                    # B3's guard for the empty set: a final step has no later node that could
                    # name its product, so the label can never be consumed. Repair cannot fix
                    # it either (a consumer must be strictly later), so it would only cost a
                    # call and then degrade the plan to a chain. Nothing downstream is lost.
                    _logger.warning(
                        'step %d ("%s...") is the last step but was marked as producing "%s"; '
                        "dropped -- no later step can consume it.",
                        index,
                        step.text[:60],
                        step.produces_component,
                    )
                    producer.produces = None
                elif all(
                    _depends_transitively(later, producer.id, nodes_by_id) for later in later_nodes
                ):
                    warnings.append(
                        f'Step "{step.text[:60]}..." was marked as producing '
                        f'"{step.produces_component}", but no later step names it; '
                        "dropped -- every later step already depends on it, so nothing "
                        "downstream loses ordering information."
                    )
                    producer.produces = None

        # -- Edges: freshness structural steering (§4.6) -----------------------------
        for index, decision in enumerate(decisions):
            if decision.freshness != "stated_unbounded":
                continue
            fresh_node = nodes[index]
            if index + 1 >= len(nodes):
                continue  # last node is its own "consumer" position; already terminal
            consumer = nodes[index + 1]
            for dep in consumer.depends_on:
                if dep != fresh_node.id and dep not in fresh_node.depends_on:
                    fresh_node.depends_on.append(dep)

        # -- Edges: dangling-sink join (explicit path only) ---------------------------
        # The explicit path's equivalent of the legacy fork/join join: a required
        # node nothing depends on would be a second sink. Join it into the finish
        # rather than spend a repair call on a structural gap. Runs last, so the
        # producer pass, B3 and freshness steering have already settled.
        if explicit and len(nodes) > 1:
            final = nodes[-1]
            dependents = {dep for node in nodes for dep in node.depends_on}
            joined = False
            for node in nodes[:-1]:
                if node.id not in dependents:
                    final.depends_on.append(node.id)
                    joined = True
                    warnings.append(
                        f'Step "{node.instruction[:60]}..." had nothing after it; the '
                        "final step now waits for it."
                    )
            if joined:
                review_recommended = True
                if decisions[-1].depends_on_previous_source == "extracted":
                    decisions[-1] = replace(decisions[-1], depends_on_previous_source="inferred")

    # -- FGC-5: "N minutes before serving" on a hands-on step -> a derived wait ---------
    # The step's own duration drops the lead (it says when, not how long), so the source's
    # number would be lost. It becomes an unattended wait after the step and before the sink,
    # which keeps the gap in the schedule and lets the scheduler place whatever can happen
    # meanwhile. The number is the source's (`extracted`); the sink and a step on the sink
    # itself are left alone, and so is the Tier 1 chain (it discards structure).
    if not force_linear:
        sink_index = len(nodes) - 1
        for index in range(sink_index):
            if attentions[index] != "hands_on":
                continue
            lead = _serving_wait_expr(steps[index].text, corpus)
            if lead is None:
                continue
            lead_node, sink = nodes[index], nodes[-1]
            wait_id, suffix = "step_wait_before_serving", 2
            while wait_id in seen_node_ids:
                wait_id = f"step_wait_before_serving_{suffix}"
                suffix += 1
            seen_node_ids.add(wait_id)
            wait_min = max(round(lead.low_min), 1)
            wait_max = max(round(lead.high_min), wait_min)
            nodes.insert(
                len(nodes) - 1,
                Node(
                    id=wait_id,
                    stage=lead_node.stage,
                    label="Wait before serving",
                    instruction=(
                        f'Wait {_format_duration(lead)}, then serve. The recipe adds '
                        f'"{lead_node.label}" {_format_duration(lead)} before serving.'
                    ),
                    kind="passive",
                    attention="unattended",
                    duration_min=wait_min,
                    duration_typical=wait_min,
                    duration_max=wait_max,
                    station="none",
                    depends_on=[lead_node.id],
                    interruptible=True,
                ),
            )
            # The wait now carries the lead step's edge into the sink.
            sink.depends_on = [dep for dep in sink.depends_on if dep != lead_node.id]
            sink.depends_on.append(wait_id)
            decisions.append(
                NodeDecision(
                    node_id=wait_id,
                    attention_source="inferred",
                    duration_source="extracted",
                    depends_on_previous_source="inferred",
                    freshness="none",
                    freshness_cue=None,
                )
            )
            warnings.append(
                f'Added a {_format_duration(lead)} wait before serving, from "{steps[index].text}".'
            )

    # -- Stages ----------------------------------------------------------------------
    used_stage_ids = list(dict.fromkeys(node.stage for node in nodes))
    stages = [
        Stage(id=sid, label=_STAGE_LABELS.get(sid, sid.title()), color_key=sid)
        for sid in used_stage_ids
    ]

    yield_text = _verify_yield(recipe.yield_text, corpus)
    servings, servings_stated = _resolve_servings(recipe.servings, yield_text, corpus)
    if not servings_stated:
        warnings.append(SERVINGS_DEFAULTED_WARNING)

    stated_total_min = recipe.stated_total_min
    if stated_total_min is not None:
        # Invariant 8, dropped here (not just in force_linear) so an otherwise
        # structurally valid non-linear graph is never forced into force_linear
        # solely because a marketing total ("15 min") doesn't match verified,
        # cue-grounded passive-step durations (M2.10 s18 F1). Never invented to
        # close the gap -- only ever dropped.
        serial_min = sum(node.duration_typical for node in nodes)
        if abs(serial_min - stated_total_min) > 0.4 * stated_total_min:
            warnings.append(
                f"Dropped the source's stated total time ({stated_total_min} min): "
                f"the verified step durations sum to {serial_min:.0f} min, too far "
                "off to assert both — never invented a number to close the gap."
            )
            stated_total_min = None
            review_recommended = True

    if force_linear:
        # Guarantee invariants 5/6 by DROPPING an assertion the content can't
        # support -- never by inventing one. Invariant 6 needs no action: `produces`
        # is never set above in force_linear mode, so no node claims a component
        # nothing consumes.
        consumed_ids = {c for node in nodes for c in node.consumes}
        for ingredient in ingredients:
            if ingredient.id not in consumed_ids:
                ingredient.optional = True

    if roles.attach:
        # Same drop-never-invent precedent for invariant 5: an ingredient only an
        # optional/alternative note uses is marked optional, not claimed by a node.
        consumed_ids = {c for node in nodes for c in node.consumes}
        note_only_ids = {
            ing_id
            for original in roles.attach
            for ing_id in _ingredient_ids(
                recipe.steps[original].consumes_ingredients, warn=False
            )
        }
        for ingredient in ingredients:
            if ingredient.id not in consumed_ids and ingredient.id in note_only_ids:
                ingredient.optional = True

    graph = CookingGraph(
        id=graph_id,
        title=recipe.title,
        servings=servings,
        servings_stated=servings_stated,
        yield_text=yield_text,
        cuisine=recipe.cuisine,
        source=source,
        ingredients=ingredients,
        nodes=nodes,
        stages=stages,
        stated_total_min=stated_total_min,
    )

    return GraphBuildResult(
        graph=graph,
        node_decisions=decisions,
        warnings=warnings,
        review_recommended=review_recommended,
    )


def build_linear_graph(
    recipe: NormalizedRecipe, raw_source_text: str, *, graph_id: str, source: SourceRef
) -> GraphBuildResult:
    """The Tier 1 degrade: `build_graph(..., force_linear=True)`.

    `COOKING_GRAPH.md` §5: "degrade to a linear ... chain from the raw steps". Named
    separately from `build_graph` so `repair.py`'s call sites read as what they are —
    the guaranteed-safe last resort, never the primary path.
    """
    return build_graph(recipe, raw_source_text, graph_id=graph_id, source=source, force_linear=True)
