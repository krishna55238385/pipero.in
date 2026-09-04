import json
import math
import re
from urllib.parse import urlparse

import httpx

from gtm_backend.phase1.core.retries import retry_on_transient
from gtm_backend.phase1.connectors import openai as llm_lookup
from gtm_backend.phase1.connectors import serpapi as serpapi_lookup
from gtm_backend.phase1.connectors import website as website_lookup


_client = httpx.Client(
    base_url="https://cloudflare-dns.com",
    headers={"Accept": "application/dns-json"},
    timeout=10.0,
)

_TLDS = (".com", ".io", ".co", ".net", ".ai", ".org", ".us")
_CORPORATE_SUFFIXES = ("ltd", "inc", "corp", "limited", "llc", "plc", "co")
_NON_ALNUM = re.compile(r"[^a-z0-9-]")

BLOCKED = {
    "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "yelp.com", "indeed.com", "glassdoor.com", "bbb.org", "google.com",
    "maps.google.com", "youtube.com", "wikipedia.org", "crunchbase.com",
    "bloomberg.com", "zoominfo.com", "apollo.io", "rocketreach.co",
    "tiktok.com", "pinterest.com", "reddit.com",
}

# A company name can already embed a literal domain — "Apollo.io", or a
# former/alt name in parens like "XANT (InsideSales.com)". Naively stripping
# punctuation before TLD-guessing turns "Apollo.io" into "apolloio.com" (the
# dot gets silently discarded) instead of recognising the domain that's
# already sitting right there in the name.
_EMBEDDED_DOMAIN_RE = re.compile(
    r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|io|co|net|ai|org|us)\b", re.I
)
_PAREN_RE = re.compile(r"\(([^)]*)\)")

_TOKEN_RE = re.compile(r"[a-z0-9]+")
# Corporate suffixes and bare TLD words don't distinguish one company from
# another, so they're excluded from the name-similarity comparison below —
# otherwise every domain would trivially "match" on a shared "com"/"co" token.
_STOPWORDS = {
    "inc", "llc", "ltd", "corp", "corporation", "co", "company", "the",
    "group", "holdings", "plc", "limited", "com", "io", "net", "ai", "org", "us",
}
# Fraction of the expected name's distinct tokens that must show up in the
# candidate homepage's own evidence (title/meta/schema.org) before we trust a
# DNS-resolved guess as actually belonging to that company. Rounded up, so a
# 1-2 word name (the common case) needs every token to match, not just one —
# a single shared word ("XANT" also being the brand of an unrelated Polish
# site) is not enough evidence on its own; a parenthetical alt name like
# "XANT (InsideSales.com)" exists specifically to add that second anchor.
_MATCH_THRESHOLD = 0.6

# A short/one-word brand name (expected_tokens reduces to a single token —
# "XANT", "Groove", "Apollo") is exactly the case keyword overlap can't
# disambiguate: real, unrelated companies do collide on an exact one-word
# brand (confirmed live — "XANT" also names an unrelated Polish company;
# "Groove" names at least two other unrelated products). For that case only,
# a passing keyword match is treated as merely a candidate, not a verdict,
# and gets a final LLM read of the actual homepage content — same pattern as
# Agent 06's account-intel entity check, applied here as the last
# disambiguation step rather than a prompt instruction on a bigger call.
_ENTITY_CHECK_SYSTEM = """You verify whether a company's homepage actually \
belongs to a specific company, or to a different, unrelated company that \
happens to share the same or a very similar name.

You are given:
- hostname: a candidate domain
- expected_company_name: the company being searched for
- industry_or_category_context: the expected company's industry/category, \
if known (may be null)
- homepage_evidence: real text pulled from the candidate domain's own \
homepage (title, meta description, schema.org data)

Company names occasionally collide: two real, unrelated companies can share \
the exact same one-word brand. Judge ONLY the evidence given — does this \
homepage's own description of itself match the expected company's \
industry/category? If the evidence describes a clearly different business \
(wrong industry, wrong product, a generic/parked page, or an unrelated \
company that just happens to share the name), the answer is false even \
though the name matches exactly.

When industry_or_category_context is given, require the evidence to state \
that SPECIFIC category, or a near-synonym of it, not just generic business \
language. Vague phrasing like "helping businesses make better decisions" \
or "market changes and opportunities" does NOT confirm a "sales engagement \
software" company, a "market intelligence" company, and a "productivity \
tool" company could all describe themselves that way — treat that as a \
mismatch (false), not a match. Default to false whenever the evidence is \
ambiguous or you are not confident the category actually lines up; a false \
negative (falling through to search a name a second time) is far cheaper \
than a false positive (confirming the wrong company).

Return ONLY this JSON object, no prose, no markdown:
{"same_entity": true or false, "reasoning": "one short sentence"}"""

