"""Leg 3: YouTube caption tracks (manual subtitles or auto-captions). No LLM.

Reuses the same yt-dlp `extract_info` call leg 1 (`youtube.py`) already makes -- the
caption track URLs are already on that `info` dict, so this needs no new dependency
(`httpx` is already a project dependency, used by leg 2's `blog.py`).

See docs/M2.10 plan, binding decisions 2-5. Track selection is deterministic and
happens here, never left to the model (decision 3). Auto-caption event boundaries can
glue adjacent words together with no space between them -- observed live on the ramen
probe video, Hindi "कि" + "हम" arriving as one glued "किहम" -- which would silently
break `graph.py`'s verbatim-substring cue verification downstream if not normalized
here (`fetch_segments`/`flatten`).
"""

from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import parse_qs, urlparse

import httpx
from pydantic import BaseModel, Field

TRANSCRIPT_CHAR_CAP = 24_000
"""Binding decision 5. Past this, `flatten` truncates at a segment boundary and
reports it -- a module constant, not a function default, so callers can't drift."""

_FETCH_TIMEOUT_SEC = 15.0
_WHITESPACE = re.compile(r"\s+")

_BOT_CHECK_RE = re.compile(
    r"confirm you.{0,8}re not a bot|unusual traffic|verify you.{0,8}re (?:a )?human",
    re.IGNORECASE,
)
"""YouTube's bot-check / rate-limit interstitials, served with a 200 and an HTML body."""

_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
"""Statuses worth a bounded retry -- rate-limited or momentarily unavailable, not
"this doesn't exist" (404) or "this request is wrong" (4xx otherwise)."""
_MAX_RETRIES = 2
_RETRY_BACKOFF_SEC = 0.5
"""Fixed, small backoff (0.5s, 1.0s) -- bounded total added latency (~1.5s worst
case) on the rare transient-failure path; zero added latency on the normal path.
Not exponential/jittered -- that's more machinery than this failure mode has earned
(shortform-video-import-plan.md Phase 1 audit: "do not introduce aggressive retries
or a broad networking redesign")."""

# --- Speech-quality gate ------------------------------------------------------------
#
# A fetched transcript is kept only if it reads like speech about cooking. Two parts:
# (1) strip bracketed non-speech tags in any script, (2) require a cooking signal. The
# lists below are deliberately small and generic (stems, units, number words), never tuned
# per video. Matching is on NFC-normalised, punctuation-trimmed, lower-cased tokens.

_JUNK_TAG_WORDS = (
    # music
    "music", "musique", "música", "musica", "muzică", "muzica", "müzik", "musik", "muziek",
    "музыка", "музика", "संगीत", "सङ्गीत", "音楽", "音乐", "音樂", "음악", "موسيقى", "موسيقا",
    "sangeet", "sángeci", "sangeci",
    # applause
    "applause", "aplausos", "applaudissements", "applaus", "तालियां", "तालियाँ", "तालियाँ बजती हैं",
    "拍手", "鼓掌", "박수", "تصفيق",
    # laughter
    "laughter", "risas", "rires", "risate", "lachen", "हँसी", "हंसी", "笑い", "笑声", "웃음", "ضحك",
)
_JUNK_TAG_RE = re.compile(
    r"[\[(]\s*(?:" + "|".join(re.escape(w) for w in _JUNK_TAG_WORDS) + r")\s*[\])]",
    re.IGNORECASE,
)
"""Bracketed non-speech tags ("[Music]", "[संगीत]", "[música]", "[音楽]", "[موسيقى]", ...)
in several scripts. Only these exact words are stripped: an unknown bracketed tag stays,
because deleting text we don't recognise is how real speech gets lost."""

TRANSCRIPT_GATE_VERSION = 1
"""Version of the caption selection + speech-quality gate in this module. Part of the cache
identity (`PipelineFingerprint`): `extract/acquire/` is outside the POSTPROCESS_VERSION
hash, but a plan built from captions the old gate let through (or dropped) is stale.
**Bump it whenever `select_track`, the tag list, the signal lists or the thresholds change.**"""

