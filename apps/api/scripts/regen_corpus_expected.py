"""Regenerate the corpus replay snapshots (`tests/fixtures/import/<slug>.replay-expected.json`).

`tests/test_corpus_replay.py` replays each frozen `<slug>.original.json` through
`reprocess()` and compares the result to its `<slug>.replay-expected.json`. A diff there is a
product decision, not a test fix, so the snapshot is rewritten only by this script, run by hand:

    PYTHONPATH=apps/api python apps/api/scripts/regen_corpus_expected.py

Review `git diff` of the snapshots before committing. Every `known_issues` list is preserved
from the existing file (it is edited by hand, with ids from `docs/plans/followup-golden-corpus.md`).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from abc_cook.extract.postprocess import reprocess
from abc_cook.schema.normalized import ImportOriginal

FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "import"

SLUGS = ["kadhi-pakora", "croissant", "pumpkin-pancakes"]

# Only used the first time a snapshot is written; afterwards the file's own list wins.
INITIAL_KNOWN_ISSUES: dict[str, list[str]] = {
    "kadhi-pakora": ["FGC-5", "FGC-6"],
    "croissant": ["FGC-7"],
    "pumpkin-pancakes": ["FGC-4"],
}


def expected_path(slug: str) -> Path:
    """Path of a recipe's frozen snapshot."""
    return FIXTURES / f"{slug}.replay-expected.json"


def load_original(slug: str) -> ImportOriginal:
    """Load a recipe's frozen `ImportOriginal`."""
    return ImportOriginal.model_validate_json(
        (FIXTURES / f"{slug}.original.json").read_text(encoding="utf-8")
    )


def build_snapshot(slug: str, known_issues: list[str]) -> dict[str, Any]:
    """Replay a recipe offline and reduce it to the fields the owner reviews.

    Node identity is the label (unique within each corpus recipe; asserted here), so the
    snapshot reads in plain words: labels, edges, durations with their provenance, windows
    with their assigned order, totals and sittings.

    Args:
        slug: Fixture basename.
        known_issues: Follow-up ids naming flagged nodes in this recipe.

    Returns:
        A JSON-ready dict.
    """
    out = reprocess(load_original(slug)).result
    graph, plan, summary, provenance = out.graph, out.plan, out.summary, out.provenance
    assert graph is not None
    assert plan is not None
    assert summary is not None
    assert provenance is not None
    label = {n.id: n.label for n in graph.nodes}
    assert len(set(label.values())) == len(label), f"{slug}: node labels are not unique"
    scheduled = {s.node_id: s for s in plan.scheduled}
    nodes = []
    for n in sorted(
        graph.nodes, key=lambda n: (scheduled[n.id].start_min, scheduled[n.id].end_min)
    ):
        nodes.append(
            {
                "label": n.label,
                "kind": n.kind,
                "attention": n.attention,
                "station": n.station,
                "duration_min": n.duration_min,
                "duration_typical": n.duration_typical,
                "duration_max": n.duration_max,
                "duration_source": provenance.nodes[n.id].fields["duration"],
                "depends_on": [label[d] for d in n.depends_on],
                "start_min": scheduled[n.id].start_min,
                "window": scheduled[n.id].window_id,
            }
        )
    return {
        "slug": slug,
        "known_issues": known_issues,
        "repair_applied": out.original.repair is not None if out.original else False,
        "nodes": nodes,
        "windows": [
            {
                "id": w.id,
                "host": label[w.host_node_id],
                "assigned": [label[i] for i in w.assigned],
                "capacity_min": w.capacity_min,
                "used_min": w.used_min,
                "slack_min": w.slack_min,
            }
            for w in plan.windows
        ],
        "totals": {
            "total_min": plan.total_min,
            "serial_min": plan.serial_min,
            "saved_min": plan.saved_min,
            "active_min": summary.active_min,
            "elapsed_min": summary.elapsed_min,
            "elapsed_high_min": summary.elapsed_high_min,
        },
        "sessions": [
            {
                "start_min": s.start_min,
                "end_min": s.end_min,
                "active_min": s.active_min,
                "preceded_by_wait_min": s.preceded_by_wait_min,
                "nodes": [label[i] for i in s.node_ids],
            }
            for s in summary.sessions
        ],
        "long_waits": len(summary.long_waits),
    }


def current_known_issues(slug: str) -> list[str]:
    """The known-issue ids on disk, or the initial seed for a new snapshot."""
    path = expected_path(slug)
    if path.exists():
        return list(json.loads(path.read_text(encoding="utf-8"))["known_issues"])
    return INITIAL_KNOWN_ISSUES.get(slug, [])


def main() -> None:
    """Rewrite every snapshot from the current code."""
    for slug in SLUGS:
        snap = build_snapshot(slug, current_known_issues(slug))
        expected_path(slug).write_text(
            json.dumps(snap, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
        )
        print(f"wrote {expected_path(slug).name}")


if __name__ == "__main__":
    main()
