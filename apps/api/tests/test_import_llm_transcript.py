"""M2.10 Checkpoint 2: real end-to-end runs of the caption-leg fixtures through
`run_import`, real Anthropic adapter, real everything downstream of acquisition (the
frozen `RawAcquisition` fixtures stand in for the network fetch so this doesn't also
depend on yt-dlp/YouTube availability -- `test_acquire.py`'s `network`-marked tests
already cover the live fetch path).

Excluded from the default run (`make test` -> `-m "not llm and not network"`).
Assertions are invariants only (COOKING_GRAPH.md §7) -- never exact LLM output; the
printed output is what the Checkpoint 2 report is built from, not a substitute for it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.import_pipeline import run_import
from abc_cook.extract.normalize import render_source_text
from abc_cook.extract.validate import validate

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"

CAPTION_FIXTURES = ["captions-auto-hi", "captions-manual-en", "captions-auto-en-long"]
_STOPWORDS = {"a", "an", "the", "of", "for", "and", "to"}
_WORD = re.compile(r"[a-z0-9]+")


def _load_raw(slug: str) -> RawAcquisition:
    data = json.loads((FIXTURES_DIR / f"{slug}.raw.json").read_text(encoding="utf-8"))
    return RawAcquisition.model_validate(data)


@pytest.mark.llm
@pytest.mark.parametrize("slug", CAPTION_FIXTURES)
def test_caption_fixture_reaches_done_with_a_grounded_graph(slug: str) -> None:
    """The three bucket-C-with-captions fixtures must now produce a real plan --
    this is the whole point of M2.10. Whatever the model returns, print it: the
    Checkpoint 2 report is a human read of this output, not just these assertions.

    M2.11: uses the real production adapter (`build_default_adapter` -- GPT-5-mini
    extracts, Sonnet repairs if needed), not a hardcoded single-provider adapter, so
    this test exercises the actual pipeline wiring, not a stale one."""
    from abc_cook.extract.adapters.routing import build_default_adapter

    raw = _load_raw(slug)
    adapter = build_default_adapter()
    result = run_import(
        raw.source_url, adapter, graph_id=f"g_{slug}_llm_test", acquire_fn=lambda url: raw
    )

    print(f"\n=== {slug} ===")
    print("status:", result.status)
    print("sources:", result.sources)
    print("warnings:", result.warnings)
    print("review_recommended:", result.review_recommended)
    print(f"ingredients ({len(result.ingredients)}):", [i.name for i in result.ingredients])

    assert result.status == "done"
    assert "transcript" in result.sources
    assert result.graph is not None
    assert len(result.graph.nodes) >= 5
    assert validate(result.graph) == []

    # Flag (don't hard-fail) ingredients whose words don't literally appear in the
    # source: a real transcript is auto-transcribed/phonetic ("tuttie fruttie" for
    # "tutti frutti", "Rose water/Keora water" split by a slash) and the model
    # legitimately normalizes spelling -- that's not the invention this prompt
    # forbids, but nor is a fuzzy word match reliable enough to assert on (real
    # spelling drift and real hallucination look the same to it). This is exactly
    # the "hand check" the Checkpoint 2 report calls for: print it, verify by eye.
    corpus_words = set(_WORD.findall(render_source_text(raw).lower()))
    ungrounded = []
    for ingredient in result.ingredients:
        words = [w for w in _WORD.findall(ingredient.name.lower()) if w not in _STOPWORDS]
        missing = [w for w in words if w not in corpus_words]
        if missing:
            ungrounded.append((ingredient.name, missing))
    print("ingredients needing a hand check:", ungrounded)

    # graph.py's _verify_attention (LOCKED DECISION 4) can only leave a node at
    # periodic/unattended if it independently found the cue grounded in the source --
    # any node that failed that check is forced back to hands_on/"defaulted". So a
    # non-hands_on node with fields["attention"] != "extracted" would mean the forcing
    # logic itself broke; this is a real invariant, not a tautology.
    assert result.provenance is not None
    for node in result.graph.nodes:
        if node.attention != "hands_on":
            assert result.provenance.nodes[node.id].fields["attention"] == "extracted"

    attention_counts: dict[str, int] = {}
    for node in result.graph.nodes:
        attention_counts[node.attention] = attention_counts.get(node.attention, 0) + 1
    print("attention distribution:", attention_counts)
    print(f"steps ({len(result.graph.nodes)}):")
    for node in result.graph.nodes:
        print(f"  [{node.attention:>10}] {node.label}: {node.instruction}")

    assert result.plan is not None
    print(
        f"plan: total_min={result.plan.total_min} serial_min={result.plan.serial_min} "
        f"saved_min={result.plan.saved_min} windows={len(result.plan.windows)}"
    )
    for window in result.plan.windows:
        print(
            f"  window host={window.host_node_id} capacity={window.capacity_min} "
            f"assigned={window.assigned} used={window.used_min} slack={window.slack_min}"
        )


@pytest.mark.llm
def test_no_captions_fixture_stays_tier_0() -> None:
    """Rasmalai: a silent video with no caption track. Must still refuse honestly --
    M2.10 must not weaken the Tier 0 gate for the one bucket-C case with nothing to
    ground a method in."""
    from abc_cook.extract.adapters.routing import build_default_adapter

    raw = _load_raw("no-captions")
    adapter = build_default_adapter()
    result = run_import(
        raw.source_url, adapter, graph_id="g_no_captions_llm_test", acquire_fn=lambda url: raw
    )

    print("\n=== no-captions ===")
    print("status:", result.status)
    print("sources:", result.sources)
    print("ingredients:", [i.name for i in result.ingredients])

    assert result.status == "method_not_grounded"
    assert "transcript" not in result.sources
    assert result.ingredients  # the shopping list still survives Tier 0
    assert result.graph is None