JUNK_MIN_TOKENS = 3
"""Fewer whitespace-delimited tokens than this (after tag stripping) is junk. Counting
whitespace tokens, not regex "words", keeps Indic scripts honest: a word-character regex
splits Devanagari at vowel signs and over-counts Hindi by ~1.6-1.8x. Above this, the
cooking-signal rule alone decides (plan amendment 6, 2026-10-31)."""

_UNITS_ALONE = frozenset(
    {
        # weights, volumes, spoons: a signal on their own
        "tsp", "tbsp", "teaspoon", "teaspoons", "tablespoon", "tablespoons", "cup", "cups",
        "gram", "grams", "gm", "g", "kg", "kilo", "kilos", "ml", "litre", "litres", "liter",
        "liters", "l", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "pinch",
        "कप", "चम्मच", "चमच", "चम्मचभर", "ग्राम", "किलो", "लीटर", "मिलीलीटर", "चुटकी",
    }
)
"""Measure words that count as a cooking signal alone."""

_UNITS_COUNTED = frozenset(
    {
        # container / count units
        "clove", "cloves", "inch", "कली", "कलियां", "कलियाँ", "गिलास", "कटोरी",
        # time units
        "minute", "minutes", "min", "mins", "hour", "hours", "मिनट", "सेकंड", "घंटा", "घंटे",
    }
)
"""Units that are ordinary words in lyrics and speech ("कली" = a flower bud, "गिलास" = a
glass), so they count only directly after a digit or a number word."""

# English stems are lemmas matched against their inflections only (see `_english_forms`),
# never as bare prefixes: "grate" must not match "grateful", "add" not "addicted".
_STRONG_ENGLISH = (
    "add", "boil", "fry", "saute", "sauté", "simmer", "bake", "chop", "knead", "whisk",
    "marinate", "grate", "mince", "preheat", "sprinkle", "garnish", "splutter", "tadka",
)
_WEAK_ENGLISH = (
    "mix", "heat", "season", "roast", "blend", "stir", "cut", "slice", "pour", "cook", "serve",
    "mash",
    # Cooking verbs demoted by the collision audit (reasons are INFERRED):
    "temper",  # temper = anger; "tempered" glass; tempering chocolate is the rarer use
    "drain",  # "drained" / "drain" = emotional or energy drain in speech and lyrics
    "grind",  # "the daily grind", "grinding" = hustle or dancing
    "dice",  # "roll the dice" (a noun, and the same token as the verb)
    "sizzle",  # "sizzling" = hot or attractive in lyrics
)
_ENGLISH_SUFFIXES = ("s", "es", "d", "ed", "ing")

# Spanish / French / Portuguese stems are conjugation stems, so they stay prefix-matched.
_STRONG_ROMANCE = (
    "añad", "agreg", "hierv", "hervir", "hornea", "ajout", "bouill", "mijot",
    "fervu", "refog",
)
_WEAK_ROMANCE = (
    "adicion",  # adicional = "additional" (adicionar, the cooking verb, is rarer in speech)
    "sofr",  # Portuguese sofrer / sofrimento = "to suffer / suffering", common in lyrics
)

_STRONG_DEVANAGARI = (
    # Only stems that are not the prefix of a common non-cooking word.
    "पका", "भून", "उबाल", "उबल", "फ्राई", "छौंक", "गूंथ", "गूँथ", "सेंक", "मैरिनेट",
    "मैरीनेट", "कद्दूकस",
)
_WEAK_DEVANAGARI = (
    "मिला", "मिले", "चला", "निकाल", "रख", "मिसळ",  # "मिला" = "found/met"
    # Cooking verbs demoted by the prefix-collision audit (reasons are INFERRED):
    "डाल",  # डाली "branch", डालर "dollar"; डालना is also "throw/put" in lyrics
    "घाल",  # घालमेल "mess/confusion"
    "काट",  # काटना is also "bite / pass time" ("वक़्त काट"); काटा "bit"
    "पीस",  # पीस "piece/peace" (Hinglish), पीसी "PC / paternal aunt"
    "गरम",  # गरमी "summer heat", गरमाहट "warmth"
    "बेक",  # बेकार "useless", बेकरार, बेकसूर, बेकाबू: common lyric words
    "तड़क",  # तड़क-भड़क "flashy"; तड़कना "to crack"
    "मसल",  # मसला "issue", मसलन "for example"
)

