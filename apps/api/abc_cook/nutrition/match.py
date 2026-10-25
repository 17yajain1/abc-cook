"""Match ingredient lines to USDA foods (b2-plan Step 3, part-a-plan §5).

Order: (1) the food-map cache; (2) a deterministic exact or alias match; (3) one batched
gpt-5-mini call per recipe for what is left, choosing only from a shortlist of about 25 foods
per line (token overlap plus alias-table neighbours). An id outside the line's shortlist is
rejected and the line stays unmatched. The same call may also return a gram estimate for a
matched line the gram resolver could not convert.

This is the only module in the package that does I/O: the optional JSON file store and the LLM
call. It never raises for a bad model answer, and a recipe never fails because matching did.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

import pydantic

from abc_cook.extract.adapters.base import LLMAdapter
from abc_cook.extract.pricing import INR_PER_1K_TOKENS, call_cost_inr
from abc_cook.nutrition.calc import is_optional, is_salt_or_pepper_to_taste
from abc_cook.nutrition.foods import Food, FoodTable
from abc_cook.nutrition.grams import line_grams
from abc_cook.nutrition.resolution import LineResolution, MissReason
from abc_cook.schema.ingredient import Ingredient

MATCH_MODEL = "gpt-5-mini"
SHORTLIST_SIZE = 25
SHORTLIST_METHOD = "token-overlap-25+alias-neighbours"
MAX_TOKENS = 4000
SPEND_CAP_INR = 40.0

STATE_WORDS = ("cooked", "boiled", "soaked", "canned", "roasted", "fried", "dry", "raw")
_COOKED_STATES = {"cooked", "boiled", "soaked", "canned"}
_COOKED_NAME_RE = re.compile(r"\b(?:cooked|boiled|canned|fried|roasted|steamed)\b", re.IGNORECASE)
_RAW_NAME_RE = re.compile(r"\b(?:raw|dry|dried|uncooked)\b", re.IGNORECASE)

_PREP_WORDS = {
    "chopped", "finely", "fine", "roughly", "coarsely", "thinly", "minced", "sliced", "diced",
    "grated", "shredded", "cubed", "peeled", "deseeded", "seeded", "halved", "slit", "fresh",
    "large", "small", "medium", "big", "few", "some", "diagonally", "bite", "sized", "pieces",
    "piece", "cut", "into", "of", "the", "a", "an", "to", "adjust", "taste", "optional",
}  # fmt: skip
_STOP_TOKENS = {
    "the", "and", "with", "for", "raw", "fresh", "whole", "type", "from", "style", "dry",
    "cooked", "boiled", "canned", "roasted", "fried", "chopped", "sliced",
}  # fmt: skip
_PARENS_RE = re.compile(r"\([^()]*\)")
_EN_DASH = chr(0x2013)  # ASCII-safe in source (RUF001)
_LEADING_AMOUNT_RE = re.compile(
    rf"^[\d\s./½¼¾⅓⅔⅛\-{_EN_DASH}]+"
    r"(?:tbsp|tsp|cups?|g|gm|gms|kg|ml|l|oz|lb|tablespoons?|teaspoons?)?\b\.?\s*"
)
_ALT_SPLIT_RE = re.compile(r"\s*(?:/|,|\bor\b)\s*")
_TOKEN_RE = re.compile(r"[a-z]{3,}")


@dataclass(frozen=True)
class CleanName:
    """A line's name with amounts, parentheticals and prep words removed; state words kept."""

    name: str
    state: str | None


def clean_name(raw: str) -> CleanName:
    """Normalise an ingredient name for matching.

    Strips parentheticals, a leading amount, and prep words. Keeps the state words (cooked,
    boiled, soaked, canned, roasted, fried, dry, raw) in the name and reports the first one as
    `state`, read from the main text only: a parenthetical like "(or canned beans)" is an
    alternative, not the state of this line.
    """
    text = raw.lower().replace("&amp;", "&")
    previous = None
    while previous != text:
        previous = text
        text = _PARENS_RE.sub(" ", text)
    text = re.sub(r"\(.*$", " ", text)  # an unclosed "(" swallows the rest
    text = _LEADING_AMOUNT_RE.sub("", text.strip())
    words = [w for w in re.findall(r"[a-z]+|/", text) if w not in _PREP_WORDS]
    cleaned = " ".join(words).replace(" / ", " / ").strip(" /")
    state = next((w for w in re.findall(r"[a-z]+", cleaned) if w in STATE_WORDS), None)
    return CleanName(re.sub(r"\s+", " ", cleaned), state)


