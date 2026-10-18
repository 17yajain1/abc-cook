r"""PR-S3: dump the extraction request body, offline (INR 0), for every stream x strict combination.

It runs `normalize()` on a frozen raw acquisition through the real `OpenAIAdapter` over an
`httpx.MockTransport` that records the request and answers with a canned recipe, so the dumped
body is exactly what production would send. No network, no keys.

    D=notes/pr-s3-strict-output/request-dumps
    python apps/api/scripts/dump_extraction_request.py --label before --out $D
    python apps/api/scripts/dump_extraction_request.py --label after --out $D
    python apps/api/scripts/dump_extraction_request.py --diff before after --out $D

`before` writes the two stream variants (strict does not exist yet, so the switch is not set).
`after` writes the four combinations. Files are `<label>-stream-{on,off}[-strict-{on,off}].json`,
canonical JSON (sorted keys, 2-space indent).
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import sys
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import httpx  # noqa: E402

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.adapters.openai import OpenAIAdapter  # noqa: E402
from abc_cook.extract.normalize import normalize  # noqa: E402
from abc_cook.schema.normalized import (  # noqa: E402
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
)

FIXTURE = API_ROOT / "tests" / "fixtures" / "import" / "kadhi-pakora.raw.json"
STREAM_ENV = "ABC_COOK_STREAM_EXTRACTION"
STRICT_ENV = "ABC_COOK_STRICT_EXTRACTION"


def _canned() -> str:
    recipe = NormalizedRecipe(
        title="Test Recipe",
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="onion", qty="1", unit="cup", prep_note=None)],
        steps=[
            NormalizedStep(
                text="Cook the onion.",
                attention="hands_on",
                duration_stated=False,
                consumes_ingredients=["onion"],
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )
    return recipe.model_dump_json()


def _sse(payload: dict[str, Any] | str) -> bytes:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return f"data: {body}\n\n".encode()


def capture(*, stream: bool, strict: bool | None) -> dict[str, Any]:
    """The first extraction request body for one switch combination."""
    text = _canned()
    seen: list[dict[str, Any]] = []
    usage = {
        "prompt_tokens": 10,
        "completion_tokens": 10,
        "total_tokens": 20,
        "prompt_tokens_details": {"cached_tokens": 0},
        "completion_tokens_details": {"reasoning_tokens": 0},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        if seen[-1].get("stream"):
            chunks = [
                {"delta": {"content": text}, "finish_reason": None},
                {"delta": {}, "finish_reason": "stop"},
            ]
            body = b"".join(
                _sse(
                    {
                        "id": "x",
                        "object": "chat.completion.chunk",
                        "created": 0,
                        "model": "m",
                        "choices": [{"index": 0, **c}],
                    }
                )
                for c in chunks
            )
            body += _sse(
                {
                    "id": "x",
                    "object": "chat.completion.chunk",
                    "created": 0,
                    "model": "m",
                    "choices": [],
                    "usage": usage,
                }
            )
            body += _sse("[DONE]")
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)
        return httpx.Response(
            200,
            json={
                "id": "x",
                "object": "chat.completion",
                "created": 0,
                "model": "m",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": text},
                    }
                ],
                "usage": usage,
            },
        )

    saved = {k: os.environ.get(k) for k in (STREAM_ENV, STRICT_ENV)}
    try:
        os.environ[STREAM_ENV] = "1" if stream else "0"
        if strict is None:
            os.environ.pop(STRICT_ENV, None)
        else:
            os.environ[STRICT_ENV] = "1" if strict else "0"
        adapter = OpenAIAdapter(api_key="sk-dump-unused")
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    raw = RawAcquisition.model_validate_json(FIXTURE.read_text(encoding="utf-8"))
    normalize(raw, adapter)
    if not seen:
        raise RuntimeError("no request was captured")
    return seen[0]


def _name(label: str, stream: bool, strict: bool | None) -> str:
    base = f"{label}-stream-{'on' if stream else 'off'}"
    return base if strict is None else f"{base}-strict-{'on' if strict else 'off'}"


def _write(out: Path, name: str, body: dict[str, Any]) -> None:
    (out / f"{name}.json").write_text(
        json.dumps(body, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def main() -> None:
    """Write dumps, or diff two labels."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--label", choices=["before", "after"])
    parser.add_argument("--diff", nargs=2, metavar=("A", "B"))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    if args.label == "before":
        for stream in (True, False):
            _write(args.out, _name("before", stream, None), capture(stream=stream, strict=None))
    elif args.label == "after":
        for stream in (True, False):
            for strict in (False, True):
                _write(
                    args.out, _name("after", stream, strict), capture(stream=stream, strict=strict)
                )
    elif args.diff:
        a, b = args.diff
        for stream in (True, False):
            pairs = [
                (_name(a, stream, None), _name(b, stream, False)),
                (_name(b, stream, False), _name(b, stream, True)),
            ]
            for left, right in pairs:
                lt = (args.out / f"{left}.json").read_text(encoding="utf-8").splitlines()
                rt = (args.out / f"{right}.json").read_text(encoding="utf-8").splitlines()
                diff = list(difflib.unified_diff(lt, rt, left, right, lineterm="", n=0))
                changed = [d for d in diff if d[:1] in "+-" and d[:3] not in ("+++", "---")]
                keys = sorted(set(json.loads("\n".join(rt))) ^ set(json.loads("\n".join(lt))))
                print(f"{left} vs {right}: {len(changed)} changed lines; key set diff = {keys}")
    else:
        parser.error("give --label or --diff")


if __name__ == "__main__":
    main()