# Cooking-form rule: a demoted stem is strong again in the exact verb forms below.
_DAL_FORMS = frozenset({"डालें", "डालो", "डालना", "डालने", "डालते", "डालकर"})
_DAL_NEXT = frozenset({"कर", "दें", "दो", "दीजिए", "दिया", "देना"})
"""`डाल` as its own token is a cooking verb when followed by one of these ("डाल दें",
"डाल कर"). `डाली` and `डालर` match nothing here."""
_BORROWED_VERB_BASES = frozenset({"गरम", "बेक"})
_KAR_FORMS = frozenset({"कर", "करें", "करो", "करना", "करके", "कीजिए", "करते"})
"""A borrowed-verb base ("गरम", "बेक") followed by a कर-family token ("गरम करें") is a verb.
Exact token equality, so "गरमी" and "बेकार" never match."""

_NUMBER_WORDS = frozenset(
    {
        "दो", "तीन", "चार", "पांच", "पाँच", "पाच", "छह", "छः", "सात", "आठ", "नौ", "दस", "आधा",
        "आधी", "आधे", "डेढ़", "ढाई", "सवा", "पाव",
        "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "half",
        "quarter", "dozen", "teen", "paanch", "dedh", "dhai", "aadha", "aadhi", "aadhe",
    }
)
"""Number words that count as the second signal for a weak stem, and that qualify a counted
unit. Excludes एक / ek / one / a on purpose: they are far too common in ordinary speech."""

_NUMBER_WORD_WINDOW = 3


def _english_forms(lemmas: tuple[str, ...]) -> frozenset[str]:
    """Every inflection a lemma may take, and nothing longer.

    Suffix rule: `lemma + {"", s, es, d, ed, ing}`, plus the e-drop (`grate` -> `grating`),
    the y->i change (`fry` -> `fried`, `fries`) and a doubled final consonant
    (`chop` -> `chopped`, `chopping`). Any other continuation (`grateful`, `addicted`,
    `temperature`, `mixture`) is not a match. Some generated forms are not real words;
    they are harmless because only transcript tokens are looked up.
    """
    forms: set[str] = set()
    for lemma in lemmas:
        forms.add(lemma)
        forms.update(lemma + suffix for suffix in _ENGLISH_SUFFIXES)
        if lemma.endswith("e"):
            forms.add(lemma[:-1] + "ing")
        if lemma.endswith("y"):
            forms.update({lemma[:-1] + "ied", lemma[:-1] + "ies"})
        forms.update({lemma + lemma[-1] + "ed", lemma + lemma[-1] + "ing"})
    return frozenset(forms)


_STRONG_ENGLISH_FORMS = _english_forms(_STRONG_ENGLISH)
_WEAK_ENGLISH_FORMS = _english_forms(_WEAK_ENGLISH)

# Public views for audits and the offline report.
_STRONG_STEMS = (*_STRONG_ENGLISH, *_STRONG_ROMANCE, *_STRONG_DEVANAGARI)
_WEAK_STEMS = (*_WEAK_ENGLISH, *_WEAK_ROMANCE, *_WEAK_DEVANAGARI)
_UNITS = _UNITS_ALONE | _UNITS_COUNTED


@dataclass(frozen=True)
class SignalHits:
    """What the cooking-signal check saw in one transcript (for the gate and for audits)."""

    tokens: int
    quantities: int
    units: int
    strong: int
    weak_confirmed: int
    weak_unconfirmed: int
    units_unconfirmed: int = 0
    """Counted units (time, container) with no digit or number word before them."""

    @property
    def has_signal(self) -> bool:
        """Whether anything counts as a cooking signal."""
        return bool(self.quantities or self.units or self.strong or self.weak_confirmed)


def strip_junk_tags(text: str) -> str:
    """Remove bracketed music / applause / laughter tags, in any of the listed scripts."""
    return _JUNK_TAG_RE.sub(" ", text)


def _norm_token(raw: str) -> str:
    """NFC, lower-cased, with leading/trailing non-letter/mark/number characters trimmed."""
    token = unicodedata.normalize("NFC", raw).lower()
    start, end = 0, len(token)
    while start < end and unicodedata.category(token[start])[0] not in "LMN":
        start += 1
    while end > start and unicodedata.category(token[end - 1])[0] not in "LMN":
        end -= 1
    return token[start:end]