def candidates(cleaned: str) -> list[str]:
    """Names to try in order: the whole name, each "/" or "or" alternative, then singulars."""
    parts = [p.strip() for p in _ALT_SPLIT_RE.split(cleaned) if p.strip()]
    ordered = [cleaned, *parts]
    singular = [re.sub(r"(?:es|s)$", "", c) for c in ordered if len(c) > 4 and c.endswith("s")]
    seen: dict[str, None] = {}
    for c in [*ordered, *singular]:
        seen.setdefault(c, None)
    return list(seen)


def deterministic_match(cleaned: str, table: FoodTable) -> tuple[str, str] | None:
    """(food_id, "alias" | "exact") for the first candidate the table knows, or None."""
    for name in candidates(cleaned):
        if name in table.by_alias:
            return table.by_alias[name], "alias"
        if name in table.by_name:
            return table.by_name[name], "exact"
    return None


def _stem(token: str) -> str:
    """Crude plural stripping so "onion" finds "Onions" and "tomato" finds "Tomatoes"."""
    if token.endswith("oes") and len(token) > 4:
        return token[:-2]
    if token.endswith("ies") and len(token) > 4:
        return token[:-3] + "y"
    if token.endswith("s") and not token.endswith("ss") and len(token) > 3:
        return token[:-1]
    return token


def _tokens(text: str) -> set[str]:
    return {_stem(t) for t in _TOKEN_RE.findall(text.lower()) if t not in _STOP_TOKENS}


class ShortlistIndex:
    """Token index over food names and aliases, built once per run."""

    def __init__(self, table: FoodTable) -> None:
        """Index every food's name tokens and alias tokens."""
        self._table = table
        self._name_tokens: dict[str, set[str]] = {}
        self._alias_tokens: dict[str, set[str]] = {}
        self._by_token: dict[str, set[str]] = {}
        for food in table.foods.values():
            name_tokens = _tokens(food.name)
            alias_tokens = (
                set().union(*(_tokens(a) for a in food.aliases)) if food.aliases else set()
            )
            self._name_tokens[food.id] = name_tokens
            self._alias_tokens[food.id] = alias_tokens
            for token in name_tokens | alias_tokens:
                self._by_token.setdefault(token, set()).add(food.id)

    def shortlist(self, cleaned: str, state: str | None, size: int = SHORTLIST_SIZE) -> list[Food]:
        """Up to `size` foods ranked by overlap with the name, raw/dry first unless cooked."""
        line_tokens = _tokens(cleaned)
        scores: dict[str, float] = {}
        for token in line_tokens:
            for food_id in self._by_token.get(token, ()):
                bonus = 2.0 if token in self._alias_tokens[food_id] else 1.0
                scores[food_id] = scores.get(food_id, 0.0) + bonus
        wants_cooked = state in _COOKED_STATES
        ranked: list[tuple[float, int, str]] = []
        for food_id, score in scores.items():
            food = self._table.foods[food_id]
            adjusted = score / (1.0 + 0.1 * len(self._name_tokens[food_id]))
            is_cooked = bool(_COOKED_NAME_RE.search(food.name))
            if wants_cooked:
                adjusted += 1.0 if is_cooked else 0.0
            else:
                adjusted -= 1.0 if is_cooked else 0.0
                adjusted += 0.5 if _RAW_NAME_RE.search(food.name) else 0.0
            ranked.append((-adjusted, len(food.name), food_id))
        ranked.sort()
        return [self._table.foods[food_id] for _, _, food_id in ranked[:size]]


# --- the food-map store -----------------------------------------------------------------------


@dataclass(frozen=True)
class FoodKey:
    """(cleaned name, state, foods_version): "boiled potato" and "potato" never share a row."""

    name: str
    state: str | None
    foods_version: str

    def encode(self) -> str:
        """The key as one JSON-object key."""
        return f"{self.name}|{self.state or ''}|{self.foods_version}"


