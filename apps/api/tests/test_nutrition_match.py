"""Matching: name cleaning, state-aware keys, the shortlist, and the one batched LLM call."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pydantic
import pytest
from nutrition_helpers import food, line, table

from abc_cook.extract.adapters.base import CallUsage, EffortLevel, ExtractResult
from abc_cook.nutrition.foods import FoodTable, load_foods
from abc_cook.nutrition.match import (
    CallRecord,
    FoodKey,
    InMemoryFoodMapStore,
    JsonFileFoodMapStore,
    LineAnswer,
    MatchProposal,
    ShortlistIndex,
    SpendGuard,
    candidates,
    carry_forward,
    clean_name,
    deterministic_match,
    deterministic_match_full,
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


# --- v3: batching, null carry-forward, blends, poha, dried state, spend callback -----------------


def test_a_shared_key_is_asked_once_and_every_line_takes_the_answer() -> None:
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    store = InMemoryFoodMapStore()
    lines = [line("kidney beans", "1", "cup"), line("kidney beans", "2", "tbsp")]
    resolutions, stats = _resolve(lines, adapter, store)
    assert [e["idx"] for e in adapter.calls[0]] == [0]  # one question for the one key
    assert [r.food_id for r in resolutions] == ["fdc:6", "fdc:6"]
    assert [r.food_source for r in resolutions] == ["llm", "llm"]
    assert stats.llm_matches == 2
    assert len(store.foods) == 1


def test_a_shared_key_that_gets_null_leaves_every_line_unmatched() -> None:
    adapter = FakeAdapter(lambda e: (None, None))
    lines = [line("kidney beans", "1", "cup"), line("kidney beans", "2", "tbsp")]
    resolutions, _ = _resolve(lines, adapter)
    assert [r.miss for r in resolutions] == ["llm_none", "llm_none"]


def test_a_follower_that_needs_grams_is_sent_but_its_food_answer_is_ignored() -> None:
    def respond(entry: dict[str, Any]) -> tuple[str | None, float | None]:
        # the follower (idx 1) gets a different food answer than the representative (idx 0)
        return ("fdc:6", None) if entry["idx"] == 0 else ("fdc:7", 120.0)

    adapter = FakeAdapter(respond)
    lines = [line("kidney beans", "1", "cup"), line("kidney beans", "2")]
    resolutions, _ = _resolve(lines, adapter)
    assert [r.food_id for r in resolutions] == ["fdc:6", "fdc:6"]
    assert resolutions[1].llm_grams == 120.0


def test_a_cached_null_is_carried_forward_and_not_asked_again() -> None:
    old = InMemoryFoodMapStore()
    old.put_food(FoodKey("kidney beans", None, "old-1"), None, model="m", now=NOW)
    old.put_food(FoodKey("cumin powder", None, "old-1"), "fdc:7", model="m", now=NOW)
    report = carry_forward(old, "old-1", T)
    assert (report.carried, report.null_carried, report.dropped) == (1, 1, [])
    carried = old.get_food(FoodKey("kidney beans", None, "test-1"))
    assert carried is not None
    assert carried["carried_from"] == "old-1"
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    resolutions, _ = _resolve([line("kidney beans", "1", "cup")], adapter, old)
    assert adapter.calls == []
    assert resolutions[0].miss == "cached_none"


def test_refresh_nulls_asks_a_cached_null_again_but_not_a_reviewed_one() -> None:
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("kidney beans", None, "test-1"), None, model="m", now=NOW)
    adapter = FakeAdapter(lambda e: ("fdc:6", None))
    resolutions, _ = resolve_recipe(
        [line("kidney beans", "1", "cup")],
        table=T,
        store=store,
        adapter=adapter,
        guard=SpendGuard(),
        now=lambda: NOW,
        refresh_nulls=True,
    )
    assert len(adapter.calls) == 1
    assert resolutions[0].food_id == "fdc:6"
    store.foods[FoodKey("kidney beans", None, "test-1").encode()] = {
        "food_id": None,
        "reviewed": True,
    }
    again = FakeAdapter(lambda e: ("fdc:6", None))
    second, _ = resolve_recipe(
        [line("kidney beans", "1", "cup")],
        table=T,
        store=store,
        adapter=again,
        guard=SpendGuard(),
        now=lambda: NOW,
        refresh_nulls=True,
    )
    assert again.calls == []
    assert second[0].miss == "cached_none"


def test_carry_forward_leaves_behind_what_curation_decides_or_the_table_lost() -> None:
    blocked = FoodTable.from_document(
        {
            "foods_version": "test-2",
            "no_food": ["chaat masala"],
            "shortlist_block": [{"names": ["poha"], "food_ids": ["fdc:30"]}],
            "foods": [
                food("30", "Groundcherries (poha), raw"),
                food("31", "Spices, curry powder", group="Spices and Herbs", aliases=["curry"]),
            ],
        }
    )
    store = InMemoryFoodMapStore()
    for name, food_id in [
        ("chaat masala", "fdc:31"),  # a blend now decided by curation
        ("curry", "fdc:31"),  # an alias now
        ("thick poha flakes", "fdc:30"),  # a food blocked for this name
        ("mystery", "fdc:99"),  # a food the new table lost
        ("kept", "fdc:31"),
    ]:
        store.put_food(FoodKey(name, None, "old-1"), food_id, model="m", now=NOW)
    report = carry_forward(store, "old-1", blocked)
    assert report.carried == 1
    assert dict(report.dropped) == {
        "chaat masala": "decided by curation now",
        "curry": "decided by curation now",
        "thick poha flakes": "fdc:30 is blocked for this name",
        "mystery": "fdc:99 not in the new table",
    }
    assert store.get_food(FoodKey("kept", None, "test-2")) is not None


def test_carry_forward_checks_macros_against_the_previous_table() -> None:
    previous = table(food("7", "Spices, cumin seed", group="Spices and Herbs", kcal=375))
    current = table(food("7", "Spices, cumin seed", group="Spices and Herbs", kcal=380))
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("cumin powder", None, "old-1"), "fdc:7", model="m", now=NOW)
    report = carry_forward(store, "old-1", current, previous)
    assert report.carried == 0
    assert report.dropped == [("cumin powder", "fdc:7 macros changed")]


BLENDS = FoodTable.from_document(
    {
        "foods_version": "test-1",
        "no_food": ["chaat masala", "natural charcoal"],
        "foods": [
            food("40", "Spices, curry powder", group="Spices and Herbs"),
            food("41", "Rice flakes (poha), dry", group="Cereal Grains and Pasta"),
        ],
    }
)


def test_a_blend_is_no_food_with_or_without_powder_and_a_cached_curry_pick_loses() -> None:
    assert deterministic_match("chaat masala powder", BLENDS) == (None, "no_food")
    assert deterministic_match("natural charcoal", BLENDS) == (None, "no_food")
    store = InMemoryFoodMapStore()
    store.put_food(FoodKey("chaat masala", None, "test-1"), "fdc:40", model="m", now=NOW)
    adapter = FakeAdapter(lambda e: ("fdc:40", None))
    resolutions, _ = resolve_recipe(
        [line("chaat masala", "1", "tsp"), line("chaat masala powder", "1", "tsp")],
        table=BLENDS,
        store=store,
        adapter=adapter,
        guard=SpendGuard(),
        now=lambda: NOW,
    )
    assert adapter.calls == []
    assert [r.miss for r in resolutions] == ["no_food_by_curation"] * 2


POHA = FoodTable.from_document(
    {
        "foods_version": "test-1",
        "shortlist_block": [{"names": ["poha", "beaten rice"], "food_ids": ["fdc:173043"]}],
        "foods": [
            food("173043", "Groundcherries, (cape-gooseberries or poha), raw", group="Fruits"),
            food(
                "proxy:poha",
                "Rice flakes (poha), dry",
                group="Cereal Grains and Pasta",
                aliases=["poha", "beaten rice"],
                reviewed=True,
                portions=[("cup", "", 60.0)],
            ),
        ],
    }
)


def test_poha_maps_to_the_proxy_and_the_groundcherry_row_never_shortlists() -> None:
    assert deterministic_match("poha", POHA) == ("proxy:poha", "alias")
    resolutions, _ = resolve_recipe(
        [line("poha", "2", "cups")],
        table=POHA,
        store=InMemoryFoodMapStore(),
        adapter=None,
        guard=SpendGuard(),
        now=lambda: NOW,
    )
    assert resolutions[0].food_id == "proxy:poha"
    assert resolutions[0].reviewed is True
    ids = [f.id for f in ShortlistIndex(POHA).shortlist("thick poha flakes", None)]
    assert "fdc:173043" not in ids
    assert "proxy:poha" in ids
    # words that name no blocked item still find the groundcherry row
    assert "fdc:173043" in [f.id for f in ShortlistIndex(POHA).shortlist("cape gooseberries", None)]


def test_dried_is_a_dry_state_but_the_name_keeps_the_written_word() -> None:
    for raw, name in [
        ("dried oregano", "dried oregano"),
        ("2 to 3 dry red chilies", "dry red chilies"),
        ("dried red chillies", "dried red chillies"),
    ]:
        cleaned = clean_name(raw)
        assert (cleaned.name, cleaned.state) == (name, "dry"), raw


def test_on_call_fires_before_any_store_write_and_carries_the_cost() -> None:
    store = InMemoryFoodMapStore()
    seen: list[tuple[int, CallRecord]] = []

    def on_call(record: CallRecord) -> None:
        seen.append((len(store.foods), record))

    resolve_recipe(
        [line("kidney beans", "1", "cup")],
        table=T,
        store=store,
        adapter=FakeAdapter(lambda e: ("fdc:6", None)),
        guard=SpendGuard(),
        now=lambda: NOW,
        on_call=on_call,
    )
    assert len(seen) == 1
    stored_at_call, record = seen[0]
    assert stored_at_call == 0  # the spend is on record before the mapping is saved
    assert record.cost_inr is not None
    assert record.cost_inr > 0
    assert (record.input_tokens, record.output_tokens, record.n_lines) == (1000, 200, 1)
    assert len(store.foods) == 1


def test_alias_and_cache_rows_report_whether_they_are_reviewed() -> None:
    reviewed_table = table(
        food("1", "Rice, white, raw", aliases=["rice"], reviewed=True),
        food("2", "Potatoes, raw", aliases=["potato"]),
        food("6", "Beans, kidney, raw"),
    )
    store = InMemoryFoodMapStore()
    store.foods[FoodKey("kidney beans", None, "test-1").encode()] = {
        "food_id": "fdc:6",
        "reviewed": True,
    }
    resolutions, _ = resolve_recipe(
        [line("rice", "1", "cup"), line("potato", "1"), line("kidney beans", "1", "cup")],
        table=reviewed_table,
        store=store,
        adapter=None,
        guard=SpendGuard(),
        now=lambda: NOW,
    )
    assert [r.reviewed for r in resolutions] == [True, False, True]
    assert [r.food_source for r in resolutions] == ["alias", "alias", "cache"]


# --- "A or B C" shares the head noun (B3.6) --------------------------------------------------

_OR_T = table(
    food("20", "Soup, chicken broth", aliases=["chicken broth"]),
    food("21", "Soup, vegetable broth", aliases=["vegetable broth"]),
    food("22", "Chicken, meat", aliases=["chicken"]),
    food("23", "Cheese, parmesan", aliases=["parmesan", "parmigiano reggiano"]),
    food("24", "Oil, vegetable", aliases=["oil"]),
    food("25", "Milk, whole", aliases=["milk"]),
    food("26", "Honey", aliases=["honey"]),
    food("27", "Syrup, maple", aliases=["maple syrup"]),
    food("28", "Beef, meat", aliases=["beef"]),
)


def test_a_or_b_c_tries_a_c_and_never_bare_a() -> None:
    assert deterministic_match("chicken or vegetable broth", _OR_T) == ("fdc:20", "alias")
    assert candidates("chicken or vegetable broth") == [
        "chicken or vegetable broth",
        "chicken broth",
        "vegetable broth",
    ]
    assert deterministic_match("parmesan or parmigiano reggiano", _OR_T) == ("fdc:23", "alias")


def test_a_or_b_c_with_neither_side_known_never_returns_bare_a() -> None:
    assert deterministic_match("beef or vegetable stock", _OR_T) is None
    assert "beef" not in candidates("beef or vegetable stock")


def test_a_or_b_c_falls_to_b_when_a_c_is_unknown() -> None:
    assert deterministic_match("honey or maple syrup", _OR_T) == ("fdc:27", "alias")


@pytest.mark.parametrize(
    "cleaned",
    [
        "oil or ghee for frying",  # B has a function word
        "milk or coconut milk",  # H == A
        "chinese cooking wine or mirin",  # A is three words
        "curd / yogurt or dahi",  # has a "/"
        "salt or pepper",  # B is one word
    ],
)
def test_the_shared_head_rule_does_not_fire(cleaned: str) -> None:
    parts = [p.strip() for p in re.split(r"\s*(?:/|,|\bor\b)\s*", cleaned) if p.strip()]
    assert candidates(cleaned)[: 1 + len(parts)] == [cleaned, *parts]


def test_oil_or_ghee_for_frying_still_finds_oil() -> None:
    assert deterministic_match("oil or ghee for frying", _OR_T) == ("fdc:24", "alias")


def test_the_real_table_maps_the_or_broth_line_to_chicken_broth() -> None:
    real = load_foods()
    found = deterministic_match_full("chicken or vegetable broth", real)
    assert found == ("fdc:172924", "alias", True)


def test_the_real_table_maps_unsweetened_shredded_coconut_to_desiccated() -> None:
    real = load_foods()
    cleaned = clean_name("unsweetened shredded coconut").name
    assert deterministic_match_full(cleaned, real) == ("fdc:170170", "alias", True)
