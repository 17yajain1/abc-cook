"""Matching: name cleaning, state-aware keys, the shortlist, and the one batched LLM call."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pydantic
import pytest
from nutrition_helpers import food, line, table

from abc_cook.extract.adapters.base import CallUsage, EffortLevel, ExtractResult
from abc_cook.nutrition.foods import FoodTable
from abc_cook.nutrition.match import (
    FoodKey,
    InMemoryFoodMapStore,
    JsonFileFoodMapStore,
    LineAnswer,
    MatchProposal,
    ShortlistIndex,
    SpendGuard,
    clean_name,
    deterministic_match,
    resolve_recipe,
)

NOW = datetime(2026, 10, 26, tzinfo=UTC)
T = table(
    food("1", "Rice, white, long-grain, raw", group="Cereal Grains and Pasta", aliases=["rice"]),
    food(
        "2",
        "Rice, white, long-grain, cooked",
        group="Cereal Grains and Pasta",
        aliases=["cooked rice"],
    ),
    food("3", "Potatoes, flesh and skin, raw", aliases=["potato"]),
    food("4", "Potatoes, boiled, cooked without skin", aliases=["boiled potato"]),
    food(
        "5", "Yogurt, plain, whole milk", group="Dairy and Egg Products", aliases=["dahi", "curd"]
    ),
    food("6", "Beans, kidney, all types, mature seeds, raw", group="Legumes and Legume Products"),
    food("7", "Spices, cumin seed", group="Spices and Herbs"),
    food("8", "Spices, coriander seed", group="Spices and Herbs"),
    food("9", "Onions, raw", aliases=["onion"], portions=[("medium", "", 110.0)]),
    food(
        "10",
        "Chicken, broilers or fryers, thigh, meat only, raw",
        group="Poultry Products",
        veg="non_veg",
    ),
)


class FakeAdapter:
    """Answers each asked line by calling `respond(entry) -> (food_id, grams)`."""

    def __init__(
        self, respond: Callable[[dict[str, Any]], tuple[str | None, float | None]] | None
    ) -> None:
        self.respond = respond
        self.calls: list[list[dict[str, Any]]] = []

    def extract[R: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[R],
        effort: EffortLevel | None = None,
    ) -> ExtractResult[R]:
        entries = json.loads(source_text)
        self.calls.append(entries)
        if self.respond is None:
            return ExtractResult(recipe=None, error="boom", error_kind="infra")
        answers = []
        for entry in entries:
            food_id, grams = self.respond(entry)
            answers.append(LineAnswer(idx=entry["idx"], food_id=food_id, grams=grams))
        usage = CallUsage(
            model="gpt-5-mini",
            input_tokens=1000,
            output_tokens=200,
            cache_read_input_tokens=None,
            cache_creation_input_tokens=None,
            stop_reason="stop",
            latency_ms=700.0,
            max_tokens_requested=max_tokens,
        )
        proposal = MatchProposal(answers=answers)
        assert isinstance(proposal, output_type)
        return ExtractResult(recipe=proposal, usage=usage)  # type: ignore[arg-type]


def _resolve(
    lines: list[Any],
    adapter: FakeAdapter | None,
    store: InMemoryFoodMapStore | None = None,
    guard: SpendGuard | None = None,
) -> tuple[list[Any], Any]:
    return resolve_recipe(
        lines,
        table=T,
        store=store or InMemoryFoodMapStore(),
        adapter=adapter,
        guard=guard or SpendGuard(),
        now=lambda: NOW,
    )


# --- name cleaning and keys --------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "name", "state"),
    [
        # canned is read from the raw name, parentheticals included (b3-plan 2B); the old v1
        # expectation here was state None
        ("rajma ((200 grams dry kidney beans or 2 canned beans (3 cups)))", "rajma", "canned"),
        ("Onion (finely chopped)", "onion", None),
        ("finely chopped parsley", "parsley", None),
        ("boiled potatoes", "boiled potatoes", "boiled"),
        ("cooked white rice", "cooked white rice", "cooked"),
        ("potato (boiled & mashed)", "potato", None),  # a parenthetical is not the line's state
        ("1 cup rice", "rice", None),
        ("canned tomatoes", "canned tomatoes", "canned"),
        ("dry roasted peanuts", "dry roasted peanuts", "dry"),
        ("Water (വെള്ളം)", "water", None),
    ],
)
def test_clean_name_keeps_the_state_word(raw: str, name: str, state: str | None) -> None:
    cleaned = clean_name(raw)
    assert (cleaned.name, cleaned.state) == (name, state)


def test_boiled_potato_and_potato_do_not_share_a_key_or_a_match() -> None:
    boiled, plain = clean_name("boiled potato"), clean_name("potato")
    assert (
        FoodKey(boiled.name, boiled.state, "v").encode()
        != FoodKey(plain.name, plain.state, "v").encode()
    )
    assert deterministic_match(boiled.name, T) == ("fdc:4", "alias")
    assert deterministic_match(plain.name, T) == ("fdc:3", "alias")
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("boiled potato", "boiled", "test-1"), "fdc:4", model="m", now=NOW)
    assert store.get_food(FoodKey("potato", None, "test-1")) is None


def test_deterministic_match_tries_alternatives_and_singulars() -> None:
    assert deterministic_match("dahi / curd", T) == ("fdc:5", "alias")
    assert deterministic_match("curds", T) == ("fdc:5", "alias")
    assert deterministic_match("rice, white, long-grain, raw", T) == ("fdc:1", "exact")
    assert deterministic_match("garam masala", T) is None


# --- the shortlist -----------------------------------------------------------------------------


def test_shortlist_prefers_raw_unless_the_line_says_cooked() -> None:
    index = ShortlistIndex(T)
    assert index.shortlist("white rice", None)[0].id == "fdc:1"
    assert index.shortlist("white rice", "cooked")[0].id == "fdc:2"


def test_shortlist_includes_alias_neighbours() -> None:
    index = ShortlistIndex(T)
    ids = [f.id for f in index.shortlist("dahi", None)]
    assert "fdc:5" in ids
    assert index.shortlist("zzzz", None) == []


def test_shortlist_is_capped() -> None:
    many = table(*[food(str(i), f"Beans, type {i}") for i in range(60)])
    assert len(ShortlistIndex(many).shortlist("beans", None)) == 25


# --- resolve_recipe ----------------------------------------------------------------------------


def test_deterministic_lines_make_no_llm_call() -> None:
    adapter = FakeAdapter(lambda e: (None, None))
    resolutions, stats = _resolve([line("rice", "1", "cup"), line("curd", "2", "tbsp")], adapter)
    assert adapter.calls == []
    assert [r.food_id for r in resolutions] == ["fdc:1", "fdc:5"]
    assert stats.alias_hits == 2
    assert stats.llm_calls == 0


def test_all_misses_go_in_one_call_and_valid_ids_are_accepted_and_cached() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:7", None) if "cumin" in e["line"] else ("fdc:6", None))
    store = InMemoryFoodMapStore()
    lines = [
        line("cumin powder", "1", "tsp"),
        line("red kidney beans", "1", "cup"),
        line("rice", "1", "cup"),
    ]
    resolutions, stats = _resolve(lines, adapter, store)
    assert len(adapter.calls) == 1
    assert {entry["idx"] for entry in adapter.calls[0]} == {0, 1}
    assert [r.food_id for r in resolutions] == ["fdc:7", "fdc:6", "fdc:1"]
    assert resolutions[0].food_source == "llm"
    assert stats.llm_matches == 2
    assert stats.inr > 0
    assert stats.latency_ms == 700.0
    row = store.get_food(FoodKey("cumin powder", None, "test-1"))
    assert row is not None
    assert (row["food_id"], row["model"], row["basis"], row["reviewed"]) == (
        "fdc:7",
        "gpt-5-mini",
        "llm",
        False,
    )
    # a second run hits the cache: zero calls
    again = FakeAdapter(lambda e: (None, None))
    second, stats2 = _resolve(lines, again, store)
    assert again.calls == []
    assert [r.food_id for r in second] == ["fdc:7", "fdc:6", "fdc:1"]
    assert stats2.cache_hits == 2


def test_an_id_outside_the_shortlist_is_rejected() -> None:
    # fdc:10 (chicken) is a real food but not among the candidates for "kidney beans"
    adapter = FakeAdapter(lambda e: ("fdc:10", None))
    resolutions, stats = _resolve([line("kidney beans", "1", "cup")], adapter)
    assert resolutions[0].food_id is None
    assert resolutions[0].miss == "off_shortlist"
    assert stats.misses == {"off_shortlist": 1}
    ids = {c["id"] for c in adapter.calls[0][0]["candidates"]}
    assert "fdc:10" not in ids
    assert "fdc:6" in ids


def test_a_null_answer_is_a_miss_and_is_remembered() -> None:
    adapter = FakeAdapter(lambda e: (None, None))
    store = InMemoryFoodMapStore()
    resolutions, _ = _resolve([line("kidney beans", "1", "cup")], adapter, store)
    assert resolutions[0].miss == "llm_none"
    again = FakeAdapter(lambda e: ("fdc:6", None))
    second, _ = _resolve([line("kidney beans", "1", "cup")], again, store)
    assert again.calls == []
    assert second[0].miss == "cached_none"


def test_a_line_with_no_candidates_is_not_sent_to_the_model() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    resolutions, _ = _resolve([line("garam masala", "1", "tsp")], adapter)
    assert adapter.calls == []
    assert resolutions[0].miss == "no_candidates"


def test_a_failed_call_leaves_lines_unmatched_without_raising() -> None:
    resolutions, stats = _resolve([line("kidney beans", "1", "cup")], FakeAdapter(None))
    assert resolutions[0].food_id is None
    assert resolutions[0].miss == "llm_failed"
    assert stats.llm_calls == 1
    no_adapter, _ = _resolve([line("kidney beans", "1", "cup")], None)
    assert no_adapter[0].miss == "llm_failed"


def test_the_spend_guard_refuses_a_call_that_would_pass_the_cap() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    guard = SpendGuard(cap_inr=0.01)
    resolutions, stats = _resolve([line("kidney beans", "1", "cup")], adapter, guard=guard)
    assert adapter.calls == []
    assert resolutions[0].miss == "spend_guard"
    assert stats.guard_refused
    assert guard.spent_inr == 0.0


def test_the_spend_guard_adds_up_measured_cost() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    guard = SpendGuard(cap_inr=40.0)
    _resolve([line("kidney beans", "1", "cup")], adapter, guard=guard)
    assert 0 < guard.spent_inr < 1
    assert guard.estimate_inr("x" * 400) > 0


def test_a_reviewed_row_is_never_overwritten() -> None:
    store = InMemoryFoodMapStore()
    key = FoodKey("kidney beans", None, "test-1")
    store.foods[key.encode()] = {
        "food_id": "fdc:6",
        "model": None,
        "date": "x",
        "basis": "human",
        "reviewed": True,
    }
    store.put_food(key, "fdc:7", model="gpt-5-mini", now=NOW)
    store.put_food(key, None, model="gpt-5-mini", now=NOW)
    row = store.get_food(key)
    assert row is not None
    assert row["food_id"] == "fdc:6"
    assert row["reviewed"] is True


def test_a_gram_estimate_is_requested_for_a_count_the_resolver_cannot_convert() -> None:
    def respond(entry: dict[str, Any]) -> tuple[str | None, float | None]:
        assert entry["want_grams"] is True
        return None, 6.0

    adapter = FakeAdapter(respond)
    store = InMemoryFoodMapStore()
    # onions have no sprig portion: the resolver cannot convert "2 sprigs"
    resolutions, stats = _resolve([line("onion", "2", "sprigs")], adapter, store)
    assert resolutions[0].food_id == "fdc:9"
    assert resolutions[0].llm_grams == 6.0
    assert stats.grams_received == 1
    # cached by the whole line, so the next run asks nothing
    again = FakeAdapter(lambda e: (None, 99.0))
    second, _ = _resolve([line("onion", "2", "sprigs")], again, store)
    assert again.calls == []
    assert second[0].llm_grams == 6.0


def test_no_gram_estimate_is_asked_for_a_line_the_resolver_converts() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    resolutions, _ = _resolve([line("kidney beans", "200", "g")], adapter)
    assert adapter.calls[0][0]["want_grams"] is False
    assert resolutions[0].llm_grams is None


def test_optional_and_salt_to_taste_lines_get_no_gram_request() -> None:
    adapter = FakeAdapter(lambda e: (None, 5.0))
    lines = [line("onion (optional)", "2", "sprigs"), line("onion", "to taste")]
    resolutions, _ = _resolve(lines, adapter)
    assert adapter.calls == []
    assert resolutions[0].llm_grams is None


def test_json_file_store_round_trips(tmp_path: Path) -> None:
    path = tmp_path / "data" / "food_map.json"
    store = JsonFileFoodMapStore(path)
    key = FoodKey("kidney beans", None, "test-1")
    store.put_food(key, "fdc:6", model="gpt-5-mini", now=NOW)
    store.put_grams("abc", 12.5, model="gpt-5-mini", now=NOW)
    reloaded = JsonFileFoodMapStore(path)
    row = reloaded.get_food(key)
    assert row is not None
    assert row["food_id"] == "fdc:6"
    assert reloaded.get_grams("abc") == 12.5
    assert json.loads(path.read_text(encoding="utf-8"))["foods"]


# --- v2: canned state (b3-plan 2B) -------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "name", "state"),
    [
        ("14 oz / 420g can red kidney beans", "canned red kidney beans", "canned"),
        ("1 can of chickpeas", "canned chickpeas", "canned"),
        ("large can tomatoes", "canned tomatoes", "canned"),
        ("2 cans coconut milk", "canned coconut milk", "canned"),
        ("tomatoes (can)", "tomatoes canned", "canned"),
        ("tinned sweetcorn", "tinned sweetcorn", "canned"),
        ("2 tomatoes (you can use canned or fresh)", "tomatoes", "canned"),
        ("1 cup oil (can use ghee)", "oil", None),
        ("fresh spinach (you can use frozen)", "spinach", None),
        ("cane sugar", "cane sugar", None),
    ],
)
def test_can_is_canned_only_as_a_container(raw: str, name: str, state: str | None) -> None:
    cleaned = clean_name(raw)
    assert (cleaned.name, cleaned.state) == (name, state)


@pytest.mark.parametrize(
    ("raw", "before", "name", "state"),
    [
        # the real field layout: the amount is in qty_text, the container word starts the name
        ("can red kidney beans", "14 oz / 420g", "canned red kidney beans", "canned"),
        ("can crushed tomato", "800g / 28 oz", "canned crushed tomato", "canned"),
        ("can chickpeas", "1", "canned chickpeas", "canned"),
        ("chickpeas", "1 can", "chickpeas", "canned"),
        ("can coconut milk", "large", "canned coconut milk", "canned"),
        # no amount or size next to a leading "can": not a container
        ("can red kidney beans", "", "can red kidney beans", None),
        ("can use ghee", "1", "can use ghee", None),
        ("canola oil", "1 tbsp", "canola oil", None),
        ("cayenne pepper", "1 - 2 tsp", "cayenne pepper", None),
    ],
)
def test_clean_name_reads_the_amount_beside_the_name(
    raw: str, before: str, name: str, state: str | None
) -> None:
    cleaned = clean_name(raw, before=before)
    assert (cleaned.name, cleaned.state) == (name, state)


def test_resolve_recipe_keys_a_can_line_as_canned() -> None:
    store = InMemoryFoodMapStore()
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    lines = [line("can red kidney beans", "14 oz / 420g")]
    _resolve(lines, adapter, store)
    assert store.get_food(FoodKey("canned red kidney beans", "canned", "test-1")) is not None
    assert store.get_food(FoodKey("can red kidney beans", None, "test-1")) is None


# --- v2: null gram answers are cached ----------------------------------------------------------


def test_a_null_gram_answer_is_cached_so_the_second_run_makes_no_call() -> None:
    adapter = FakeAdapter(lambda e: (None, None))
    store = InMemoryFoodMapStore()
    lines = [line("onion", "2", "sprigs")]
    first, stats = _resolve(lines, adapter, store)
    assert len(adapter.calls) == 1
    assert first[0].food_id == "fdc:9"
    assert first[0].llm_grams is None
    assert stats.grams_requested == 1
    again = FakeAdapter(lambda e: (None, 99.0))
    second, stats2 = _resolve(lines, again, store)
    assert again.calls == []
    assert second[0].llm_grams is None
    assert stats2.llm_calls == 0


def test_a_failed_call_does_not_cache_a_null_gram_answer() -> None:
    store = InMemoryFoodMapStore()
    lines = [line("onion", "2", "sprigs")]
    _resolve(lines, FakeAdapter(None), store)
    assert store.grams == {}
    retry = FakeAdapter(lambda e: (None, 6.0))
    second, _ = _resolve(lines, retry, store)
    assert len(retry.calls) == 1
    assert second[0].llm_grams == 6.0


def test_json_store_round_trips_a_null_gram_answer(tmp_path: Path) -> None:
    path = tmp_path / "food_map.json"
    store = JsonFileFoodMapStore(path)
    assert not store.has_grams("k")
    store.put_grams("k", None, model="gpt-5-mini", now=NOW)
    reloaded = JsonFileFoodMapStore(path)
    assert reloaded.has_grams("k")
    assert reloaded.get_grams("k") is None


# --- v2: curation beats the cache (b3-plan, matcher order) -------------------------------------

CURATED = FoodTable.from_document(
    {
        "foods_version": "test-1",
        "no_food": ["kasuri methi", "dried fenugreek leaves"],
        "foods": [
            food("20", "Spices, fenugreek seed", group="Spices and Herbs"),
            food("21", "Ginger root, raw", aliases=["ginger garlic paste"]),
        ],
    }
)


def _resolve_curated(lines: list[Any], store: InMemoryFoodMapStore) -> tuple[list[Any], Any]:
    return resolve_recipe(
        lines,
        table=CURATED,
        store=store,
        adapter=FakeAdapter(lambda e: ("fdc:20", None)),
        guard=SpendGuard(),
        now=lambda: NOW,
    )


def test_no_food_is_unmatched_without_a_call_and_beats_a_cached_pick() -> None:
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("kasuri methi", None, "test-1"), "fdc:20", model="m", now=NOW)
    adapter = FakeAdapter(lambda e: ("fdc:20", None))
    resolutions, stats = resolve_recipe(
        [line("kasuri methi", "1", "tsp"), line("dried fenugreek leaves", "1", "tsp")],
        table=CURATED,
        store=store,
        adapter=adapter,
        guard=SpendGuard(),
        now=lambda: NOW,
    )
    assert adapter.calls == []
    assert [r.food_id for r in resolutions] == [None, None]
    assert [r.miss for r in resolutions] == ["no_food_by_curation", "no_food_by_curation"]
    assert stats.misses == {"no_food_by_curation": 2}
    assert deterministic_match("kasuri methi", CURATED) == (None, "no_food")


def test_an_alias_beats_a_cached_null() -> None:
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("ginger garlic paste", None, "test-1"), None, model="m", now=NOW)
    resolutions, stats = _resolve_curated([line("ginger garlic paste", "1", "tbsp")], store)
    assert resolutions[0].food_id == "fdc:21"
    assert resolutions[0].food_source == "alias"
    assert stats.cache_hits == 0


def test_a_cached_pick_still_serves_a_name_with_no_deterministic_result() -> None:
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("kidney beans", None, "test-1"), "fdc:6", model="m", now=NOW)
    resolutions, stats = _resolve([line("kidney beans", "1", "cup")], FakeAdapter(None), store)
    assert resolutions[0].food_id == "fdc:6"
    assert stats.cache_hits == 1