class FoodMapStore(Protocol):
    """Cache of food mappings (and LLM gram estimates). A reviewed row is never overwritten."""

    def get_food(self, key: FoodKey) -> dict[str, Any] | None:
        """The stored row for `key`, or None."""
        ...

    def put_food(self, key: FoodKey, food_id: str | None, *, model: str, now: datetime) -> None:
        """Store an LLM mapping (None `food_id` = no food fits) unless a reviewed row exists."""
        ...

    def get_grams(self, key: str) -> float | None:
        """A stored LLM gram estimate for a whole line, or None."""
        ...

    def put_grams(self, key: str, grams: float, *, model: str, now: datetime) -> None:
        """Store an LLM gram estimate for a whole line."""
        ...


class InMemoryFoodMapStore:
    """A `FoodMapStore` that lives in a dict; for tests."""

    def __init__(self) -> None:
        """Start empty."""
        self.foods: dict[str, dict[str, Any]] = {}
        self.grams: dict[str, dict[str, Any]] = {}

    def get_food(self, key: FoodKey) -> dict[str, Any] | None:
        """The stored row for `key`, or None."""
        return self.foods.get(key.encode())

    def put_food(self, key: FoodKey, food_id: str | None, *, model: str, now: datetime) -> None:
        """Store an LLM mapping unless a reviewed row exists."""
        existing = self.foods.get(key.encode())
        if existing is not None and existing.get("reviewed"):
            return
        self.foods[key.encode()] = {
            "food_id": food_id,
            "model": model,
            "date": now.isoformat(),
            "basis": "llm",
            "reviewed": False,
        }

    def get_grams(self, key: str) -> float | None:
        """A stored LLM gram estimate, or None."""
        row = self.grams.get(key)
        return float(row["grams"]) if row else None

    def put_grams(self, key: str, grams: float, *, model: str, now: datetime) -> None:
        """Store an LLM gram estimate."""
        self.grams[key] = {
            "grams": grams,
            "model": model,
            "date": now.isoformat(),
            "basis": "llm",
            "reviewed": False,
        }


class JsonFileFoodMapStore(InMemoryFoodMapStore):
    """A `FoodMapStore` kept in one JSON file (gitignored `data/` for now; Postgres at M5)."""

    def __init__(self, path: Path) -> None:
        """Load the file if it exists."""
        super().__init__()
        self._path = path
        if path.exists():
            document = json.loads(path.read_text(encoding="utf-8"))
            self.foods = dict(document.get("foods", {}))
            self.grams = dict(document.get("grams", {}))

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            {"foods": self.foods, "grams": self.grams}, ensure_ascii=False, indent=1
        )
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
        os.replace(tmp, self._path)

    def put_food(self, key: FoodKey, food_id: str | None, *, model: str, now: datetime) -> None:
        """Store an LLM mapping unless a reviewed row exists, then persist."""
        super().put_food(key, food_id, model=model, now=now)
        self._save()

    def put_grams(self, key: str, grams: float, *, model: str, now: datetime) -> None:
        """Store an LLM gram estimate, then persist."""
        super().put_grams(key, grams, model=model, now=now)
        self._save()


def grams_key(ing: Ingredient) -> str:
    """Cache key for an LLM gram estimate: the whole line, since the estimate is for its amount."""
    text = f"{ing.name}|{ing.qty_text or ''}|{ing.unit or ''}".lower()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


# --- spend guard ------------------------------------------------------------------------------


