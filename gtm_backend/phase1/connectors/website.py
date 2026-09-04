"""Fetch and clean a company's own web pages for firmographic enrichment.

Best-effort and read-only: pulls the homepage plus the usual About/Contact
pages, strips the markup, and returns plain text for the LLM to read HQ address,
phone, headcount, etc. out of. Never raises — a dead/parked domain just yields
less text.
"""
import re

import httpx

# A handful of paths most likely to carry HQ address / phone / company facts.
_PATHS = ("", "/about", "/contact")
_MAX_CHARS = 2200  # cap text sent downstream to keep the LLM call cheap (was 6000 — HQ/size/industry signal lives in the first ~2k chars)

# Pages most likely to carry buying-signal-shaped content (hiring pushes, press,
# expansion news) — used by Agent 04 as a fallback when SerpAPI/Serper are
# unavailable (quota/credits exhausted).
_SIGNAL_PATHS = ("/careers", "/jobs", "/news", "/press", "/blog")
_MAX_CHARS_PER_SIGNAL_PAGE = 1500

# Pages most likely to name real people — mirrors phase2/connectors/website.py's
# fetch_team_pages (used there by Agent 07 as a LinkedIn-search fallback).
# Task #5 reuses this same page set in phase1's lead_enrichment.py to check
# whether a found contact's name is independently corroborated by the
# company's own team/about page, distinct from Agent 07's stakeholder-mapping
# use of the identical page list — two different features drawing on the same
# free, no-API evidence source.
_TEAM_PATHS = (
    "/team", "/about/team", "/about-us/team", "/our-team",
    "/company/team", "/leadership", "/about/leadership", "/people",
)
_MAX_TEAM_PAGES = 3
_MAX_CHARS_PER_TEAM_PAGE = 2000

_client = httpx.Client(
    timeout=6.0,
    follow_redirects=True,
    headers={"User-Agent": "Mozilla/5.0 (compatible; GTM-Agent/1.0; +enrichment)"},
)

