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
    # `gl=` on the search itself is only a Google ranking bias, not a hard
    # filter — organic results still leak other countries through. This is
    # the actual enforcement point: drop any candidate whose LLM-derived
    # company_country is a KNOWN country that doesn't match the ICP.
    expected_countries = _expected_country_codes(icp.get("geography") or [])

    candidates_by_key: dict[str, dict] = {}
    fresh: list[dict] = []
    raw_total = 0
    pages_used = 0
    geo_rejected = 0
    location_scrubbed = 0

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
            if _location_internally_inconsistent(
                cand.get("company_city"), cand.get("company_state"), cand.get("company_country"),
            ):
                # Self-contradictory combo (e.g. state="California", country="India")
                # — a data-merging artefact, not a real address. Null the whole
                # location trio rather than guessing which field is the wrong one;
                # Agent 03 will re-derive it later from a per-company search, which
                # can't cross-contaminate the way a batched multi-company LLM call can.
                location_scrubbed += 1
                cand["company_city"] = None
                cand["company_state"] = None
                cand["company_country"] = None
            if _country_mismatch(cand.get("company_country"), expected_countries):
                geo_rejected += 1
                continue
            key = (cand.get("company_name") or "").strip().lower()
            if key and key not in candidates_by_key:
                candidates_by_key[key] = cand
        fresh = _fresh_candidates(candidates_by_key, existing, existing_domains)
        print(
            f"  → page {page + 1}: {len(candidates_by_key)} unique candidates · "
            f"{len(fresh)} fresh (not in DB)"
            + (f" · {geo_rejected} geo-rejected" if geo_rejected else "")
            + (f" · {location_scrubbed} location-scrubbed" if location_scrubbed else "")
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
        "geo_rejected": geo_rejected,
        "location_scrubbed": location_scrubbed,
    }
    print(
        f"  ✓ Agent 02 complete: {len(queries)} queries · {pages_used} page(s) · "
        f"{raw_total} raw · {len(inserted_ids)} leads inserted"
        + (f" · {geo_rejected} geo-rejected" if geo_rejected else "")
        + (f" · {location_scrubbed} location-scrubbed" if location_scrubbed else "")
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

# City-level geographies (an ICP saying "Bangalore" rather than "India") used
# to fall straight through every lookup below as unrecognized — _location_for/
# _country_for returned None (no SerpAPI location/gl bias at all, so the
# search wasn't even soft-steered toward the right country), AND
# _expected_country_codes returned an empty set, which the post-search filter
# treats as "can't judge, don't reject" (a deliberately conservative default
# for genuinely unmapped geographies — see that function's docstring). The
# combination meant a city-scoped ICP got NO geography enforcement anywhere
# in the pipeline. Found live 2026-08-22: an ICP for "Bangalore" surfaced
# leads from Auckland, Dallas, Tel Aviv, Toronto, Singapore, and Palo Alto —
# Agent 03's scoring correctly flagged all of them cold/disqualified, but
# only after Agent 02 had already spent SerpAPI + LLM calls fetching and
# normalizing them. Mapping the common major cities here closes the gap for
# the same class of ICP (a specific city rather than a country/region).
_CITY_TO_COUNTRY_NAME = {
    "bangalore": "India", "bengaluru": "India", "mumbai": "India",
    "delhi": "India", "new delhi": "India", "gurgaon": "India",
    "gurugram": "India", "noida": "India", "chennai": "India",
    "hyderabad": "India", "pune": "India", "kolkata": "India",
    "ahmedabad": "India", "jaipur": "India",
    "san francisco": "United States", "new york": "United States",
    "los angeles": "United States", "austin": "United States",
    "seattle": "United States", "boston": "United States",
    "chicago": "United States", "dallas": "United States",
    "toronto": "Canada", "vancouver": "Canada",
    "london": "United Kingdom", "manchester": "United Kingdom",
    "sydney": "Australia", "melbourne": "Australia",
    "berlin": "Germany", "munich": "Germany",
    "paris": "France",
    "singapore": "Singapore",
}
_CITY_TO_COUNTRY_CODE = {
    "bangalore": "in", "bengaluru": "in", "mumbai": "in", "delhi": "in",
    "new delhi": "in", "gurgaon": "in", "gurugram": "in", "noida": "in",
    "chennai": "in", "hyderabad": "in", "pune": "in", "kolkata": "in",
    "ahmedabad": "in", "jaipur": "in",
    "san francisco": "us", "new york": "us", "los angeles": "us",
    "austin": "us", "seattle": "us", "boston": "us", "chicago": "us",
    "dallas": "us",
    "toronto": "ca", "vancouver": "ca",
    "london": "gb", "manchester": "gb",
    "sydney": "au", "melbourne": "au",
    "berlin": "de", "munich": "de",
    "paris": "fr",
    "singapore": "sg",
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

# Region geographies legitimately span more than one ISO code (e.g. "North
# America" covers both the US and Canada) — used only for the post-search
# mismatch filter below, not for the single-value `gl` search param above.
_GEOGRAPHY_ACCEPTABLE_CODES = {
    "north america": {"us", "ca"},
    "europe": {"gb", "de", "fr"},
}

# Free-text country names/abbreviations (as they actually show up in
# company_country after LLM normalization or enrichment) -> ISO alpha-2.
# Deliberately broad — anything NOT in this map is treated as "unknown" and
# never rejected, so an unrecognized country string never silently drops a
# real lead; it only rejects a CONFIDENT, KNOWN mismatch.
_COUNTRY_NAME_TO_CODE = {
    "india": "in",
    "united states": "us", "united states of america": "us", "usa": "us", "us": "us",
    "canada": "ca",
    "united kingdom": "gb", "uk": "gb", "great britain": "gb", "england": "gb",
    "germany": "de", "france": "fr", "australia": "au", "singapore": "sg",
    "pakistan": "pk", "poland": "pl", "spain": "es", "estonia": "ee",
    "netherlands": "nl", "brazil": "br", "mexico": "mx", "china": "cn",
    "japan": "jp", "uae": "ae", "united arab emirates": "ae", "ireland": "ie",
    "italy": "it", "sweden": "se", "switzerland": "ch", "nigeria": "ng",
    "south africa": "za", "philippines": "ph", "indonesia": "id",
    "vietnam": "vn", "israel": "il", "new zealand": "nz", "bangladesh": "bd",
    "sri lanka": "lk", "nepal": "np", "malaysia": "my", "thailand": "th",
}


def _expected_country_codes(geographies: list[str]) -> set[str]:
    """ISO codes acceptable for this ICP's geography, or empty if unresolvable.

    Empty means "don't filter" (geography too vague/unmapped to judge safely)
    — this must never reject a lead when we can't confidently say it's wrong.
    """
    codes: set[str] = set()
    for geo in geographies:
        key = geo.strip().lower()
        if key in _GEOGRAPHY_ACCEPTABLE_CODES:
            codes |= _GEOGRAPHY_ACCEPTABLE_CODES[key]
        elif key in _GEOGRAPHY_COUNTRY_CODE_MAP:
            codes.add(_GEOGRAPHY_COUNTRY_CODE_MAP[key])
        elif key in _CITY_TO_COUNTRY_CODE:
            codes.add(_CITY_TO_COUNTRY_CODE[key])
    return codes


def _country_mismatch(company_country: str | None, expected_codes: set[str]) -> bool:
    """True only when company_country is a KNOWN country that is NOT one of
    the ICP's expected codes — never true for unknown/blank/unmapped values.
    """
    if not expected_codes or not company_country:
        return False
    code = _COUNTRY_NAME_TO_CODE.get(company_country.strip().lower())
    if code is None:
        return False
    return code not in expected_codes


# US states (full names, as the LLM tends to write them) — used only to catch
# an internally-contradictory combo like city="San Francisco", state="California",
# country="India", regardless of what the ICP's own target geography is. This
# is a DIFFERENT check from _country_mismatch above: that one catches a
# self-consistent record for the wrong country; this one catches a record
# whose own fields disagree with each other (root-caused to Agent 02's batched
# LLM call cross-attributing fields between different companies named in the
# same shared article/roundup post).
_US_STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming",
}

_INDIA_STATE_NAMES = {
    "karnataka", "maharashtra", "telangana", "tamil nadu", "delhi", "haryana",
    "uttar pradesh", "west bengal", "gujarat", "rajasthan", "kerala", "punjab",
}


def _location_internally_inconsistent(city: str | None, state: str | None, country: str | None) -> bool:
    """True when company_state is a KNOWN US/India state name but company_country
    is a KNOWN, different country — a self-contradictory combo that can only
    come from a data-merging bug, never a real company. Unknown/blank/unmapped
    values are never flagged (same conservative bias as _country_mismatch).
    """
    if not state or not country:
        return False
    state_key = state.strip().lower()
    country_code = _COUNTRY_NAME_TO_CODE.get(country.strip().lower())
    if country_code is None:
        return False
    if state_key in _US_STATE_NAMES and country_code != "us":
        return True
    if state_key in _INDIA_STATE_NAMES and country_code != "in":
        return True
    return False


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
            key = geo.strip().lower()
            mapped = _GEOGRAPHY_LOCATION_MAP.get(key) or _CITY_TO_COUNTRY_NAME.get(key)
            if mapped:
                return mapped
        return None

    def _country_for(geos: list[str]) -> str | None:
        for geo in geos:
            key = geo.strip().lower()
            mapped = _GEOGRAPHY_COUNTRY_CODE_MAP.get(key) or _CITY_TO_COUNTRY_CODE.get(key)
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
        # Same aggregator filter used on the "0 companies" fallback path below —
        # this path used to skip it, so a raw LLM JSON-parse failure could let
        # aggregator/news/social results straight through into the (much
        # weaker, regex-only) fallback normalizer.
        return _tag_normalization_method(
            _fallback_normalize(_filter_aggregators(raw_results)), "regex_fallback"
        )
    companies = raw.get("companies") or []
    if not companies:
        print("  [Agent 02] LLM returned 0 companies, running domain fallback")
        return _tag_normalization_method(
            _fallback_normalize(_filter_aggregators(raw_results)), "regex_fallback"
        )
    return _tag_normalization_method(
        [c for c in companies if c.get("company_name")], "llm"
    )


def _tag_normalization_method(candidates: list[dict], method: str) -> list[dict]:
    """Stamps how a candidate's company_name was derived — "llm" (the primary
    path, which reasons about intent and correctly rejects article/review/job
    -board content) or "regex_fallback" (only used when the LLM call itself
    failed twice in a row; a fixed set of title/domain regexes, which will
    always be a step behind new junk shapes the LLM would have caught by
    understanding what a page actually IS, not just pattern-matching its
    title). Carried through to leads_raw.raw_data so a human reviewing a
    lead — or a future scoring rule — can see it was fallback-derived and
    treat it with appropriately less trust, instead of every lead looking
    equally reliable regardless of how it was actually produced."""
    for c in candidates:
        c["_normalization_method"] = method
    return candidates


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
    # Content/document/job-board aggregators — never a company's own site,
    # regardless of which country subdomain they're on (fr.scribd.com,
    # us.trabajo.org, etc. all still describe/aggregate, not sell).
    "scribd.com", "trabajo.org", "slideshare.net", "academia.edu",
    # Academic/research-paper repositories — a search result here is a paper
    # ABOUT a topic (and its author is a researcher, not a company contact),
    # never a company's own page. Added after a live run's fallback-normalize
    # path inserted a paper author's name ("Venugopal Vallepu") as a
    # company_name with the author's email attached during enrichment.
    "researchgate.net", "semanticscholar.org", "arxiv.org", "ssrn.com",
    "jstor.org", "sciencedirect.com", "springer.com", "ieee.org",
}