def estimate_tokens(text: str) -> int:
    """Input tokens for `text`: tiktoken's o200k when available, else characters / 4."""
    try:
        import tiktoken

        return len(tiktoken.get_encoding("o200k_base").encode(text))
    except Exception:  # any tokenizer problem falls back to the rough count
        return max(1, len(text) // 4)


class SpendGuard:
    """Refuses a call whose worst-case cost would push the run over its ₹ cap."""

    def __init__(self, cap_inr: float = SPEND_CAP_INR, model: str = MATCH_MODEL) -> None:
        """Start with nothing spent."""
        self.cap_inr = cap_inr
        self.model = model
        self.spent_inr = 0.0

    def estimate_inr(self, prompt_text: str, max_tokens: int = MAX_TOKENS) -> float:
        """Worst case: all input tokens plus the full `max_tokens` output budget."""
        rate_in, rate_out = INR_PER_1K_TOKENS[self.model]
        return estimate_tokens(prompt_text) / 1000 * rate_in + max_tokens / 1000 * rate_out

    def allows(self, estimate_inr: float) -> bool:
        """Whether spending `estimate_inr` more stays within the cap."""
        return self.spent_inr + estimate_inr <= self.cap_inr

    def record(self, actual_inr: float) -> None:
        """Add a measured call cost to the run total."""
        self.spent_inr += actual_inr


# --- the LLM call -----------------------------------------------------------------------------


class LineAnswer(pydantic.BaseModel):
    """The model's answer for one line."""

    idx: int
    food_id: str | None
    grams: float | None


class MatchProposal(pydantic.BaseModel):
    """The model's whole response: one answer per asked line."""

    answers: list[LineAnswer]


MATCH_PROMPT = """You map recipe ingredient lines to foods in a fixed nutrition table.

You get a JSON list of lines. Each line has an idx and the ingredient text as written. Some
lines also have `candidates` (a shortlist of {id, name}); for those, return the id of the ONE
candidate that is the same food, or null when none of them honestly is. Never return an id that
is not in that line's candidates. Prefer the raw or dry form (rice, dal, pasta, oats, meat)
unless the line says cooked, boiled, soaked or canned. Pick the plain food, not a branded or
flavoured variant. Do not force a match: a spice blend or a regional item with no candidate that
is truly the same food gets null.

Lines with `want_grams: true` also need `grams`: your best estimate of the TOTAL weight in grams
of the whole line as written (the amount times the unit; for "2 medium onions", the weight of
both). Use null if you cannot estimate it. Lines without `want_grams` get `grams: null`.

Return one answer per line, in the JSON schema given.
"""


@dataclass
class MatchStats:
    """Per-recipe counts for the report."""

    llm_calls: int = 0
    inr: float = 0.0
    latency_ms: float = 0.0
    cache_hits: int = 0
    alias_hits: int = 0
    exact_hits: int = 0
    llm_matches: int = 0
    misses: dict[str, int] = field(default_factory=dict)
    grams_requested: int = 0
    grams_received: int = 0
    guard_refused: bool = False


def _food_of(table: FoodTable, food_id: str | None) -> Food | None:
    return table.get(food_id) if food_id else None


def _now() -> datetime:
    return datetime.now(UTC)


def resolve_recipe(
    ingredients: list[Ingredient],
    *,
    table: FoodTable,
    store: FoodMapStore,
    adapter: LLMAdapter | None,
    guard: SpendGuard,
    index: ShortlistIndex | None = None,
    model: str = MATCH_MODEL,
    now: Callable[[], datetime] = _now,
) -> tuple[list[LineResolution], MatchStats]:
    """Resolve every line to a food (and, where the resolver needs it, a gram estimate).

    At most one LLM call per recipe. With no `adapter` the LLM step is skipped and the lines it
    would have placed stay unmatched (`llm_failed`).
    """
    index = index or ShortlistIndex(table)
    stats = MatchStats()
    n = len(ingredients)
    food_ids: list[str | None] = [None] * n
    sources: list[str | None] = [None] * n
    misses: list[MissReason | None] = [None] * n
    llm_grams: list[float | None] = [None] * n
    cleaned = [clean_name(ing.name) for ing in ingredients]
    keys = [FoodKey(c.name, c.state, table.foods_version) for c in cleaned]

    pending_food: dict[int, list[Food]] = {}
    for i, (c, key) in enumerate(zip(cleaned, keys, strict=True)):
        row = store.get_food(key)
        if row is not None and row.get("food_id") and table.get(row["food_id"]):
            food_ids[i], sources[i] = row["food_id"], "cache"
            stats.cache_hits += 1
            continue
        if row is not None and row.get("food_id") is None:
            misses[i] = "cached_none"
            continue
        found = deterministic_match(c.name, table)
        if found is not None:
            food_ids[i], sources[i] = found
            if found[1] == "alias":
                stats.alias_hits += 1
            else:
                stats.exact_hits += 1
            continue
        short = index.shortlist(c.name, c.state)
        if short:
            pending_food[i] = short
        else:
            misses[i] = "no_candidates"

    # Lines the model should also give a gram estimate for: the resolver cannot convert them
    # (a count with no matching FDC portion, a garbled amount). For a line still waiting on its
    # food the check uses no food, which only metric and spoon/cup amounts can pass.
    pending_grams: set[int] = set()
    for i, ing in enumerate(ingredients):
        if is_optional(ing) or is_salt_or_pepper_to_taste(ing):
            continue
        food = _food_of(table, food_ids[i])
        if food is None and i not in pending_food:
            continue
        if not line_grams(ing, food).needs_llm:
            continue
        stored = store.get_grams(grams_key(ing))
        if stored is not None:
            llm_grams[i] = stored
        else:
            pending_grams.add(i)

    asked = sorted({*pending_food, *pending_grams})
    if asked:
        _ask_llm(
            ingredients, asked, pending_food, pending_grams, food_ids, sources, misses, llm_grams,
            keys, table=table, store=store, adapter=adapter, guard=guard, stats=stats,
            model=model, now=now,
        )  # fmt: skip

    for i in range(n):
        if food_ids[i] is None and misses[i] is not None:
            stats.misses[misses[i] or ""] = stats.misses.get(misses[i] or "", 0) + 1
    resolutions = [
        LineResolution(food_ids[i], sources[i], llm_grams[i], misses[i])  # type: ignore[arg-type]
        for i in range(n)
    ]
    return resolutions, stats


def _ask_llm(
    ingredients: list[Ingredient],
    asked: list[int],
    pending_food: dict[int, list[Food]],
    pending_grams: set[int],
    food_ids: list[str | None],
    sources: list[str | None],
    misses: list[MissReason | None],
    llm_grams: list[float | None],
    keys: list[FoodKey],
    *,
    table: FoodTable,
    store: FoodMapStore,
    adapter: LLMAdapter | None,
    guard: SpendGuard,
    stats: MatchStats,
    model: str,
    now: Callable[[], datetime],
) -> None:
    """Make the recipe's one batched call and fold the answers into the line state."""
    lines: list[dict[str, Any]] = []
    for i in asked:
        entry: dict[str, Any] = {"idx": i, "line": _line(ingredients[i])}
        if i in pending_food:
            entry["candidates"] = [{"id": f.id, "name": f.name} for f in pending_food[i]]
        elif food_ids[i]:
            food = table.get(food_ids[i] or "")
            entry["matched_food"] = food.name if food else None
        entry["want_grams"] = i in pending_grams
        lines.append(entry)
    source_text = json.dumps(lines, ensure_ascii=False)
    fail: MissReason = "llm_failed"
    if adapter is not None:
        estimate = guard.estimate_inr(MATCH_PROMPT + source_text)
        if not guard.allows(estimate):
            fail = "spend_guard"
            stats.guard_refused = True
            adapter = None
    answers: dict[int, LineAnswer] = {}
    if adapter is not None:
        result = adapter.extract(
            prompt=MATCH_PROMPT,
            source_text=source_text,
            model=model,
            max_tokens=MAX_TOKENS,
            output_type=MatchProposal,
            effort="minimal",
        )
        stats.llm_calls += 1
        if result.usage is not None:
            stats.latency_ms += result.usage.latency_ms
            cost = call_cost_inr(result.usage)
            if cost is not None:
                stats.inr += cost
                guard.record(cost)
        if result.recipe is not None:
            answers = {a.idx: a for a in result.recipe.answers}
    stamp = now()
    for i in asked:
        answer = answers.get(i)
        if i in pending_food:
            if answer is None:
                misses[i] = fail
            elif answer.food_id is None:
                misses[i] = "llm_none"
                store.put_food(keys[i], None, model=model, now=stamp)
            elif answer.food_id not in {f.id for f in pending_food[i]}:
                misses[i] = "off_shortlist"
            else:
                food_ids[i], sources[i] = answer.food_id, "llm"
                stats.llm_matches += 1
                store.put_food(keys[i], answer.food_id, model=model, now=stamp)
        if i not in pending_grams:
            continue
        stats.grams_requested += 1
        # Keep the estimate only if the line still cannot be converted with its final food: a
        # food the model just chose may convert deterministically (then the estimate is unused).
        food = _food_of(table, food_ids[i])
        if answer is None or answer.grams is None or answer.grams <= 0 or food is None:
            continue
        if line_grams(ingredients[i], food).needs_llm:
            stats.grams_received += 1
            llm_grams[i] = answer.grams
            store.put_grams(grams_key(ingredients[i]), answer.grams, model=model, now=stamp)


def _line(ing: Ingredient) -> str:
    parts = [ing.qty_text or "", ing.unit or "", ing.name, ing.prep_note or ""]
    return " ".join(p.strip() for p in parts if p and p.strip())