def _is_quantity_char(ch: str) -> bool:
    """A decimal digit in any script (category Nd, so Devanagari ०-९ counts) or a vulgar
    fraction (½ ⅓ ¾ ...). CJK numerals (一 十 万), Roman numerals (Ⅻ), circled (①) and
    superscript (²) characters are NOT quantities: they appear in lyrics and prose."""
    if unicodedata.category(ch) == "Nd":
        return True
    return unicodedata.category(ch) == "No" and "FRACTION" in unicodedata.name(ch, "")


def _has_quantity(token: str) -> bool:
    """Whether `token` contains a decimal digit in any script or a vulgar-fraction character."""
    return any(_is_quantity_char(ch) for ch in token)


def _starts_with_any(token: str, stems: tuple[str, ...]) -> bool:
    return any(token.startswith(unicodedata.normalize("NFC", s).lower()) for s in stems)


def _is_strong(tokens: list[str], index: int) -> bool:
    token = tokens[index]
    following = tokens[index + 1] if index + 1 < len(tokens) else ""
    if token in _STRONG_ENGLISH_FORMS:
        return True
    if _starts_with_any(token, _STRONG_ROMANCE) or _starts_with_any(token, _STRONG_DEVANAGARI):
        return True
    if token in _DAL_FORMS or (token == "डाल" and following in _DAL_NEXT):
        return True
    return token in _BORROWED_VERB_BASES and following in _KAR_FORMS


def _is_weak(token: str) -> bool:
    return (
        token in _WEAK_ENGLISH_FORMS
        or _starts_with_any(token, _WEAK_ROMANCE)
        or _starts_with_any(token, _WEAK_DEVANAGARI)
    )


def signal_hits(text: str) -> SignalHits:
    """Count cooking signals in `text` after stripping non-speech tags. Pure."""
    tokens = [t for t in (_norm_token(raw) for raw in strip_junk_tags(text).split()) if t]
    quantities = units = strong = weak_confirmed = weak_unconfirmed = units_unconfirmed = 0
    for index, token in enumerate(tokens):
        previous = tokens[index - 1] if index else ""
        if _has_quantity(token):
            quantities += 1
        elif token in _UNITS_ALONE:
            units += 1
        elif token in _UNITS_COUNTED:
            if _has_quantity(previous) or previous in _NUMBER_WORDS:
                units += 1
            else:
                units_unconfirmed += 1
        elif _is_strong(tokens, index):
            strong += 1
        elif _is_weak(token):
            window = tokens[max(0, index - _NUMBER_WORD_WINDOW) : index]
            if any(w in _NUMBER_WORDS for w in window):
                weak_confirmed += 1
            else:
                weak_unconfirmed += 1
    return SignalHits(
        len(tokens), quantities, units, strong, weak_confirmed, weak_unconfirmed, units_unconfirmed
    )


def junk_reason(text: str) -> Literal["too_short", "no_cooking_signal"] | None:
    """Why `text` is not a usable spoken method, or None when it is.

    `too_short`: fewer than `JUNK_MIN_TOKENS` whitespace tokens after tag stripping.
    `no_cooking_signal`: long enough, but no quantity, unit, strong cooking stem, or
    confirmed weak stem (music, lyrics, or speech about something else).
    """
    hits = signal_hits(text)
    if hits.tokens < JUNK_MIN_TOKENS:
        return "too_short"
    if not hits.has_signal:
        return "no_cooking_signal"
    return None


def is_junk_transcript(text: str) -> bool:
    """Whether `text` looks like non-speech junk rather than a genuine spoken method."""
    return junk_reason(text) is not None


class TranscriptSegment(BaseModel):
    """One caption event, before flattening. Transient -- extract-internal only.

    Stored on `RawAcquisition` for a future "watch this step" / duration-corroboration
    feature (deferred, see the M2.10 plan); the LLM itself only ever sees the flattened
    text from `flatten`, never these segments directly.
    """

    start_sec: float = Field(description="Segment start, seconds from video start.")
    end_sec: float = Field(description="Segment end, seconds from video start.")
    text: str = Field(description="Segment text, whitespace-normalized.")


