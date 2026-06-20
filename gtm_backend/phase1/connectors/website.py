"""Fetch and clean a company's own web pages for firmographic enrichment.

Best-effort and read-only: pulls the homepage plus the usual About/Contact
pages, strips the markup, and returns plain text for the LLM to read HQ address,
phone, headcount, etc. out of. Never raises — a dead/parked domain just yields
less text.
"""
import re

import httpx

# A handful of paths most likely to carry HQ address / phone / company facts.
_PATHS = ("", "/about", "/about-us", "/contact", "/contact-us")
_MAX_CHARS = 6000  # cap text sent downstream to keep the LLM call cheap

_client = httpx.Client(
    timeout=10.0,
    follow_redirects=True,
    headers={"User-Agent": "Mozilla/5.0 (compatible; GTM-Agent/1.0; +enrichment)"},
)

_DROP_BLOCK = re.compile(r"<(script|style|noscript|svg|head)[^>]*>.*?</\1>", re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _clean_html(html: str) -> str:
    text = _DROP_BLOCK.sub(" ", html)
    text = _TAGS.sub(" ", text)
    text = _WS.sub(" ", text)
    return text.strip()


def _base_url(domain: str) -> str:
    base = domain.strip()
    if "://" not in base:
        base = f"https://{base}"
    return base.rstrip("/")


def fetch_text(domain: str, max_chars: int = _MAX_CHARS) -> str:
    """Return cleaned text from a company's homepage + about/contact pages.

    Silently skips pages that error or 404; returns "" if nothing was reachable.
    """
    if not domain or not domain.strip():
        return ""
    base = _base_url(domain)
    chunks: list[str] = []
    total = 0
    for path in _PATHS:
        try:
            response = _client.get(f"{base}{path}")
            response.raise_for_status()
        except Exception:
            continue  # best-effort: skip unreachable / non-200 pages
        text = _clean_html(response.text)
        if not text:
            continue
        chunks.append(f"[{path or '/'}] {text}")
        total += len(text)
        if total >= max_chars:
            break
    return "\n".join(chunks)[:max_chars]
