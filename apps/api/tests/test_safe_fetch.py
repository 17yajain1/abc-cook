"""extract/acquire/safe_fetch.py -- SSRF guards. Offline: injected resolver + transport."""

from __future__ import annotations

import httpx
import pytest

from abc_cook.extract.acquire.safe_fetch import FetchError, fetch_html

PUBLIC_IP = "93.184.216.34"


def _public(host: str) -> list[str]:
    return [PUBLIC_IP]


def _html_transport(
    body: str = "<html>ok</html>", content_type: str = "text/html; charset=utf-8"
) -> httpx.MockTransport:
    return httpx.MockTransport(
        lambda request: httpx.Response(200, headers={"content-type": content_type}, text=body)
    )


def test_fetches_html_and_pins_the_vetted_ip_with_the_original_host_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<html>hi</html>")

    page = fetch_html(
        "https://recipes.example/dal?x=1",
        resolve=_public,
        transport=httpx.MockTransport(handler),
    )
    assert page.text == "<html>hi</html>"
    assert page.final_url == "https://recipes.example/dal?x=1"
    assert seen[0].url.host == PUBLIC_IP  # connects to the address we vetted...
    assert seen[0].headers["host"] == "recipes.example"  # ...while naming the real host
    assert seen[0].url.query == b"x=1"


@pytest.mark.parametrize(
    "url",
    [
        "http://recipes.example/x",  # not https
        "ftp://recipes.example/x",
        "https://recipes.example:8443/x",  # non-default port
        "https://user:pw@recipes.example/x",  # credentials
        "https:///nohost",
    ],
)
def test_refuses_bad_url_shapes(url: str) -> None:
    with pytest.raises(FetchError):
        fetch_html(url, resolve=_public, transport=_html_transport())


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "192.168.0.10",
        "172.16.5.5",
        "169.254.169.254",  # cloud metadata
        "0.0.0.0",
        "::1",
        "fe80::1",
        "fc00::1",
        "224.0.0.1",
        "ff02::1",  # multicast
        "100.64.0.1",  # carrier-grade NAT
        "::ffff:127.0.0.1",  # IPv4-mapped loopback
    ],
)
def test_refuses_a_hostname_that_resolves_to_a_non_public_address(address: str) -> None:
    with pytest.raises(FetchError, match="non-public"):
        fetch_html(
            "https://innocent.example/x",
            resolve=lambda host: [address],
            transport=_html_transport(),
        )


def test_refuses_when_any_one_of_several_addresses_is_private() -> None:
    with pytest.raises(FetchError, match="non-public"):
        fetch_html(
            "https://innocent.example/x",
            resolve=lambda host: [PUBLIC_IP, "10.0.0.1"],
            transport=_html_transport(),
        )


def test_refuses_ip_literal_urls_to_private_ranges() -> None:
    with pytest.raises(FetchError, match="non-public"):
        fetch_html("https://169.254.169.254/latest/meta-data", transport=_html_transport())
    with pytest.raises(FetchError, match="non-public"):
        fetch_html("https://[::1]/x", transport=_html_transport())


def test_rechecks_every_redirect_hop() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://internal.example/admin"})

    def resolve(host: str) -> list[str]:
        return ["10.0.0.5"] if host == "internal.example" else [PUBLIC_IP]

    with pytest.raises(FetchError, match="non-public"):
        fetch_html(
            "https://recipes.example/x", resolve=resolve, transport=httpx.MockTransport(handler)
        )


def test_refuses_redirect_to_plain_http() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(301, headers={"location": "http://recipes.example/x"})

    with pytest.raises(FetchError, match="scheme"):
        fetch_html(
            "https://recipes.example/x", resolve=_public, transport=httpx.MockTransport(handler)
        )


def test_follows_a_relative_redirect_to_the_final_page() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "/new"})
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<html>new</html>")

    page = fetch_html(
        "https://recipes.example/old", resolve=_public, transport=httpx.MockTransport(handler)
    )
    assert page.final_url == "https://recipes.example/new"


def test_stops_after_max_redirects() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"location": "https://recipes.example/loop"})

    with pytest.raises(FetchError, match="redirects"):
        fetch_html(
            "https://recipes.example/loop",
            resolve=_public,
            transport=httpx.MockTransport(handler),
            max_redirects=3,
        )


def test_refuses_non_html_content_types() -> None:
    with pytest.raises(FetchError, match="not html"):
        fetch_html(
            "https://recipes.example/x",
            resolve=_public,
            transport=_html_transport(content_type="application/pdf"),
        )


def test_enforces_the_body_cap_while_streaming() -> None:
    with pytest.raises(FetchError, match="body over"):
        fetch_html(
            "https://recipes.example/x",
            resolve=_public,
            transport=_html_transport(body="x" * 5000),
            max_bytes=1000,
        )


def test_http_status_errors_become_fetch_errors() -> None:
    transport = httpx.MockTransport(lambda request: httpx.Response(403))
    with pytest.raises(FetchError, match="http 403"):
        fetch_html("https://recipes.example/x", resolve=_public, transport=transport)


def test_allow_http_permits_port_80_only() -> None:
    page = fetch_html(
        "http://recipes.example/x", allow_http=True, resolve=_public, transport=_html_transport()
    )
    assert page.text
    with pytest.raises(FetchError, match="port"):
        fetch_html(
            "http://recipes.example:8080/x",
            allow_http=True,
            resolve=_public,
            transport=_html_transport(),
        )
