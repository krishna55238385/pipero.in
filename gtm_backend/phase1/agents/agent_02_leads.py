"""Agent 02 — Lead Generation.

Produces COMPANY records only. No contacts, no signals.
Pipeline: SerpAPI text search per industry × geography → LLM normalize →
discover/extract domain → dedupe within run + against DB → insert.
"""
import json
import re

from gtm_backend.phase1.connectors import dns as dns_lookup
from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.core.prompts import LEAD_NORMALIZATION_SYSTEM
from gtm_backend.phase1.core.schemas import Lead


# How many companies we *aim* to surface per ICP. The pagination loop keeps
# pulling result pages until this many fresh (not-already-in-DB) companies are
# found or the search options run out.
_DEFAULT_MIN_LEADS = 8
_PER_QUERY_NUM = 20          # Google results per query per page (was 10)
_MAX_PAGES = 3               # paginate up to this many pages when short of target
_LLM_NORMALIZE_CAP = 60      # max raw results sent to the LLM in one normalize call


def generate_leads(
    icp_id: int, max_leads: int = 20, min_leads: int | None = None
) -> dict:
    """Search SerpAPI for companies matching the ICP and insert net-new ones.

    Keeps pulling result pages until at least ``min_leads`` *fresh* companies
    (not already in the DB) are found or the search options are exhausted, so a
    narrow ICP — or a repeat run of the same ICP — still yields a useful batch
    instead of just the 2-3 net-new rows a single page leaves behind.
    """
    if min_leads is None:
        min_leads = min(max_leads, _DEFAULT_MIN_LEADS)

    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 02 — Lead Generation (ICP #{icp_id}, target={min_leads}-{max_leads})")
    print(bar)

    icp = supabase.get_icp(icp_id)
    queries = _build_queries(icp, max_leads)
    print(f"  → Built {len(queries)} SerpAPI queries")
    existing = supabase.get_existing_company_names(icp_id)
    existing_domains = supabase.get_existing_company_domains(icp_id)

    candidates_by_key: dict[str, dict] = {}
    fresh: list[dict] = []
    raw_total = 0
    pages_used = 0

    for page in range(_MAX_PAGES):
        raw_results = _run_searches(
            queries, per_query_num=_PER_QUERY_NUM, start=page * _PER_QUERY_NUM
        )
        if not raw_results:
            break  # no more results (or SerpAPI quota exhausted) — stop paging
        pages_used += 1
        raw_total += len(raw_results)
        raw_results = _dedupe_raw_by_domain(raw_results)
        page_cands = _attach_domains(_normalize_with_llm(raw_results, icp, icp_id))
        for cand in page_cands:
            key = (cand.get("company_name") or "").strip().lower()
            if key and key not in candidates_by_key:
                candidates_by_key[key] = cand
        fresh = _fresh_candidates(candidates_by_key, existing, existing_domains)
        print(
            f"  → page {page + 1}: {len(candidates_by_key)} unique candidates · "
            f"{len(fresh)} fresh (not in DB)"
        )
        if len(fresh) >= min_leads:
            break

    leads = [_to_lead(item, icp_id) for item in fresh[:max_leads]]
    inserted_ids = supabase.insert_leads(leads)
    if len(inserted_ids) < min_leads:
        print(
            f"  ⚠ Only {len(inserted_ids)} fresh leads found (target {min_leads}). "
            "SerpAPI results for this ICP look exhausted — broaden the ICP "
            "industry/geography, or check the SerpAPI quota."
        )
    summary = {
        "icp_id": icp_id,
        "icp_name": icp.get("name"),
        "queries_run": len(queries),
        "pages_fetched": pages_used,
        "raw_results": raw_total,
        "candidates_after_dedupe": len(candidates_by_key),
        "fresh_candidates": len(fresh),
        "leads_inserted": len(inserted_ids),
        "inserted_ids": inserted_ids,
    }
    print(
        f"  ✓ Agent 02 complete: {len(queries)} queries · {pages_used} page(s) · "
        f"{raw_total} raw · {len(inserted_ids)} leads inserted"
    )
    return summary


def _norm_domain(domain: str | None) -> str | None:
    """Lowercase + strip a leading www. so domain comparisons are stable."""
    if not domain:
        return None
    domain = domain.strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain or None


def _fresh_candidates(
    candidates_by_key: dict[str, dict],
    existing_names: set[str],
    existing_domains: set[str],
) -> list[dict]:
    """Candidates not already in the DB — by company name AND by domain.

    Name dedupe alone misses rediscoveries where the LLM normalizes the name
    slightly differently between runs ("Acme HR" vs "Acme HR Tech"); the domain
    check catches those. Domains are also deduped within the batch itself.
    """
    seen_domains: set[str] = set()
    fresh: list[dict] = []
    for key, cand in candidates_by_key.items():
        if key in existing_names:
            continue
        domain = _norm_domain(cand.get("company_domain"))
        if domain:
            if domain in existing_domains or domain in seen_domains:
                continue
            seen_domains.add(domain)
        fresh.append(cand)
    return fresh


_AGGREGATOR_EXCLUSIONS = (
    "-site:g2.com -site:capterra.com -site:crunchbase.com"
    " -site:wikipedia.org -site:linkedin.com"
    ' -"top 10" -"top 25" -"best companies" -list'
)

# Phrasing variants so a *narrow* ICP (e.g. one industry × one geography) still
# produces several distinct discovery queries instead of a single one. Each
# template is biased toward company/vendor pages rather than funding-news pages.
_GEO_TEMPLATES = (
    "{ind} companies in {geo}",
    "{ind} software providers in {geo}",
    "{ind} startups in {geo}",
    "{ind} solution vendors in {geo}",
    "{ind} platform companies in {geo}",
)
_NOGEO_TEMPLATES = (
    "{ind} companies",
    "{ind} software providers",
    "{ind} startups",
    "{ind} solution vendors",
    "{ind} platform companies",
)
_GEO_ONLY_TEMPLATES = (
    "software companies in {geo}",
    "b2b technology companies in {geo}",
    "saas companies in {geo}",
    "tech startups in {geo}",
    "enterprise software vendors in {geo}",
)
_MIN_QUERIES = 5
_MAX_QUERIES = 12

_GEOGRAPHY_LOCATION_MAP = {
    "north america": "United States",
    "united states": "United States",
    "usa": "United States",
    "us": "United States",
    "canada": "Canada",
    "europe": "United Kingdom",
    "uk": "United Kingdom",
    "united kingdom": "United Kingdom",
    "india": "India",
    "australia": "Australia",
    "germany": "Germany",
    "france": "France",
    "singapore": "Singapore",
}

# ISO 3166-1 alpha-2 country codes for SerpAPI's `gl` param — a HARD country
# restriction, unlike `location` above which is only a soft ranking hint.
# Without this, broad queries like "software companies in India" kept
# surfacing mostly US/global results since Google organic search doesn't
# strictly geo-filter on location text alone.
_GEOGRAPHY_COUNTRY_CODE_MAP = {
    "north america": "us",
    "united states": "us",
    "usa": "us",
    "us": "us",
    "canada": "ca",
    "europe": "gb",
    "uk": "gb",
    "united kingdom": "gb",
    "india": "in",
    "australia": "au",
    "germany": "de",
    "france": "fr",
    "singapore": "sg",
}


def _build_queries(icp: dict, max_leads: int) -> list[tuple[str, str | None, str | None]]:
    """Return a list of (query_string, serpapi_location_or_None, country_code_or_None) tuples.

    Business-stage keywords (``"Series A" OR ...``) are deliberately *not* added:
    they bias Google toward funding-news articles instead of company homepages,
    which is what starves the funnel. Stage fit is judged later in scoring.
    """
    industries = icp.get("industry") or []
    geographies = icp.get("geography") or []
    size_clause = _size_clause(icp.get("company_size_min"), icp.get("company_size_max"))

    def _location_for(geos: list[str]) -> str | None:
        for geo in geos:
            mapped = _GEOGRAPHY_LOCATION_MAP.get(geo.strip().lower())
            if mapped:
                return mapped
        return None

    def _country_for(geos: list[str]) -> str | None:
        for geo in geos:
            mapped = _GEOGRAPHY_COUNTRY_CODE_MAP.get(geo.strip().lower())
            if mapped:
                return mapped
        return None

    location = _location_for(geographies)
    country = _country_for(geographies)
    # Aim for ~half the requested leads in distinct queries (each page then
    # returns up to _PER_QUERY_NUM results), bounded to a sane range.
    target = max(_MIN_QUERIES, min(_MAX_QUERIES, max_leads // 2))

    if industries and geographies:
        pairs = [(ind, geo) for ind in industries[:3] for geo in geographies[:3]]
        templates = _GEO_TEMPLATES
    elif industries:
        pairs = [(ind, None) for ind in industries[:5]]
        templates = _NOGEO_TEMPLATES
    elif geographies:
        pairs = [(None, geo) for geo in geographies[:5]]
        templates = _GEO_ONLY_TEMPLATES
    else:
        return [(f"b2b saas companies {_AGGREGATOR_EXCLUSIONS}", None, None)]

    # Template-major order interleaves templates across pairs, so we get breadth
    # (every industry/geo combo) before depth (more phrasings of the same combo).
    raw_queries: list[tuple[str, str | None, str | None]] = []
    for template in templates:
        for ind, geo in pairs:
            core = template.format(ind=ind, geo=geo)
            raw_queries.append((f"{core}{size_clause} {_AGGREGATOR_EXCLUSIONS}", location, country))
            if len(raw_queries) >= target:
                return raw_queries
    return raw_queries


def _size_clause(size_min: int | None, size_max: int | None) -> str:
    if size_min and size_max:
        return f" {size_min}-{size_max} employees"
    return ""


def _run_searches(
    queries: list[tuple[str, str | None, str | None]], per_query_num: int, start: int = 0
) -> list[dict]:
    out = []
    for query, location, country in queries:
        try:
            results = serpapi.search(
                query, num=per_query_num, location=location, start=start, country=country
            )
        except Exception as exc:
            print(f"  [Agent 02] serpapi error on '{query}': {exc}")
            continue
        for result in results:
            result["_query"] = query
            out.append(result)
    return out


def _normalize_with_llm(raw_results: list[dict], icp: dict, icp_id: int) -> list[dict]:
    if not raw_results:
        return []
    payload = {
        "icp_hint": {
            "industry": icp.get("industry"),
            "geography": icp.get("geography"),
        },
        "results": [
            {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
            for r in raw_results[:_LLM_NORMALIZE_CAP]
        ],
    }
    try:
        raw = llm.chat_json(
            LEAD_NORMALIZATION_SYSTEM,
            json.dumps(payload),
            agent="agent_02_leads",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 02] normalization fallback (LLM error: {exc})")
        return _fallback_normalize(raw_results)
    companies = raw.get("companies") or []
    if not companies:
        print("  [Agent 02] LLM returned 0 companies, running domain fallback")
        return _fallback_normalize(_filter_aggregators(raw_results))
    return [c for c in companies if c.get("company_name")]


_AGGREGATOR_DOMAINS = {
    # Review / directory / listicle sites
    "g2.com", "capterra.com", "crunchbase.com", "wikipedia.org", "linkedin.com",
    "trustradius.com", "getapp.com", "softwareadvice.com", "clutch.co",
    "wellfound.com", "angel.co", "glassdoor.com", "indeed.com", "ambitionbox.com",
    "marketresearchfuture.com", "technologycounter.com",
    # Lead/contact databases — profile pages *about* a company, not its own site.
    "leadiq.com", "zoominfo.com", "apollo.io", "rocketreach.co", "lusha.com",
    "owler.com", "dnb.com",
    # Social platforms — never a company's primary site
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "reddit.com", "medium.com", "quora.com", "pinterest.com", "tiktok.com",
    # News / press / trade / government / market-research — describe or report
    # on companies and industries, but are never a company's own homepage.
    "techcrunch.com", "yourstory.com", "inc42.com", "forbes.com", "bloomberg.com",
    "thesaasnews.com", "entrackr.com", "moneycontrol.com", "retailwire.com",
    "census.gov", "trade.gov", "sba.gov",
}


def _filter_aggregators(raw_results: list[dict]) -> list[dict]:
    return [
        r for r in raw_results
        if not any(agg in (r.get("link") or "") for agg in _AGGREGATOR_DOMAINS)
    ]


def _dedupe_raw_by_domain(raw_results: list[dict]) -> list[dict]:
    """Drop aggregator/news/social links and collapse same-domain results.

    Runs *before* the LLM so the normalize call spends its budget on distinct
    candidate companies instead of ten news articles about the same one.
    """
    seen: set[str] = set()
    out: list[dict] = []
    for r in raw_results:
        link = r.get("link") or ""
        if any(agg in link for agg in _AGGREGATOR_DOMAINS):
            continue
        host = dns_lookup.extract_domain_from_url(link)
        if host is None:
            continue  # blocked/social host or unparseable link
        if host in seen:
            continue
        seen.add(host)
        out.append(r)
    return out


# Matches listicle/ranking-style titles ("Top 100 VARs 2024", "Best 25 SaaS
# tools") which are never a company's own name — even when the *link* is the
# company's own domain (e.g. a company's own blog post announcing they made
# such a list). This is the fallback-only path (used when the LLM normalize
# call fails), so it has no LLM reasoning to catch this the way
# LEAD_NORMALIZATION_SYSTEM's rejection rule does for the primary path.
_LISTICLE_TITLE_RE = re.compile(r"^\s*(top|best)\s+\d+\b", re.IGNORECASE)

# Broader companion to _LISTICLE_TITLE_RE: catches general article/blog
# headlines ("How Many U.S. Businesses Offer Health Insurance...", "Custom
# Software Development for Startups: A Decision Guide", "Is Bentonville the
# New Retail Innovation Capital?") that aren't "Top N" listicles but are still
# never a company's own name. Same fallback-only scope as above.
_ARTICLE_TITLE_RE = re.compile(
    r"^\s*(how|why|what|is|does|are|can|should)\b.*[?:]"  # interrogative/explainer headline
    r"|\?\s*$"                                             # ends in a question mark
    r"|:\s*a\s+(decision|complete|beginner'?s?)\s+guide"   # "...: A Decision Guide"
    r"|\bvs[.]?\s"                                          # "X vs Traditional Y" comparisons
    , re.IGNORECASE,
)


# Generic subdomains that are never the brand itself ("blog.cimcloud.com"
# should yield "Cimcloud", not "Blog").
_GENERIC_SUBDOMAINS = {"www", "blog", "shop", "app", "get", "info", "news", "support", "help"}


def _company_name_from_domain(url: str) -> str | None:
    """Best-effort company name derived from a domain ("netatwork.com" ->
    "Netatwork", "acme-hr.com" -> "Acme Hr", "blog.cimcloud.com" -> "Cimcloud").
    Used only as a fallback-of-the-fallback when the page title itself looks
    unusable as a company name.
    """
    domain = dns_lookup.extract_domain_from_url(url)
    if not domain:
        return None
    labels = domain.split(".")
    # Skip a leading generic subdomain (blog., www., ...) and the TLD, land on
    # the actual brand label — e.g. ["blog","cimcloud","com"] -> "cimcloud".
    if len(labels) > 2 and labels[0].lower() in _GENERIC_SUBDOMAINS:
        label = labels[1]
    else:
        label = labels[0]
    parts = [p for p in re.split(r"[-_]", label) if p]
    if not parts:
        return None
    return " ".join(p.capitalize() for p in parts)


def _fallback_normalize(raw_results: list[dict]) -> list[dict]:
    out = []
    for result in raw_results:
        title = result.get("title") or ""
        link = result.get("link") or ""
        if not title or "..." in title[:5]:
            continue
        cleaned = title.split(" - ")[0].split(" | ")[0].strip()[:120]
        if _LISTICLE_TITLE_RE.match(cleaned) or _ARTICLE_TITLE_RE.search(cleaned):
            # The title is a ranking/listicle or article/blog headline, not a
            # company name (this is what previously produced garbage rows like
            # company_name="Top 100 Vars" for a lead whose real domain,
            # netatwork.com, belongs to a company called NetAtWork — and more
            # broadly any "How Many...?"/"X vs Y"/"...: A Decision Guide" title).
            domain_name = _company_name_from_domain(link)
            if domain_name:
                cleaned = domain_name
        out.append({
            "company_name": cleaned,
            "company_website": link,
            "source_url": link,
        })
    return out


def _attach_domains(candidates: list[dict]) -> list[dict]:
    for c in candidates:
        website = c.get("company_website")
        domain = dns_lookup.extract_domain_from_url(website) if website else None
        if not domain:
            domain = dns_lookup.discover_domain(c.get("company_name") or "")
        c["company_domain"] = domain
        if domain and not c.get("company_website"):
            c["company_website"] = f"https://{domain}"
    return candidates


def _to_lead(item: dict, icp_id: int) -> Lead:
    return Lead(
        icp_id=icp_id,
        company_name=item["company_name"],
        company_domain=item.get("company_domain"),
        company_website=item.get("company_website"),
        company_city=item.get("company_city"),
        company_state=item.get("company_state"),
        company_country=item.get("company_country"),
        company_industry=item.get("company_industry"),
        company_size=item.get("company_size"),
        source="serpapi",
        sources=["serpapi"],
        raw_data={"source_url": item.get("source_url")},
    )
