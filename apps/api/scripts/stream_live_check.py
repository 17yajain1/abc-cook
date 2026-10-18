r"""PR-S2a live check: two real streamed extraction calls, to confirm chunk shapes and pace.

Costs real money (about INR 1.3 for both recipes) and is capped at INR 5. It runs `normalize()`
through `DraftingAdapter(build_default_adapter())` on the frozen kadhi-pakora and croissant raw
acquisitions, so there is NO acquisition, NO YouTube and NO repair call. It stops at the first
failure and never retries beyond what `normalize()` itself does for an unparseable answer.

    python apps/api/scripts/stream_live_check.py --out notes/pr-s2-streamed-draft/live-check.json

Keys are loaded with python-dotenv from the main checkout's `apps/api/.env` and are never
printed. The output records, per recipe: the chunk shapes the SDK yielded (counts only, no
text), the finish_reason, the usage chunk and its reasoning tokens, and when the first content,
the ingredients, the first step, the complete step list and the end of the call were seen.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from dotenv import load_dotenv  # noqa: E402

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.adapters.base import ExtractResult  # noqa: E402
from abc_cook.extract.adapters.drafting import DraftingAdapter  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.normalize import normalize  # noqa: E402
from abc_cook.extract.pricing import call_cost_inr  # noqa: E402
from abc_cook.schema.api import StreamedDraft  # noqa: E402

ENV_FILE = Path(r"C:\Users\ashya\Music\ABC cook\apps\api\.env")
FIXTURES = API_ROOT / "tests" / "fixtures" / "import"
RECIPES = ["kadhi-pakora", "croissant"]
CAP_INR = 5.0


class _ShapeRecorder:
    """Wraps the SDK stream and counts the shapes of the chunks it yields. Never keeps text."""

    def __init__(self, stream: Any, shapes: Counter[str], notes: dict[str, Any]) -> None:
        self._stream = stream
        self._shapes = shapes
        self._notes = notes

    def __iter__(self) -> Any:
        for chunk in self._stream:
            self._shapes[self._shape(chunk)] += 1
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                details = getattr(usage, "completion_tokens_details", None)
                self._notes["usage_chunk"] = {
                    "choices": len(chunk.choices or []),
                    "prompt_tokens": usage.prompt_tokens,
                    "completion_tokens": usage.completion_tokens,
                    "reasoning_tokens": getattr(details, "reasoning_tokens", None),
                    "cached_tokens": getattr(
                        getattr(usage, "prompt_tokens_details", None), "cached_tokens", None
                    ),
                }
            for choice in chunk.choices or []:
                if choice.finish_reason is not None:
                    self._notes["finish_reason"] = choice.finish_reason
            yield chunk

    def close(self) -> None:
        self._stream.close()

    @staticmethod
    def _shape(chunk: Any) -> str:
        if not chunk.choices:
            return "usage-only (choices=[])" if chunk.usage is not None else "empty"
        choice = chunk.choices[0]
        delta = choice.delta
        parts = []
        if getattr(delta, "role", None):
            parts.append("role")
        if getattr(delta, "content", None):
            parts.append("content")
        elif getattr(delta, "content", None) == "":
            parts.append("content=''")
        if choice.finish_reason is not None:
            parts.append(f"finish_reason={choice.finish_reason}")
        if chunk.usage is not None:
            parts.append("usage")
        return "+".join(parts) or "empty-delta"


def _record_shapes(adapter: Any, shapes: Counter[str], notes: dict[str, Any]) -> None:
    """Route the OpenAI adapter's `create` through the shape recorder."""
    openai_adapter = adapter._by_model[next(iter(adapter._by_model))]
    original = openai_adapter._client.chat.completions.create

    def create(**kwargs: Any) -> Any:
        notes["request_keys"] = sorted(k for k in kwargs if k != "messages")
        return _ShapeRecorder(original(**kwargs), shapes, notes)

    openai_adapter._client.chat.completions.create = create


def run_recipe(name: str, spent: float) -> dict[str, Any]:
    """One real call through `normalize()`; returns its measurements."""
    raw = RawAcquisition.model_validate_json(
        (FIXTURES / f"{name}.raw.json").read_text(encoding="utf-8")
    )
    inner = build_default_adapter()
    shapes: Counter[str] = Counter()
    notes: dict[str, Any] = {}
    _record_shapes(inner, shapes, notes)

    marks: dict[str, float] = {}
    started = time.monotonic()

    def on_draft(draft: StreamedDraft) -> None:
        now = time.monotonic() - started
        if draft.ingredients is not None:
            marks.setdefault("ingredients_s", now)
        if draft.steps:
            marks.setdefault("first_step_s", now)
        if draft.steps_complete:
            marks.setdefault("steps_complete_s", now)

    class _Capped:
        """Refuses a call once the cap is reached, so a surprise retry cannot overspend."""

        streams_text = True

        def __init__(self) -> None:
            self.spent = spent

        def extract(self, **kwargs: Any) -> ExtractResult[Any]:
            if self.spent >= CAP_INR:
                return ExtractResult(recipe=None, error="spend cap reached", error_kind="infra")
            result: ExtractResult[Any] = inner.extract(**kwargs)
            if result.usage is not None:
                self.spent += call_cost_inr(result.usage) or 0.0
            return result

    capped = _Capped()
    adapter = DraftingAdapter(capped, on_draft, graph_id=f"live-{name}")  # type: ignore[arg-type]
    outcome = normalize(raw, adapter)
    elapsed = time.monotonic() - started
    calls = outcome.calls
    first = calls[0] if calls else None
    return {
        "recipe": name,
        "ok": outcome.recipe is not None,
        "tier0": None if outcome.tier0_result is None else outcome.tier0_result.status,
        "calls": len(calls),
        "total_s": round(elapsed, 2),
        "first_content_s": None
        if first is None or first.first_content_ms is None
        else round(first.first_content_ms / 1000, 2),
        **{k: round(v, 2) for k, v in marks.items()},
        "stop_reason": None if first is None else first.stop_reason,
        "reasoning_tokens": None if first is None else first.reasoning_tokens,
        "output_tokens": None if first is None else first.output_tokens,
        "input_tokens": None if first is None else first.input_tokens,
        "cost_inr": round(capped.spent - spent, 2),
        "chunk_shapes": dict(shapes),
        "notes": notes,
        "recipe_ingredients": None if outcome.recipe is None else len(outcome.recipe.ingredients),
        "recipe_steps": None if outcome.recipe is None else len(outcome.recipe.steps),
    }


def main() -> None:
    """Run both recipes, stopping at the first failure or at the cap."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    load_dotenv(ENV_FILE)  # keys stay in the environment; nothing below prints them

    rows: list[dict[str, Any]] = []
    spent = 0.0
    for name in RECIPES:
        print(f"live call: {name}", flush=True)
        row = run_recipe(name, spent)
        spent += row["cost_inr"]
        rows.append(row)
        print(json.dumps({k: v for k, v in row.items() if k != "notes"}, indent=2), flush=True)
        if not row["ok"] or spent >= CAP_INR:
            print("stopping at the first failure (or the cap)", flush=True)
            break
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps({"cap_inr": CAP_INR, "spent_inr": round(spent, 2), "rows": rows}, indent=2),
        encoding="utf-8",
    )
    print(f"spent INR {spent:.2f} of the INR {CAP_INR:.0f} cap")


if __name__ == "__main__":
    main()
