"""Direct company-website fetcher — a FREE, no-API enrichment source.

Used as a fallback by Agent 06 (and Agent 08) when SerpAPI returns nothing
(e.g. the free SerpAPI quota is exhausted and every search 429s). Instead of
producing an empty "scrape_failed" brief, we read the company's OWN website
— which is real, current, and citable (source_url = the page itself) — and
hand the extracted text to the same LLM brief path.

This deliberately does NOT need a search API: it fetches a handful of common
pages on the company domain over plain HTTP and strips them to text.
"""
import re

import httpx


_USER_AGENT = (
    "Mozilla/5.0 (compatible; AI-GTM-Agency/1.0; +https://example.com/bot) "
    "Python-httpx"
)
# Common pages that describe what a company does. Tried in order; we stop once
# enough text has been gathered.
_CANDIDATE_PATHS = ["", "/about", "/about-us", "/company", "/product", "/solutions", "/products"]
_MAX_PAGES = 4
_MAX_TEXT_PER_PAGE = 2500
_MIN_USEFUL_TEXT = 120

# Pages most likely to name real people (used by Agent 07 as a LinkedIn-search
# fallback when SerpAPI/Serper are unavailable — e.g. quota/credits exhausted).
_TEAM_PATHS = [
    "/team", "/about/team", "/about-us/team", "/our-team",
    "/company/team", "/leadership", "/about/leadership", "/people",
]

_client = httpx.Client(
    timeout=15.0,
    follow_redirects=True,
    headers={"User-Agent": _USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
)

_DROP_BLOCKS = re.compile(
    r"(?is)<(script|style|noscript|svg|head|template|iframe)[^>]*>.*?</\1>"
)
_TAG = re.compile(r"(?is)<[^>]+>")
_WS = re.compile(r"\s+")
_TITLE = re.compile(r"(?is)<title[^>]*>(.*?)</title>")
_META = re.compile(
    r"""(?is)<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*"""
    r"""content=["']([^"']+)["']"""
)


def _extract_text(html: str) -> tuple[str, str]:
    """Return (title_plus_meta, body_text) extracted from raw HTML."""
    title_m = _TITLE.search(html)
    title = _WS.sub(" ", title_m.group(1)).strip() if title_m else ""
    metas = _META.findall(html)
    header = " — ".join([p for p in [title, *metas[:2]] if p]).strip()

    body = _DROP_BLOCKS.sub(" ", html)
    body = _TAG.sub(" ", body)
    body = _WS.sub(" ", body).strip()
    # collapse the most common HTML entities so the LLM sees clean prose
    for ent, rep in (("&amp;", "&"), ("&nbsp;", " "), ("&#038;", "&"), ("&#039;", "'"), ("&quot;", '"')):
        body = body.replace(ent, rep)
    return header, body


def _normalise_domain(domain: str) -> str:
    domain = (domain or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain)
    return domain.strip("/")


def fetch_company_pages(domain: str, max_pages: int = _MAX_PAGES) -> list[dict]:
    """Fetch a few pages of the company's own website and return text snippets.

    Returns a list of ``{"text": str, "source_url": str}`` dicts, mirroring the
    shape Agent 06 already expects from SerpAPI web snippets. Returns ``[]`` on
    any failure (unreachable host, non-HTML, all-empty) so the caller can fall
    through to the next strategy.
    """
    domain = _normalise_domain(domain)
    if not domain:
        return []

    snippets: list[dict] = []
    seen_text: set[str] = set()
    for path in _CANDIDATE_PATHS:
        if len(snippets) >= max_pages:
            break
        for scheme in ("https", "http"):
            url = f"{scheme}://{domain}{path}"
            try:
                resp = _client.get(url)
            except httpx.HTTPError:
                continue
            if resp.status_code >= 400:
                continue
            ctype = resp.headers.get("content-type", "")
            if "html" not in ctype and "text" not in ctype:
                break
            header, body = _extract_text(resp.text)
            text = (header + ". " + body).strip(" .") if header else body
            text = text[:_MAX_TEXT_PER_PAGE].strip()
            if len(text) < _MIN_USEFUL_TEXT:
                break  # reachable but no useful content — don't try http variant
            fingerprint = text[:200]
            if fingerprint in seen_text:
                break  # same page (redirect collapsed paths) — skip duplicate
            seen_text.add(fingerprint)
            snippets.append({"text": text, "source_url": str(resp.url)})
            break  # got this path on https; don't also fetch http
    return snippets


def fetch_team_pages(domain: str, max_pages: int = _MAX_PAGES) -> list[dict]:
    """Fetch a company's own /team, /leadership, /people pages (real names only).

    Free fallback for Agent 07 when LinkedIn search (SerpAPI/Serper) is
    unavailable. Returns the same ``{"text": str, "source_url": str}`` shape
    as fetch_company_pages(); returns ``[]`` on any failure so the caller can
    fall through to its next strategy (or give up cleanly).
    """
    domain = _normalise_domain(domain)
    if not domain:
        return []

    snippets: list[dict] = []
    seen_text: set[str] = set()
    for path in _TEAM_PATHS:
        if len(snippets) >= max_pages:
            break
        url = f"https://{domain}{path}"
        try:
            resp = _client.get(url)
        except httpx.HTTPError:
            continue
        if resp.status_code >= 400:
            continue
        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype and "text" not in ctype:
            continue
        header, body = _extract_text(resp.text)
        text = (header + ". " + body).strip(" .") if header else body
        text = text[:_MAX_TEXT_PER_PAGE].strip()
        if len(text) < _MIN_USEFUL_TEXT:
            continue
        fingerprint = text[:200]
        if fingerprint in seen_text:
            continue
        seen_text.add(fingerprint)
        snippets.append({"text": text, "source_url": str(resp.url)})
    return snippets