_DROP_BLOCK = re.compile(r"<(script|style|noscript|svg|head)[^>]*>.*?</\1>", re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")

_OG_SITE_NAME_RE = re.compile(
    r'<meta[^>]+property=["\']og:site_name["\'][^>]+content=["\']([^"\']+)["\']', re.I
)
_TITLE_TAG_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
_META_DESCRIPTION_RE = re.compile(
    r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', re.I
)
_JSONLD_BLOCK_RE = re.compile(
    r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', re.S | re.I
)
# Trailing " - Tagline" / " | Tagline" cruft a <title> tag almost always
# carries (e.g. "Acme HR | People Management Platform") — the brand is
# whatever precedes the first separator, same heuristic _fallback_normalize
# already uses on search-result titles.
_TITLE_SEPARATOR_RE = re.compile(r"\s[-|–—]\s")


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


def fetch_site_name(domain: str) -> str | None:
    """The company's own name, straight from its homepage — og:site_name
    first (a site explicitly stating its own brand), falling back to the
    <title> tag's leading segment before any " - "/" | " tagline separator.

    Used by Agent 02's domain-first identity check: a search result's page
    title/snippet describes what a specific PAGE is about (a listicle, an
    article, a directory profile) — the homepage's own declared name is what
    the company actually calls itself, regardless of which page linked here.
    Best-effort like the rest of this module: returns None on any failure
    (unreachable domain, no title/og tag found) so the caller can fall back
    to its existing snippet-derived name instead of losing the candidate.
    """
    if not domain or not domain.strip():
        return None
    base = _base_url(domain)
    try:
        response = _client.get(base)
        response.raise_for_status()
    except Exception:
        return None
    html = response.text

    og_match = _OG_SITE_NAME_RE.search(html)
    if og_match:
        name = _WS.sub(" ", og_match.group(1)).strip()
        if name:
            return name

    title_match = _TITLE_TAG_RE.search(html)
    if not title_match:
        return None
    title = _WS.sub(" ", title_match.group(1)).strip()
    if not title:
        return None
    return _TITLE_SEPARATOR_RE.split(title, maxsplit=1)[0].strip() or None


def fetch_team_pages(domain: str, max_pages: int = _MAX_TEAM_PAGES) -> list[dict]:
    """Fetch a company's own /team, /leadership, /people pages as raw text.

    Used by lead_enrichment.py's email-verification-tier step (Task #5): a
    contact whose name is independently corroborated on the company's own
    team page is a stronger signal than a domain-level MX check alone.
    Best-effort: skips unreachable/non-HTML/too-short pages; returns []
    rather than raising on total failure, same contract as every other
    function in this module.
    """
    if not domain or not domain.strip():
        return []
    base = _base_url(domain)
    chunks: list[dict] = []
    seen_text: set[str] = set()
    for path in _TEAM_PATHS:
        if len(chunks) >= max_pages:
            break
        try:
            response = _client.get(f"{base}{path}")
            response.raise_for_status()
        except Exception:
            continue
        text = _clean_html(response.text)[:_MAX_CHARS_PER_TEAM_PAGE]
        if len(text) < 80:
            continue
        fingerprint = text[:200]
        if fingerprint in seen_text:
            continue
        seen_text.add(fingerprint)
        chunks.append({"text": text, "source_url": str(response.url)})
    return chunks


def fetch_homepage_signals(domain: str) -> dict:
    """Industry/company-size evidence from a company's own homepage — its
    meta description, plus any schema.org Organization/LocalBusiness/
    Corporation JSON-LD block it publishes about itself.

    Used by Agent 02's firmographic-confidence step (Task #4): a search
    snippet alone gives no way to distinguish a confident industry/size read
    from a baseless guess off the company name — both look equally plausible
    in the LLM's output. The homepage's own meta description / schema.org
    markup is real first-party evidence an LLM can judge against, distinct
    from inferring from a third party's snippet or the company's own name.

    Best-effort like every other function in this module: any field that
    can't be found is None, and a totally unreachable domain returns
    all-None rather than raising.
    """
    empty = {"meta_description": None, "schema_org_text": None}
    if not domain or not domain.strip():
        return empty
    base = _base_url(domain)
    try:
        response = _client.get(base)
        response.raise_for_status()
    except Exception:
        return empty
    html = response.text

    meta_description = None
    desc_match = _META_DESCRIPTION_RE.search(html)
    if desc_match:
        meta_description = _WS.sub(" ", desc_match.group(1)).strip()[:500] or None

    schema_org_text = None
    for block in _JSONLD_BLOCK_RE.findall(html):
        block = block.strip()
        if '"@type"' in block and any(
            t in block for t in ("Organization", "LocalBusiness", "Corporation")
        ):
            schema_org_text = _WS.sub(" ", block)[:1500]
            break

    return {"meta_description": meta_description, "schema_org_text": schema_org_text}


def fetch_signal_pages(domain: str) -> list[dict]:
    """Fetch a company's own /careers, /news, /press, /blog pages as raw text chunks.

    Free fallback for Agent 04 when SerpAPI/Serper search is unavailable.
    Returns ``{"signal_text": str, "source": url}`` dicts — the same shape
    Agent 04 already expects from a search candidate — so callers can feed
    these straight into the existing LLM classification step. Best-effort:
    returns ``[]`` on any failure.
    """
    if not domain or not domain.strip():
        return []
    base = _base_url(domain)
    out: list[dict] = []
    for path in _SIGNAL_PATHS:
        url = f"{base}{path}"
        try:
            response = _client.get(url)
            response.raise_for_status()
        except Exception:
            continue
        text = _clean_html(response.text)
        if len(text) < 80:
            continue
        out.append({
            "signal_text": text[:_MAX_CHARS_PER_SIGNAL_PAGE],
            "source": str(response.url),
        })
    return out
