"""SSRF-guarded HTML fetch for user-supplied recipe-page URLs. No LLM.

Recipe-page import (A1) means the server fetches whatever https URL a user pastes,
which is a server-side-request-forgery surface: `https://169.254.169.254/...` (cloud
metadata), `https://localhost:8000/...`, or a public hostname whose DNS answers with a
private address. Guards, all enforced here and nowhere else:

- https only, default port only (443). `allow_http=True` additionally permits plain
  http on port 80 -- used only for links *found inside a video description*, which
  were fetchable before this module existed; a URL the user pastes is https-only.
- The hostname is resolved by us and *every* returned address must be globally
  routable (`ipaddress.is_global`) -- private, loopback, link-local, multicast,
  reserved and unspecified addresses are all refused.
- The request is then sent to that vetted IP (Host header + TLS SNI/certificate check
  keep the original hostname), so a second, different DNS answer cannot be used to
  slip past the check (DNS rebinding).
- Redirects are followed manually, at most `MAX_REDIRECTS`, and each hop repeats every
  check above.
- Total deadline `timeout_s` per request, a `MAX_BYTES` body cap enforced while
  streaming, and HTML content types only.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx

MAX_REDIRECTS = 5
MAX_BYTES = 3_000_000
TIMEOUT_S = 10.0
_HTML_TYPES = ("text/html", "application/xhtml+xml")
_USER_AGENT = "Mozilla/5.0 (compatible; ABCCookImport/1.0; +https://abccook.app)"

Resolver = Callable[[str], list[str]]


class FetchError(Exception):
    """A refused or failed fetch. `reason` is a short, log-safe diagnostic."""

    def __init__(self, reason: str) -> None:
        """Keep `reason` addressable as an attribute, not only in `str(exc)`."""
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class FetchedPage:
    """A successfully fetched HTML page."""

    final_url: str
    text: str


def resolve_host(host: str) -> list[str]:
    """All A/AAAA addresses for `host` (the default `Resolver`)."""
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchError(f"dns failure for {host!r}") from exc
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


def _vet_url(url: str, resolve: Resolver, *, allow_http: bool) -> tuple[str, str]:
    """Check one hop's URL; return `(hostname, vetted_ip)` or raise `FetchError`."""
    parsed = urlparse(url)
    allowed_schemes = ("https", "http") if allow_http else ("https",)
    if parsed.scheme not in allowed_schemes:
        raise FetchError(f"scheme {parsed.scheme!r} not allowed")
    host = parsed.hostname
    if not host:
        raise FetchError("url has no host")
    if parsed.username or parsed.password:
        raise FetchError("credentials in url not allowed")
    try:
        port = parsed.port
    except ValueError as exc:
        raise FetchError("invalid port") from exc
    if port not in (None, 443 if parsed.scheme == "https" else 80):
        raise FetchError(f"port {port} not allowed")

    addresses = [host] if _is_ip_literal(host) else resolve(host)
    if not addresses:
        raise FetchError(f"no addresses for {host!r}")
    for address in addresses:
        if not _is_public(address):
            raise FetchError(f"{host!r} resolves to a non-public address")
    return host, addresses[0]


def _is_public(address: str) -> bool:
    """Globally routable and not multicast (`is_global` alone lets 224.0.0.0/4 through).

    An IPv4-mapped IPv6 address (`::ffff:127.0.0.1`) is judged by the IPv4 address it wraps.
    """
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _decode(body: bytes, charset: str | None) -> str:
    try:
        return body.decode(charset or "utf-8", errors="replace")
    except LookupError:  # a charset name Python doesn't know
        return body.decode("utf-8", errors="replace")


def fetch_html(
    url: str,
    *,
    timeout_s: float = TIMEOUT_S,
    max_bytes: int = MAX_BYTES,
    max_redirects: int = MAX_REDIRECTS,
    allow_http: bool = False,
    resolve: Resolver = resolve_host,
    transport: httpx.BaseTransport | None = None,
) -> FetchedPage:
    """GET `url` under every guard in the module docstring.

    Args:
        url: The page to fetch.
        timeout_s: Per-request timeout.
        max_bytes: Body size cap, enforced while streaming.
        max_redirects: Redirect hops allowed.
        allow_http: Also permit http on port 80 (description-link leg only).
        resolve: DNS resolver; injectable so tests never touch the network.
        transport: httpx transport; injectable for the same reason.

    Returns:
        The final URL and the decoded HTML text.

    Raises:
        FetchError: any refusal or failure, with a short `reason`.
    """
    current = url
    with httpx.Client(transport=transport, timeout=timeout_s, follow_redirects=False) as client:
        for _hop in range(max_redirects + 1):
            host, ip = _vet_url(current, resolve, allow_http=allow_http)
            parsed = urlparse(current)
            pinned_host = f"[{ip}]" if ":" in ip else ip
            pinned = parsed._replace(netloc=pinned_host).geturl()
            try:
                with client.stream(
                    "GET",
                    pinned,
                    headers={"Host": host, "User-Agent": _USER_AGENT, "Accept": "text/html"},
                    extensions={"sni_hostname": host},
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            raise FetchError("redirect without location")
                        current = urljoin(current, location)
                        continue
                    if response.status_code >= 400:
                        raise FetchError(f"http {response.status_code}")
                    content_type = response.headers.get("content-type", "").split(";")[0].strip()
                    if content_type.lower() not in _HTML_TYPES:
                        raise FetchError(f"content-type {content_type or 'missing'!r} not html")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise FetchError(f"body over {max_bytes} bytes")
                    return FetchedPage(current, _decode(bytes(body), response.charset_encoding))
            except httpx.HTTPError as exc:
                raise FetchError(f"{type(exc).__name__}: {exc}") from exc
    raise FetchError(f"more than {max_redirects} redirects")