def _filter_aggregators(raw_results: list[dict]) -> list[dict]:
    return [
        r for r in raw_results
        if not any(agg in (r.get("link") or "") for agg in _AGGREGATOR_DOMAINS)
        # Pattern-based academic/thesis-repository check, not just the fixed
        # domain list above — catches hosts like unitesi.unive.it, bni-india.in
        # profile pages, or any *.edu/*.ac.* site that isn't individually
        # enumerated. See _is_academic_domain's docstring for why a fixed
        # list alone will always be one university/directory behind.
        and not _is_academic_domain(r.get("link") or "")
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
_LISTICLE_TITLE_RE = re.compile(
    r"^\s*(top|best)\s+\d+\b"    # "Top 10 ...", "Best 25 ..."
    r"|^\s*\d+\s+(top|best)\b"   # "8 Best ...", "10 Top ..." (number-first phrasing)
    r"|^\s*(top|best)\b.*\bfor\b"  # "Best ERP Systems for Small Business",
                                    # "Best WhatsApp Bot Tools for Customer
                                    # Support" — same superlative-roundup
                                    # shape as the numbered case above, just
                                    # without a leading digit.
    ,
    re.IGNORECASE,
)

# A bare filename ("multi-page.txt") accidentally surfaced as a search result
# title — never a company name under any circumstance.
_FILENAME_TITLE_RE = re.compile(
    r"^[\w\-. ]+\.(txt|pdf|docx?|xlsx?|pptx?|csv|html?|json|xml)$",
    re.IGNORECASE,
)

# Academic/thesis-repository hosts, detected by pattern rather than an
# exhaustive domain list (which will always be one university behind) — most
# academic institution domains contain ".ac." (ac.uk, ac.in) or ".edu", or
# use "thesis"/"tesi" somewhere in the host (unitesi.unive.it, thesis.*).
_ACADEMIC_DOMAIN_RE = re.compile(r"\.(edu)(\.|$)|\.ac\.[a-z]{2,3}(\.|$)|thesis|tesi\b", re.IGNORECASE)


def _is_academic_domain(link: str) -> bool:
    host = dns_lookup.extract_domain_from_url(link) or ""
    return bool(_ACADEMIC_DOMAIN_RE.search(host))


# Review/directory-profile titles on hosts not in the fixed _AGGREGATOR_DOMAINS
# list ("IT Services India Inc. Profile & Reviews" on techreviewer.co) —
# same "a fixed domain list is always one host behind" gap as academic
# domains, closed here by the title's own reliable shape instead.
_REVIEW_PROFILE_TITLE_RE = re.compile(
    r"\b(profile\s*&?\s*reviews?|reviews?\s*&?\s*ratings?)\s*$",
    re.IGNORECASE,
)

# Job-board listing titles ("Remote Jobs at Emergence", "Jobs at Acme",
# "Careers at Acme Corp") — the listing's own title names the REAL target
# company, but as a job posting, not as a company profile; never itself a
# lead. Distinct from _GENERIC_PHRASE_TITLES (exact-match "we're hiring" etc.)
# since this is a "at <company>" shape from a job-board aggregator, not the
# hiring company's own careers page.
_JOB_BOARD_TITLE_RE = re.compile(
    r"^\s*(remote\s+)?(jobs?|careers?|hiring)\s+(at|for)\b",
    re.IGNORECASE,
)

# Generic career/marketing phrases that are titles of a company's own page but
# never the company name itself ("We're Hiring!", "Careers at ...", "Join Our
# Team"). Fallback-only, same scope as the two regexes above.
_GENERIC_PHRASE_TITLES = {"we're hiring", "we are hiring", "join our team", "careers"}

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
    r"|^\s*(tips?\s+(for|to)|guide\s+(to|for)|ultimate\s+guide)\b"  # "Tips for SaaS
    # businesses in Germany" — a content-marketing article, even when hosted
    # on a real, large company's own domain (e.g. stripe.com/resources) —
    # the domain being real doesn't make the article itself a lead.
    , re.IGNORECASE,
)