_LLM_EVIDENCE_CHARS = 1200


@retry_on_transient()
def _query_a(hostname: str) -> dict:
    response = _client.get("/dns-query", params={"name": hostname, "type": "A"})
    response.raise_for_status()
    return response.json()


def resolve(hostname: str) -> bool:
    try:
        data = _query_a(hostname)
    except Exception:
        return False
    answers = data.get("Answer") or []
    return any(answer.get("type") == 1 for answer in answers)


def _normalize_name(company_name: str) -> str:
    lowered = company_name.lower().replace(" ", "")
    return _NON_ALNUM.sub("", lowered)


def _strip_suffix(name: str) -> str:
    for suffix in _CORPORATE_SUFFIXES:
        if name.endswith(suffix) and len(name) > len(suffix):
            return name[: -len(suffix)]
    return name


def _embedded_domain_candidates(company_name: str) -> list[str]:
    """Domain-shaped substrings already present in the raw name — e.g.
    "apollo.io" out of "Apollo.io", or "insidesales.com" out of
    "XANT (InsideSales.com)" — tried verbatim before any TLD-guessing.
    """
    seen: list[str] = []
    for match in _EMBEDDED_DOMAIN_RE.finditer(company_name):
        hostname = match.group(0).lower()
        if hostname not in seen:
            seen.append(hostname)
    return seen


def _split_parenthetical(company_name: str) -> tuple[str, str | None]:
    """Separate a trailing/inline parenthetical (a former name or alt brand)
    from the primary name so both can be tried as independent candidates —
    "XANT (InsideSales.com)" should guess off "XANT" AND "InsideSales.com",
    not the single mashed-together "xantinsidesalescom" the old normalizer
    produced by treating the parens as just more characters to strip.
    """
    match = _PAREN_RE.search(company_name)
    if not match:
        return company_name, None
    inner = match.group(1).strip()
    outer = (company_name[: match.start()] + company_name[match.end():]).strip()
    outer = re.sub(r"\s+", " ", outer)
    return (outer or company_name), (inner or None)


def _tokenize(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1}


def _llm_confirms_entity(
    hostname: str, expected_name: str, context: str | None, evidence: str,
) -> bool | None:
    """Final disambiguation step for a short/one-word brand name match: ask
    an LLM whether the candidate's own homepage content is actually about
    ``expected_name`` (in ``context``'s industry, if given), or a different
    company that happens to share the name.

    Returns None — inconclusive — on any call failure (LLM quota/network/
    malformed response), never True. An inconclusive read must not be
    treated as a pass, same conservative bias as every other check here.
    """
    payload = json.dumps({
        "hostname": hostname,
        "expected_company_name": expected_name,
        "industry_or_category_context": context,
        "homepage_evidence": evidence[:_LLM_EVIDENCE_CHARS],
    })
    try:
        raw = llm_lookup.chat_json(_ENTITY_CHECK_SYSTEM, payload, agent="dns_entity_check", phase="phase1")
    except Exception:
        return None
    if not isinstance(raw, dict):
        return None
    verdict = raw.get("same_entity")
    return verdict if isinstance(verdict, bool) else None


def _verify_domain(hostname: str, expected_name: str, context: str | None = None) -> bool:
    """Confirm a DNS-resolved candidate's own homepage plausibly belongs to
    the expected company before trusting the guess — a live A record only
    proves *some* server answers there, not that it's the right company (a
    resolvable hostname can be dead/parked, rebranded away, or a same-named
    but unrelated business). Reuses fetch_homepage_signals() (meta
    description + schema.org data) plus the page's own declared site
    name/title as first-party evidence, and requires it to actually name the
    expected company rather than trusting the DNS hit alone.

    ``context`` (e.g. an ICP's industry) is passed through to the LLM
    entity-check step below for short/one-word names — a keyword-overlap
    category gate on ``context`` was tried and removed (see
    2026-09-04 history): it rejected the real salesloft.com (whose own
    marketing copy is "AI Predictive Revenue System", with no literal
    "sales"/"engagement"/"software" token) and fell through to the wrong,
    thin salesloft.net instead, while still failing to catch the Groove
    collision it was meant to prevent (groove.ai's copy happened to mention
    "sales" incidentally). A keyword-overlap heuristic can't tell two
    real, unrelated companies apart when they share an exact one-word
    brand — that needs an actual semantic read, which is what
    ``_llm_confirms_entity`` below provides instead.

    Returns False — "unverified" — on any failure, timeout, or inconclusive
    read (e.g. a bot-walled 403, or a page with no discoverable name at all).
    An inconclusive read must not be treated as a pass.
    """
    try:
        site_name = website_lookup.fetch_site_name(hostname)
        signals = website_lookup.fetch_homepage_signals(hostname)
    except Exception:
        return False
    evidence = " ".join(
        part for part in (site_name, signals.get("meta_description"), signals.get("schema_org_text"))
        if part
    )
    if not evidence.strip():
        return False
    expected_tokens = _tokenize(expected_name)
    if not expected_tokens:
        return False
    evidence_tokens = _tokenize(evidence)
    overlap = expected_tokens & evidence_tokens
    required = max(1, math.ceil(len(expected_tokens) * _MATCH_THRESHOLD))
    if len(overlap) < required:
        return False

    if len(expected_tokens) <= 1:
        # A single distinctive token is not enough evidence on its own —
        # ask the LLM to judge the actual content as the final gate rather
        # than trusting the keyword match blindly.
        return _llm_confirms_entity(hostname, expected_name, context, evidence) is True
    return True


