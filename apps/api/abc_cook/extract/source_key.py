"""Python port of the web app's `canonicalSourceKey` (`apps/web/src/library/sourceKey.ts`).

The result cache and the browser's saved-recipe library must agree on what "the same
source" means, so this reproduces the TypeScript behaviour -- including its dependence
on the WHATWG `URL` / `URLSearchParams` parsers -- rather than improving on it. The
shared vectors file `tests/fixtures/source_key_vectors.json` is asserted by both this
module's pytest and the web app's vitest (`sourceKey.vectors.test.ts`); the TypeScript
side is the reference and is never changed to fit this port.

Scope of the WHATWG emulation: `http`/`https`/`ws`/`wss`/`ftp`/`file`-less special URLs
(host lower-casing, IDNA, IPv4/IPv6 normalisation, default-port removal, path
percent-encoding and dot-segment removal, form-encoded query re-serialisation) and
opaque-path schemes such as `mailto:`. Any other `scheme://` shape is *not* emulated:
it takes the unparseable fallback, which yields a different (never-merging) key than the
TypeScript. That is a cache-miss risk only, and is listed in the vectors file's
`known_divergences`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Final
from urllib.parse import unquote_to_bytes

import idna

from abc_cook.schema.graph import SourceKind

_TRACKING_PARAM_PREFIXES: Final = ("utm_",)
_TRACKING_PARAMS: Final = frozenset({"si", "fbclid", "igshid"})
_TEXT_KEY_INLINE_MAX: Final = 64

# JS `\s` / `String.prototype.trim` whitespace set (Python's `\s` differs: it includes
# \x1c-\x1f and \x85, and omits U+FEFF).
_JS_WS: Final = r"\t\n\x0b\x0c\r \xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_WS_RUN = re.compile(f"[{_JS_WS}]+")
_JS_WS_EDGES = re.compile(f"^[{_JS_WS}]+|[{_JS_WS}]+$")

_SPECIAL_SCHEMES: Final = {"http": 80, "https": 443, "ws": 80, "wss": 443, "ftp": 21}
_SCHEME = re.compile(r"^([A-Za-z][A-Za-z0-9+.\-]*):")
_FORBIDDEN_HOST = set("\x00\t\n\r #/:<>?@[\\]^|%") | {chr(i) for i in range(0x20)} | {"\x7f"}


def _js_trim(value: str) -> str:
    return _JS_WS_EDGES.sub("", value)


def _utf16_units(text: str) -> list[int]:
    raw = text.encode("utf-16-le", "surrogatepass")
    return [int.from_bytes(raw[i : i + 2], "little") for i in range(0, len(raw), 2)]


def _from_utf16_units(units: list[int]) -> str:
    raw = b"".join(u.to_bytes(2, "little") for u in units)
    return raw.decode("utf-16-le", "surrogatepass")


def _fnv1a(units: list[int]) -> str:
    """FNV-1a, 32-bit, hex, over UTF-16 code units (JS `charCodeAt`)."""
    h = 0x811C9DC5
    for unit in units:
        h ^= unit
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _text_key(value: str) -> str:
    normalized = _JS_WS_RUN.sub(" ", value)
    normalized = _js_trim(normalized).lower()
    units = _utf16_units(normalized)
    if len(units) <= _TEXT_KEY_INLINE_MAX:
        return f"text:{normalized}"
    return f"text:{_from_utf16_units(units[:32])}#{_fnv1a(units)}"


# --- URL parsing (the slice of WHATWG that the key depends on) ---------------------


class _UnparseableError(Exception):
    """`new URL(...)` would throw (or this port does not emulate the shape)."""


@dataclass(frozen=True)
class _Url:
    host: str
    path: str  # percent-encoded, dot segments resolved; "/" when empty for special URLs
    query: str  # raw, without the "?"


def _percent_encode(text: str, extra: str, *, encode_non_ascii: bool = True) -> str:
    """Percent-encode C0 controls, DEL, non-ASCII (UTF-8) and any char in `extra`."""
    out: list[str] = []
    for ch in text:
        o = ord(ch)
        if o < 0x20 or o == 0x7F or ch in extra or (o > 0x7E and encode_non_ascii):
            data = ch.encode("utf-8", "replace") if not 0xD800 <= o <= 0xDFFF else b"\xef\xbf\xbd"
            out.append("".join(f"%{b:02X}" for b in data))
        else:
            out.append(ch)
    return "".join(out)


_PATH_EXTRA = ' "#<>?`{}'
_DOT = {".", "%2e"}
_DOT2 = {"..", ".%2e", "%2e.", "%2e%2e"}


def _resolve_path(path: str) -> str:
    """Encode, then remove dot segments (special-URL rules; `/` on empty)."""
    segments = path.split("/")[1:] if path.startswith("/") else path.split("/")
    out: list[str] = []
    for i, seg in enumerate(segments):
        low = seg.lower()
        last = i == len(segments) - 1
        if low in _DOT2:
            if out:
                out.pop()
            if last:
                out.append("")
        elif low in _DOT:
            if last:
                out.append("")
        else:
            out.append(seg)
    return "/" + "/".join(out)


def _parse_ipv4_number(part: str) -> int:
    if part == "":
        raise _UnparseableError
    base = 10
    if len(part) >= 2 and part[:2].lower() == "0x":
        base, part = 16, part[2:]
    elif len(part) >= 2 and part[0] == "0":
        base, part = 8, part[1:]
    if part == "":
        return 0
    try:
        return int(part, base)
    except ValueError as exc:
        raise _UnparseableError from exc


def _ends_in_number(host: str) -> bool:
    parts = host.split(".")
    if parts[-1] == "":
        if len(parts) == 1:
            return False
        parts.pop()
    last = parts[-1]
    if last and last.isascii() and last.isdigit():
        return True
    return bool(re.fullmatch(r"0[xX][0-9a-fA-F]*", last))


def _parse_ipv4(host: str) -> str:
    parts = host.split(".")
    if parts[-1] == "" and len(parts) > 1:
        parts.pop()
    if len(parts) > 4:
        raise _UnparseableError
    numbers = [_parse_ipv4_number(p) for p in parts]
    if any(n > 255 for n in numbers[:-1]) or numbers[-1] >= 256 ** (5 - len(numbers)):
        raise _UnparseableError
    ipv4 = numbers[-1]
    for i, n in enumerate(numbers[:-1]):
        ipv4 += n * 256 ** (3 - i)
    return ".".join(str((ipv4 >> s) & 255) for s in (24, 16, 8, 0))


def _serialize_ipv6(host: str) -> str:
    import ipaddress

    try:
        addr = ipaddress.IPv6Address(host)
    except ValueError as exc:
        raise _UnparseableError from exc
    pieces = [int(h, 16) for h in addr.exploded.split(":")]
    best_start, best_len, i = -1, 1, 0
    while i < 8:
        if pieces[i] == 0:
            j = i
            while j < 8 and pieces[j] == 0:
                j += 1
            if j - i > best_len:
                best_start, best_len = i, j - i
            i = j
        else:
            i += 1
    out: list[str] = []
    i = 0
    while i < 8:
        if i == best_start:
            out.append("::" if i == 0 else ":")
            i += best_len
            continue
        out.append(f"{pieces[i]:x}")
        if i != 7:
            out.append(":")
        i += 1
    return "[" + "".join(out) + "]"


def _parse_host(raw: str) -> str:
    if raw.startswith("["):
        if not raw.endswith("]"):
            raise _UnparseableError
        return _serialize_ipv6(raw[1:-1])
    decoded = unquote_to_bytes(raw).decode("utf-8", "replace")
    if decoded.isascii():
        domain = decoded.lower()
    else:
        try:
            domain = idna.encode(decoded, uts46=True, transitional=False).decode("ascii")
        except idna.IDNAError as exc:
            raise _UnparseableError from exc
    if domain == "" or any(c in _FORBIDDEN_HOST for c in domain):
        raise _UnparseableError
    if _ends_in_number(domain):
        return _parse_ipv4(domain)
    return domain


def _parse_port(raw: str, scheme: str) -> None:
    if raw == "":
        return
    if not (raw.isascii() and raw.isdigit()) or int(raw) > 65535:
        raise _UnparseableError
    _ = _SPECIAL_SCHEMES[scheme]  # default-port removal never affects `hostname`


def _parse_url(raw: str) -> _Url:
    text = re.sub(r"[\t\n\r]", "", re.sub(r"^[\x00-\x20]+|[\x00-\x20]+$", "", raw))
    match = _SCHEME.match(text)
    if match is None:
        raise _UnparseableError
    scheme = match.group(1).lower()
    rest = text[match.end() :]
    fragment_at = rest.find("#")
    if fragment_at != -1:
        rest = rest[:fragment_at]
    query = ""
    query_at = rest.find("?")
    if query_at != -1:
        query = rest[query_at + 1 :]
        rest = rest[:query_at]

    if scheme in _SPECIAL_SCHEMES:
        rest = rest.replace("\\", "/")
        rest = rest.lstrip("/")
        slash = rest.find("/")
        authority, path = (rest, "") if slash == -1 else (rest[:slash], rest[slash:])
        authority = authority[authority.rfind("@") + 1 :]
        port = ""
        if authority.startswith("["):
            close = authority.find("]")
            if close == -1:
                raise _UnparseableError
            host_part, tail = authority[: close + 1], authority[close + 1 :]
            if tail:
                if not tail.startswith(":"):
                    raise _UnparseableError
                port = tail[1:]
        else:
            host_part, _sep, port = authority.partition(":")
        _parse_port(port, scheme)
        host = _parse_host(host_part)
        return _Url(host, _resolve_path(_percent_encode(path, _PATH_EXTRA)), query)

    if rest.startswith("//"):
        raise _UnparseableError  # non-special hierarchical URL: not emulated (see module doc)
    # Opaque path (`mailto:`, `javascript:`): hostname "", pathname verbatim (C0 and
    # non-ASCII percent-encoded only).
    return _Url("", _percent_encode(rest, ""), query)


# --- Query / key assembly ------------------------------------------------------------

_FORM_SAFE = frozenset(b"*-._0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")


def _form_decode(component: str) -> str:
    data = component.replace("+", " ").encode("utf-8", "replace")
    return unquote_to_bytes(data).decode("utf-8", "replace")


def _form_encode(text: str) -> str:
    out: list[str] = []
    for b in text.encode("utf-8", "replace"):
        if b in _FORM_SAFE:
            out.append(chr(b))
        elif b == 0x20:
            out.append("+")
        else:
            out.append(f"%{b:02X}")
    return "".join(out)


def _query_pairs(query: str) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for part in query.split("&"):
        if part == "":
            continue
        name, _eq, value = part.partition("=")
        pairs.append((_form_decode(name), _form_decode(value)))
    return pairs


def _segments(path: str) -> list[str]:
    return [s for s in path.split("/") if s]


def _youtube_video_id(url: _Url, pairs: list[tuple[str, str]]) -> str | None:
    host = url.host
    segments = _segments(url.path)
    if host == "youtu.be":
        return segments[0] if segments else None
    if host == "youtube.com" or host.endswith(".youtube.com"):
        if segments[:1] == ["watch"]:
            return next((v for k, v in pairs if k == "v"), None)
        if segments[:1] in (["shorts"], ["embed"], ["live"]):
            return segments[1] if len(segments) > 1 else None
    return None


def _instagram_shortcode(url: _Url) -> str | None:
    host = url.host
    if host != "instagram.com" and not host.endswith(".instagram.com"):
        return None
    segments = _segments(url.path)

    def is_reel(seg: str | None) -> bool:
        return seg in ("reel", "reels")

    if segments and is_reel(segments[0]):
        return segments[1] if len(segments) > 1 else None
    if len(segments) >= 3 and is_reel(segments[1]):
        return segments[2]
    return None


def _canonical_url_key(url: _Url, pairs: list[tuple[str, str]]) -> str:
    host = url.host.removeprefix("www.")
    path = url.path.rstrip("/")
    kept = [
        (k, v)
        for k, v in pairs
        if not (
            k.lower() in _TRACKING_PARAMS
            or any(k.lower().startswith(p) for p in _TRACKING_PARAM_PREFIXES)
        )
    ]
    kept.sort(key=lambda kv: _utf16_units(kv[0]))  # stable, by UTF-16 code unit
    query = "&".join(f"{_form_encode(k)}={_form_encode(v)}" for k, v in kept)
    return f"url:{host}{path}{'?' + query if query else ''}"


@dataclass(frozen=True)
class SourceKey:
    """A source key plus how it was produced.

    `is_fallback` is set where canonicalisation *fails or is skipped* (an unparseable or
    not-emulated URL, or an uncanonicalised `image` reference) -- never inferred from the
    key string afterwards, because a fallback `url:` key and a canonicalised `url:` key
    look identical. A fallback key only lower-cases the raw value, so two different
    sources can share one; the result cache therefore never reads or writes on it.
    """

    kind: SourceKind
    value: str
    is_fallback: bool = False


def make_source_key(kind: SourceKind, value: str) -> SourceKey:
    """The canonical dedup key for a source, with its fallback provenance.

    `.value` is identical to `canonicalSourceKey`'s output (and to
    `canonical_source_key`); see that function for the key shapes. `.is_fallback` is True
    for `url:<trimmed lower-cased raw>` (the value did not parse as a URL, or is a shape
    this port does not emulate) and for `image:<raw>` (never canonicalised). `youtube:`,
    `instagram:`, canonicalised `url:` and `text:` keys are never fallbacks: the first
    three are derived only after a successful parse, and a malformed id there falls
    through to the canonicalised `url:` key, not to the raw value.
    """
    if kind == "text":
        return SourceKey(kind, _text_key(value))
    if kind != "url":
        return SourceKey(kind, f"{kind}:{value}", is_fallback=True)
    try:
        url = _parse_url(value)
    except _UnparseableError:
        return SourceKey(kind, f"url:{_js_trim(value).lower()}", is_fallback=True)
    pairs = _query_pairs(url.query)
    video_id = _youtube_video_id(url, pairs)
    if video_id:
        return SourceKey(kind, f"youtube:{video_id}")
    shortcode = _instagram_shortcode(url)
    if shortcode:
        return SourceKey(kind, f"instagram:{shortcode}")
    return SourceKey(kind, _canonical_url_key(url, pairs))


def canonical_source_key(kind: SourceKind, value: str) -> str:
    """The canonical dedup key string -- identical to `canonicalSourceKey`.

    Args:
        kind: `"url"`, `"text"` (or `"image"`, passed through as `image:<value>`).
        value: The URL, pasted text, or image reference.

    Returns:
        `text:<inline or prefix#fnv>`, `youtube:<id>`, `instagram:<code>`, or
        `url:<host><path>?<sorted query>`; `url:<trimmed lower-cased raw>` when the
        value does not parse as a URL. Use `make_source_key` when provenance matters
        (anything that decides cacheability).
    """
    return make_source_key(kind, value).value
