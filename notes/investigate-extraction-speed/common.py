"""Shared scratch helpers for the extraction-speed investigation. Scratch only.

Run every script from the repo root with PYTHONPATH=apps/api. Keys come from the main
checkout's .env via python-dotenv and are never printed.
"""

from __future__ import annotations

import io
import json
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(r"C:\Users\ashya\Music\ABC cook\apps\api\.env")
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        pass

REPO = Path(__file__).resolve().parents[2]
FIX = REPO / "apps" / "api" / "tests" / "fixtures" / "import"
OUT = Path(__file__).resolve().parent
RAW = OUT / "raw"
RAW.mkdir(exist_ok=True)

# slug -> (raw fixture path, golden/diff reference path or None)
INPUTS: dict[str, tuple[Path, Path | None]] = {
    "pizza-dough": (FIX / "pizza-dough.raw.json", FIX / "pizza-dough.normalized.json"),
    "pumpkin-pancakes": (FIX / "pumpkin-pancakes.raw.json", FIX / "pumpkin-pancakes.replay-expected.json"),
    "kadhi-pakora": (FIX / "kadhi-pakora.raw.json", FIX / "kadhi-pakora.replay-expected.json"),
    "croissant": (FIX / "croissant.raw.json", FIX / "croissant.replay-expected.json"),
    "vanilla-cupcakes": (FIX / "known-wrong" / "vanilla-cupcakes.raw.json", FIX / "known-wrong" / "vanilla-cupcakes.original.json"),
    "chole-bhature": (FIX / "known-wrong" / "chole-bhature.raw.json", None),
}

# INR per 1K tokens (in, cached-in, out). INR85/$ card used by pricing.py.
# gpt-5-mini: $0.25/$2.00 (pricing.py). gpt-4.1-mini: $0.40 in / $0.10 cached / $1.60 out per M
# (OpenAI published list price; NOT in pricing.py, so priced here, scratch only).
# gpt-4o-mini: $0.15 / $0.075 / $0.60.
RATES = {
    "gpt-5-mini": (0.02125, 0.002125, 0.17),
    "gpt-4.1-mini": (0.034, 0.0085, 0.136),
    "gpt-4o-mini": (0.01275, 0.006375, 0.051),
}


def cost_inr(model: str, input_nc: int, cached: int, output: int) -> float:
    """Cost with `input_nc` = non-cached input tokens."""
    r_in, r_c, r_out = RATES[model]
    return input_nc / 1000 * r_in + cached / 1000 * r_c + output / 1000 * r_out


@dataclass
class Budget:
    """Hard INR cap with a per-run reservation (sequential use)."""

    cap: float = 30.0
    spent: float = 0.0
    log: list[tuple[str, float, float]] = field(default_factory=list)
    lock: threading.Lock = field(default_factory=threading.Lock)

    def can(self, reserve: float) -> bool:
        return self.spent + reserve <= self.cap

    def add(self, label: str, cost: float) -> None:
        with self.lock:
            self.spent += cost
            self.log.append((label, cost, self.spent))


def jdump(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def load_raw(slug: str):  # noqa: ANN201
    from abc_cook.extract.acquire import RawAcquisition

    p = INPUTS[slug][0]
    return RawAcquisition.model_validate_json(p.read_text(encoding="utf-8"))