def _guess_hosts(base_name: str) -> list[str]:
    primary = _normalize_name(base_name)
    if not primary:
        return []
    secondary = _strip_suffix(primary)
    names = [primary]
    if secondary and secondary != primary:
        names.append(secondary)
    return [f"{name}{tld}" for name in names for tld in _TLDS]


def _search_official_site(company_name: str, context: str | None = None) -> str | None:
    """Fallback when DNS/TLD-guessing produced nothing verifiable: search for
    the company's official site and take the top legitimate-looking, LLM-
    confirmed result — never a bare, unverified guess.

    An earlier version trusted the top search result outright when nothing
    verified, on the theory that a top-ranked "official site" hit is still
    better evidence than an alphabetic TLD guess. Live-tested against "XANT"
    and "Groove" (2026-09-04) and confirmed wrong both times — it returned
    forgeglobal.com and groovelife.com respectively, neither of which is
    even the same company. For exactly the hard, ambiguous names this
    function exists for, a top search hit is not reliable enough to trust
    blindly; asking about its actual content is.
    """
    try:
        results = serpapi_lookup.search(f'"{company_name}" official site', num=5)
    except Exception:
        return None

    candidates: list[str] = []
    for result in results:
        hostname = extract_domain_from_url(result.get("link") or "")
        if hostname and hostname not in candidates:
            candidates.append(hostname)

    for hostname in candidates:
        if _verify_domain(hostname, company_name, context):
            return hostname

    # No candidate passed the name-overlap check either — ask the LLM
    # directly about the top couple of unverified candidates' real content
    # before giving up, rather than trusting an unverified guess or a name
    # match alone.
    for hostname in candidates[:2]:
        try:
            site_name = website_lookup.fetch_site_name(hostname)
            signals = website_lookup.fetch_homepage_signals(hostname)
        except Exception:
            continue
        evidence = " ".join(
            part for part in (site_name, signals.get("meta_description"), signals.get("schema_org_text"))
            if part
        )
        if not evidence.strip():
            continue
        if _llm_confirms_entity(hostname, company_name, context, evidence) is True:
            return hostname
    return None


def discover_domain(company_name: str, context: str | None = None) -> str | None:
    """Best-effort domain lookup for a company name.

    ``context`` is an optional free-text industry/category hint (e.g. an
    ICP's industry list) used only to sanity-check a verified candidate — see
    ``_verify_domain``. Omit it and behavior is unchanged (name-only checks).
    """
    if not company_name or not company_name.strip():
        return None

    # 1) The name may already contain a literal domain — try those first.
    for hostname in _embedded_domain_candidates(company_name):
        if resolve(hostname) and _verify_domain(hostname, company_name, context):
            return hostname

    # 2) TLD-guess off the primary name and any parenthetical alt name,
    #    verifying each resolved candidate before trusting it.
    outer_name, paren_name = _split_parenthetical(company_name)
    for base_name in (outer_name, paren_name):
        if not base_name:
            continue
        for hostname in _guess_hosts(base_name)[:14]:
            if resolve(hostname) and _verify_domain(hostname, company_name, context):
                return hostname

    # 3) DNS-guessing found nothing verifiable — prefer a search-based
    #    "official site" lookup over trusting an unverified bare guess.
    return _search_official_site(company_name, context)


def extract_domain_from_url(url: str) -> str | None:
    if not url or not url.strip():
        return None
    raw = url.strip()
    if "://" not in raw:
        raw = f"http://{raw}"
    parsed = urlparse(raw)
    host = (parsed.netloc or parsed.path).lower().strip()
    if host.startswith("www."):
        host = host[4:]
    host = host.split("/")[0].split(":")[0]
    if not host or host in BLOCKED:
        return None
    return host
