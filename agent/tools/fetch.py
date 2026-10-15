"""Read one web page as text — the researcher's fallback when search is thin.

Researchers used to reach for ``curl`` in the sandbox for this (every call an
approval). This does the same job read-only: one GET, text back, nothing else.

It runs on the agent server, not in the sandbox, so it refuses any address that
is not on the public internet — loopback, private ranges, link-local (cloud
metadata at 169.254.169.254) — and re-checks after every redirect. Known gap: the
host is resolved here and again by the HTTP client, so a hostile DNS server could
answer differently the second time (DNS rebinding). Acceptable for this demo;
pin the connection to the checked address before exposing it more widely.
"""

from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx
from langchain.tools import tool

_MAX_BYTES = 2_000_000
_MAX_REDIRECTS = 5
_TIMEOUT = 15.0
_DEFAULT_CHARS = 12_000
_TEXT_TYPES = ("text/", "application/json", "application/xml", "application/xhtml")


def _public_host(host: str) -> bool:
    """True only if every address the host resolves to is on the public internet."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            return False
    return bool(infos)


def _check(url: str) -> str | None:
    """Why this URL may not be fetched, or None if it may."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return "Only http and https URLs can be fetched."
    if not parts.hostname:
        return "The URL has no host."
    if not _public_host(parts.hostname):
        return "That address is not on the public internet."
    return None


class _Text(HTMLParser):
    """Visible text of an HTML page, with block elements on their own lines."""

    _SKIP = {"script", "style", "noscript", "svg", "template", "head"}
    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.title = ""
        self._skip = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "title":
            self._in_title = True
        elif tag in self._SKIP:
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        elif tag in self._SKIP and self._skip:
            self._skip -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self._skip:
            self.parts.append(data)

    def text(self) -> str:
        joined = "".join(self.parts)
        lines = (re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in joined.split("\n"))
        return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


@tool(parse_docstring=True)
def fetch_url(url: str, max_chars: int = _DEFAULT_CHARS) -> dict[str, Any]:
    """Read one public web page and return its text.

    Use this when a search result points at a page you need to read in full, or
    when search comes back thin and you know the URL of a primary source. Text
    pages only (HTML, plain text, JSON, CSV) — not PDFs or images.

    Args:
        url: The full http(s) URL of the page.
        max_chars: How much of the page's text to return. Raise it only when the
            part you need is further down.
    """
    max_chars = max(1_000, min(int(max_chars), 40_000))
    current = url
    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=False, headers={"user-agent": "workbench-researcher/0.1"}) as client:
            for _ in range(_MAX_REDIRECTS + 1):
                if problem := _check(current):
                    return {"url": url, "error": problem}
                with client.stream("GET", current) as resp:
                    if resp.is_redirect and resp.headers.get("location"):
                        current = urljoin(current, resp.headers["location"])
                        continue
                    if resp.status_code >= 400:
                        return {"url": url, "error": f"The page answered HTTP {resp.status_code}."}
                    ctype = resp.headers.get("content-type", "").lower()
                    if ctype and not ctype.startswith(_TEXT_TYPES):
                        return {"url": url, "error": f"Not a text page ({ctype.split(';')[0]})."}
                    body = b""
                    for chunk in resp.iter_bytes():
                        body += chunk
                        if len(body) >= _MAX_BYTES:
                            break
                    raw = body.decode(resp.encoding or "utf-8", errors="replace")
                    break
            else:
                return {"url": url, "error": "Too many redirects."}
    except httpx.HTTPError as exc:  # surfaced to the model, not raised
        return {"url": url, "error": f"Could not fetch the page: {exc.__class__.__name__}."}

    title = ""
    if "html" in ctype or raw.lstrip()[:15].lower().startswith(("<!doctype", "<html")):
        parser = _Text()
        parser.feed(raw)
        title, text = parser.title.strip(), parser.text()
    else:
        text = raw.strip()

    return {
        "url": url,
        "final_url": current,
        "title": title,
        "content": text[:max_chars],
        "truncated": len(text) > max_chars,
    }