# Market-research/report/academic-style titles ("Dynamic Scheduling Software
# Market Research Report 2034", "Impact of Artificial Intelligence on
# Start-ups in Delhi NCR") — never a company's own name, but distinct in
# shape from the listicle/interrogative patterns above (no "Top N", no "?").
# Fallback-only, same scope as the other title regexes: the LLM normalize
# path already rejects these via reasoning; this only guards the weaker
# regex-only path used when that LLM call itself fails or returns nothing.
_RESEARCH_REPORT_TITLE_RE = re.compile(
    r"\b(market\s+research|research\s+report|market\s+size|market\s+share|"
    r"market\s+forecast|market\s+outlook|industry\s+report|whitepaper|"
    r"white\s+paper|case\s+study|market\s+analysis|market\s+trends|"
    r"industry\s+analysis)\b"
    r"|^\s*(impact|effect|role|importance|study|analysis|overview)\s+of\b"
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
        is_generic_phrase = cleaned.strip().lower().rstrip("!.") in _GENERIC_PHRASE_TITLES
        if _FILENAME_TITLE_RE.match(cleaned):
            # A bare filename ("multi-page.txt") leaking through as a search
            # result title — never a company name, and no domain-derived
            # substitute makes sense either (this isn't a real company's
            # page at all, typically a raw document/asset link).
            continue
        if _REVIEW_PROFILE_TITLE_RE.search(cleaned):
            # "IT Services India Inc. Profile & Reviews" on a review-directory
            # host not in the fixed _AGGREGATOR_DOMAINS list — the domain
            # itself is the review site, not the reviewed company, so no
            # domain-derived substitute makes sense either. Drop entirely.
            continue
        if _JOB_BOARD_TITLE_RE.match(cleaned):
            # "Remote Jobs at Emergence" — a job-board LISTING, not a company
            # profile. The listing names a real company, but this page/domain
            # is the job board, not that company's own site — drop rather
            # than mis-derive a lead from the board's domain.
            continue
        if _RESEARCH_REPORT_TITLE_RE.search(cleaned):
            # A market-research/report/academic-style title's own domain is
            # almost always the report publisher, not a real prospect company
            # — unlike the listicle/article case below (often a genuine
            # company's own blog post), substituting the domain-derived name
            # here would just produce a different flavor of junk lead. Drop
            # entirely rather than keep a bad name of either kind. This is
            # what let rows like "Dynamic Scheduling Software Market Research
            # Report 2034" and "impact of artificial intelligence on start-up
            # in delhi ncr" through as company_name previously.
            continue
        if _LISTICLE_TITLE_RE.match(cleaned) or _ARTICLE_TITLE_RE.search(cleaned) or is_generic_phrase:
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
    normalization_method = item.get("_normalization_method", "llm")
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
        raw_data={
            "source_url": item.get("source_url"),
            "normalization_method": normalization_method,
            # Set whenever a lead's company_name/domain came from the weaker
            # regex-only fallback (see _tag_normalization_method) rather than
            # the LLM's actual reasoning about what the page is — flags it
            # for human review or a future scoring penalty instead of being
            # trusted exactly like every other lead.
            "needs_review": normalization_method == "regex_fallback",
        },
    )