def _json3_url(pool: dict[str, Any], key: str) -> str | None:
    """The `json3`-format URL for `key` in a `subtitles`/`automatic_captions` pool."""
    formats = pool.get(key)
    if not formats:
        return None
    for fmt in formats:
        if isinstance(fmt, dict) and fmt.get("ext") == "json3":
            url = fmt.get("url")
            return url if isinstance(url, str) else None
    return None


def is_translated_url(url: str) -> bool:
    """Whether a caption URL asks YouTube for a machine translation (`tlang=`)."""
    return "tlang" in parse_qs(urlparse(url).query)


def _usable_url(pool: dict[str, Any], key: str) -> str | None:
    """The `json3` URL for `key`, or None when absent or a `tlang=` translation."""
    url = _json3_url(pool, key)
    return None if url is None or is_translated_url(url) else url


def select_track(info: dict[str, Any]) -> tuple[Literal["manual", "auto"], str, str] | None:
    """Pick one caption track from a yt-dlp `info` dict. Deterministic, no LLM.

    Track Ruling A (owner, 2026-10-29; plan amendment 5). Spoken language = base of
    `info.language`; else the language of the single `-orig` key; else unknown. Order:

    1. Manual subtitles in the spoken language: the exact code, its base language
       (`en-US` -> `en`), then `<base>-*` variants, sorted.
    2. Auto-captions of the original speech: `<lang>-orig`, then `<base>-orig`, then the plain
       `<lang>` / `<base>` key -- the last only when `info.language` was listed.
    3. Manual subtitles in ANOTHER language, sorted -- only when no `-orig` exists for the
       spoken language. A creator translation can add amounts never spoken, so it is a
       fallback, never a rival to the original speech's own captions.
    4. Nothing.

    Unknown language: the single `-orig` key (it then defines the spoken language); with
    several (extra ones look like auto-dub tracks) none is taken and nothing is returned.

    A track whose URL carries `tlang=` is a machine translation and is never chosen at any
    step. No other auto-caption key is ever tried.

    Args:
        info: the yt-dlp `extract_info` result for one video.

    Returns:
        `(kind, lang, json3_url)`, `kind` one of `"manual"`/`"auto"`, or `None` if no
        usable `json3` track exists.
    """
    manual = info.get("subtitles") or {}
    auto = info.get("automatic_captions") or {}
    lang = info.get("language") or None
    origs = {k: u for k in sorted(auto) if k.endswith("-orig") and (u := _usable_url(auto, k))}

    # Spoken language: info.language; else the single -orig key's language; else unknown.
    spoken_lang = lang
    if spoken_lang is None and len(origs) == 1:
        spoken_lang = next(iter(origs)).removesuffix("-orig")
    base = spoken_lang.split("-")[0] if spoken_lang else None
    spoken = [k for k in dict.fromkeys([spoken_lang, base]) if k]
    if not spoken and len(origs) > 1:
        return None  # several -orig keys and no way to tell the speech from an auto-dub

    # 1. Manual, spoken language (plain or regional variant).
    variants = sorted(k for k in manual if base and k.startswith(f"{base}-"))
    for key in dict.fromkeys([*spoken, *variants]):
        url = _usable_url(manual, key)
        if url:
            return "manual", key, url

    # 2. Auto, original speech.
    for key in dict.fromkeys(f"{k}-orig" for k in spoken):
        if key in origs:
            return "auto", key.removesuffix("-orig"), origs[key]
    if lang is not None:  # the plain key is trusted only when YouTube listed the language
        for key in spoken:
            url = _usable_url(auto, key)
            if url:
                return "auto", key, url

    # 3. Manual in another language: only when no -orig exists for the spoken language
    # (known) / no -orig exists at all (unknown language, zero -orig keys).
    orig_exists = any(f"{k}-orig" in origs for k in spoken) if spoken else bool(origs)
    if not orig_exists:
        for key in sorted(manual):
            url = _usable_url(manual, key)
            if url:
                return "manual", key, url

    return None


def _response_text(response: httpx.Response) -> str:
    """The response body as text, "" if it can't be read (a cache of nothing, never a raise)."""
    try:
        return response.text
    except (ValueError, AttributeError):
        return ""


