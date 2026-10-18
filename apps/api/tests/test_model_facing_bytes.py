"""Pin every byte the model sees, so a non-model change cannot silently alter extraction.

PR-S1 adds `ImportResult.failure`, `ImportJobResponse.acquired`, error classification and an
effort ceiling. None of those may touch what the model is sent. These sha256 values were
recorded from origin/main (120cc36) before any S1 code change and must stay green through every
later commit. A diff here is a prompt or schema change: a product decision with its own
POSTPROCESS_VERSION bump and A/B evidence, never a test fix.

Pinned:
* the full system prompt (prompt file + output-format instructions + embedded JSON Schema) for
  the extraction call and for the repair call,
* each output type's JSON Schema (which carries every field docstring and description),
* `render_source_text(raw)` for every frozen `RawAcquisition` in the corpus.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.prompting import model_schema, system_prompt
from abc_cook.extract.normalize import load_prompt, render_source_text
from abc_cook.extract.repair import RepairProposal, load_repair_prompt
from abc_cook.schema.normalized import NormalizedRecipe

_IMPORT = Path(__file__).parent / "fixtures" / "import"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@pytest.fixture(autouse=True)
def _added_steps_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pins below are the pre-FGC-3 bytes, i.e. the switched-off path; the switched-on bytes
    are pinned in `test_added_steps.py`."""
    monkeypatch.setenv("ABC_COOK_ADDED_STEPS", "0")


def _schema_sha(model: type[NormalizedRecipe] | type[RepairProposal]) -> str:
    return _sha(json.dumps(model_schema(model), sort_keys=True, ensure_ascii=False))


def test_extraction_system_prompt_bytes() -> None:
    assert (
        _sha(system_prompt(load_prompt(), NormalizedRecipe))
        == "7d74b48a6aac30d82f775c19954fc4852dafa59e3fde9538ee8dfebf27ae3993"
    )


def test_repair_system_prompt_bytes() -> None:
    assert (
        _sha(system_prompt(load_repair_prompt(), RepairProposal))
        == "be5aeb255cd35b6dbd693e6eed60db7a40c9d3d1726c1c14d28ccac29c8a83f3"
    )


def test_normalized_recipe_schema_bytes() -> None:
    assert (
        _schema_sha(NormalizedRecipe)
        == "5dd564a4d4244831ffa6f27e70a794130d03992f8a50307c3d7dca705d747f7b"
    )


def test_repair_proposal_schema_bytes() -> None:
    assert (
        _schema_sha(RepairProposal)
        == "6ab91cd6d93198e64440599f128fd8916d6f5d7ceea6819e029e7169aabbed11"
    )


_SOURCE_TEXT_SHA = {
    "blog-link-only": "28fdd62e41138f72f5de068dca4e1e4c9f75b84df7a9e36f6deb1a82d2aafa9b",
    "captions-auto-en-long": "112751e460379b8427c200ff1d899216a42b22cda21e1186b1201218661aa035",
    "captions-auto-hi": "753ec3ab199b101907f48e7a3eea5e978e0be443fe938318b8afc74cc71bf678",
    "captions-manual-en": "632166c6dd7df2360c3c174e45abff1b6e928a76b6113393ae32f9d85e21a45d",
    "croissant": "95b7b2af9416b32ed370dbc6ca063cf88842cfb34bc26047e69205d305d8ea96",
    "full-method": "923b86a2bb363453a9596859035edfa5732bc8280e8f1d39b77d0b88324c85ac",
    "kadhi-pakora": "9425702914ae12cea543bdca62f14eed159ea50f1787a9677d253b92735f466f",
    "known-wrong/chole-bhature": "e1aeeef22393b147629f130b094674ef705d08e76f304ad1b45ad30b601e9da6",
    "known-wrong/vanilla-cupcakes": (
        "a8322de2c6e0506cdf5cf4178d07ffa2b8783c24d513b390147163e77cbaa62c"
    ),
    "no-captions": "80ce6c309ca759c09376b8cfd40b54b85339344a36dd8b2e2fd724c5dd7a6ef1",
    "partial-ingredients-only": "b54daea86a1afddeb9c12759e6f387e26053b49939d0635995c8da4b1d03d1fc",
    "pizza-dough": "f8a9083969cba76eb350f3f92eb6bf1960d1a49e9172f9b1375522684e65491e",
    "pumpkin-pancakes": "8d8105a15259e19e75ecb175ff47c4c5be4e0f8d16b4666c775c63f2eab569d0",
    "useless": "30913426c584e0bf5fab8b1c8c4e54d2faeb557487841ebc5b130f0f4709e4ab",
}


@pytest.mark.parametrize("slug", sorted(_SOURCE_TEXT_SHA))
def test_rendered_source_text_bytes(slug: str) -> None:
    raw = RawAcquisition.model_validate_json(
        (_IMPORT / f"{slug}.raw.json").read_text(encoding="utf-8")
    )
    assert _sha(render_source_text(raw)) == _SOURCE_TEXT_SHA[slug]


def test_every_corpus_raw_is_pinned() -> None:
    on_disk = {
        p.relative_to(_IMPORT).as_posix().removesuffix(".raw.json")
        for p in _IMPORT.rglob("*.raw.json")
    }
    assert on_disk == set(_SOURCE_TEXT_SHA)