def fetch_segments(
    url: str, *, timeout: float = _FETCH_TIMEOUT_SEC, max_retries: int = _MAX_RETRIES
) -> tuple[list[TranscriptSegment], bool]:
    """GET a `json3` caption track and parse it into segments. Never raises.

    A missing or broken transcript degrades the source set by one leg, never the
    import -- mirrors `blog.fetch_recipe`'s fail-soft contract. Segment text joins that
    event's `segs[].utf8` fragments with `""` (they are word-parts of the same line)
    and collapses internal whitespace; the space *between* segments that fixes glued
    event boundaries is added later, at `flatten` time.

    Retries up to `max_retries` times, with a short fixed backoff, on a *retryable*
    failure (429/5xx status, or a transport-level error like a timeout) before giving
    up -- YouTube's caption endpoint (`timedtext`) rate-limits under burst traffic,
    confirmed live during the shortform-video-import Phase 0 eval: 7 of 14 probed
    videos had a real caption track that a bare `except httpx.HTTPError: return []`
    turned into "no transcript", indistinguishable from the 7 that genuinely had none.
    A *definitive* failure (404, or any other non-retryable status; malformed JSON)
    still degrades silently on the first try, same as before -- that really does mean
    "there is nothing usable here," not "ask again."

    Returns:
        `(segments, transient_failure)`. `transient_failure` is True only when every
        attempt exhausted the retry budget on a retryable status/transport error --
        never True for a clean 404 or an unparseable response -- except a 200 bot-check page,
        which is a transient block. Callers should surface
        `transient_failure` (e.g. as a warning) rather than silently reading an empty
        `segments` list as "this video has no captions" when it's True.
    """
    response: httpx.Response | None = None
    for attempt in range(max_retries + 1):
        try:
            candidate = httpx.get(url, timeout=timeout)
        except httpx.TransportError:
            candidate = None
        if candidate is not None and candidate.status_code not in _RETRYABLE_STATUS:
            response = candidate
            break
        if attempt < max_retries:
            time.sleep(_RETRY_BACKOFF_SEC * (attempt + 1))
    else:
        return [], True  # every attempt hit a retryable status or transport error

    assert response is not None  # guaranteed by the for/else above on a normal exit
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError:
        return [], False  # a definitive non-retryable status (e.g. 404): genuinely nothing here
    try:
        data = response.json()
    except ValueError:
        # A 200 that is not JSON is usually an interstitial; a bot-check page is a transient
        # block on this request, not "this video has no captions".
        return [], bool(_BOT_CHECK_RE.search(_response_text(response)))
    if not isinstance(data, dict):
        return [], False

    segments: list[TranscriptSegment] = []
    for event in data.get("events") or []:
        if not isinstance(event, dict):
            continue
        start_ms = event.get("tStartMs")
        if not isinstance(start_ms, int | float):
            continue
        segs = event.get("segs") or []
        text = _WHITESPACE.sub(
            " ", "".join(seg.get("utf8", "") for seg in segs if isinstance(seg, dict))
        ).strip()
        if not text:
            continue
        duration_ms = event.get("dDurationMs") or 0
        segments.append(
            TranscriptSegment(
                start_sec=start_ms / 1000,
                end_sec=(start_ms + duration_ms) / 1000,
                text=text,
            )
        )
    return segments, False


def flatten(
    segments: list[TranscriptSegment], cap: int = TRANSCRIPT_CHAR_CAP
) -> tuple[str, bool]:
    """Join segment texts with a single space; truncate at `cap` chars if needed.

    Truncation always backs up to the last whole segment that fits, so the flattened
    text never bisects a word mid-caption -- a truncated transcript may still lose the
    finish, which is why `review_recommended` is not forced from this alone (decision
    5); the existing invariant checks in `graph.py` decide that independently.

    Returns:
        `(text, truncated)`.
    """
    if not segments:
        return "", False

    full_text = " ".join(segment.text for segment in segments)
    if len(full_text) <= cap:
        return full_text, False

    kept: list[str] = []
    length = 0
    for segment in segments:
        addition = len(segment.text) + (1 if kept else 0)  # +1 for the joining space
        if length + addition > cap:
            break
        kept.append(segment.text)
        length += addition
    return " ".join(kept), True
