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
from gtm_backend.phase1.connectors import website
from gtm_backend.phase1.core.prompts import FIRMOGRAPHIC_CONFIDENCE_SYSTEM, LEAD_NORMALIZATION_SYSTEM
from gtm_backend.phase1.core.schemas import Lead


# How many companies we *aim* to surface per ICP. The pagination loop keeps
# pulling result pages until this many fresh (not-already-in-DB) companies are
# found or the search options run out.
_DEFAULT_MIN_LEADS = 8
_PER_QUERY_NUM = 20          # Google results per query per page (was 10)
_MAX_PAGES = 3               # paginate up to this many pages when short of target
# Max raw results sent to the LLM in one normalize call. Was 60 — found live
# 2026-09-02 (ICP #57, Jobraux): a single normalize call sending 60 results
# (each title+link+snippet) against a system prompt that's grown to ~1,700
# tokens on its own regularly triggered Groq 400 "Failed to validate JSON"
# errors, plausibly from the combined input+expected-output size (up to 60
# structured company records) pushing against reliable single-shot JSON
# generation, compounded by this account's constrained 8,000 TPM ceiling
# shared across every LLM call in the pipeline. Halved to shrink both the
# input and the expected output per call.
_LLM_NORMALIZE_CAP = 30


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
    industries = icp.get("industry") or []
    queries = _build_queries(icp, max_leads)
    print(f"  → Built {len(queries)} SerpAPI queries")
    existing = supabase.get_existing_company_names(icp_id)
    existing_domains = supabase.get_existing_company_domains(icp_id)
    # Task #8 — cross-ICP duplicate detection: the same company independently
    # discovered by two different ICPs for the same org (e.g. two similar
    # "India SaaS" ICPs both surfacing the same company) must not become two
    # separate lead rows. leads_raw.icp_id is a single FK column (no
    # lead<->ICP join table), so a lead can only ever belong to one ICP — the
    # correct behavior is skip-and-count, not "also tag" the existing lead.
    org_id = icp.get("organization_id")
    org_existing_domains = supabase.get_existing_company_domains_for_org(org_id)
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
    rejected_unclear_geography = 0
    location_scrubbed = 0
    industry_rejected = 0
    cross_icp_duplicates = 0

    for page in range(_MAX_PAGES):
        raw_results = _run_searches(
            queries, per_query_num=_PER_QUERY_NUM, start=page * _PER_QUERY_NUM
        )
        if not raw_results:
            break  # no more results (or SerpAPI quota exhausted) — stop paging
        pages_used += 1
        raw_total += len(raw_results)
        raw_results = _dedupe_raw_by_domain(raw_results)
        page_cands = _apply_firmographic_confidence(
            _apply_domain_identity(
                _attach_domains(_normalize_with_llm(raw_results, icp, icp_id))
            ),
            icp_id,
        )
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
            if (
                cand.get("_normalization_method") != "regex_fallback"
                and _unclear_geography_rejected(cand.get("geography_confidence"), expected_countries)
            ):
                # ICP has an explicit target country, but this candidate's own
                # country couldn't be confidently confirmed (missing/"unclear"
                # geography_confidence) — distinct from geo_rejected above,
                # which only fires on a KNOWN, confidently-wrong country. This
                # is the gap that let e.g. a Melbourne, Australia company
                # through an India-only ICP: an unmapped/unconfirmed country
                # used to default to "keep", not "reject".
                #
                # EXCEPTION (found live 2026-09-02, ICP #57): regex-fallback
                # candidates (used when the LLM normalize call itself fails)
                # NEVER carry geography_confidence at all — that field only
                # exists in the LLM's structured output. Applying the strict
                # check to them meant ANY LLM failure zeroed out results
                # entirely for every country-scoped ICP, which is worse than
                # the old permissive behavior this fix was meant to improve
                # on. These candidates are already flagged needs_review=True
                # (see _tag_normalization_method/_to_lead) — that's the right
                # signal for "unverified," not silent deletion before a
                # human ever sees them.
                #
                # SECOND EXCEPTION (found live 2026-09-03, ICP #60/#61): a
                # search snippet from a content-marketing/comparison-blog
                # page ("Workday vs Competitors", "8 Best UKG Alternatives")
                # never states a location even when the linked domain is a
                # real, on-ICP company — the page describes a market
                # category, not itself. Before rejecting, give the
                # candidate's own homepage a chance to confirm geography
                # first-party (schema.org address / "headquartered in" /
                # ccTLD) rather than trusting only the snippet that happened
                # to surface it.
                if _confirm_geography_from_homepage(cand.get("company_domain"), expected_countries):
                    cand["geography_confidence"] = "confirmed"
                    cand["_geography_confirmed_via"] = "homepage_check"
                else:
                    rejected_unclear_geography += 1
                    continue
            if _looks_like_content_page(cand.get("source_url")):
                cand["_content_page_suspect"] = True
            if industries and _industry_mismatch(cand.get("industry_match")):
                industry_rejected += 1
                continue
            key = (cand.get("company_name") or "").strip().lower()
            if key and key not in candidates_by_key:
                candidates_by_key[key] = cand
        same_icp_fresh = _fresh_candidates(candidates_by_key, existing, existing_domains)
        fresh, new_cross_icp_dupes = _drop_cross_icp_duplicates(same_icp_fresh, org_existing_domains)
        cross_icp_duplicates += new_cross_icp_dupes
        print(
            f"  → page {page + 1}: {len(candidates_by_key)} unique candidates · "
            f"{len(fresh)} fresh (not in DB)"
            + (f" · {geo_rejected} geo-rejected" if geo_rejected else "")
            + (f" · {rejected_unclear_geography} unclear-geo-rejected" if rejected_unclear_geography else "")
            + (f" · {industry_rejected} industry-rejected" if industry_rejected else "")
            + (f" · {location_scrubbed} location-scrubbed" if location_scrubbed else "")
            + (f" · {cross_icp_duplicates} cross-icp-duplicate" if cross_icp_duplicates else "")
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
    # Task #7 — any low-quota/hard-failure warning the search provider chain
    # logged during this run (SerpAPI/Serper/Tavily). Folded into the
    # returned summary — not just printed — so it surfaces in phase_runs and
    # the CRM's pipeline-runs view, since this codebase has no separate
    # Slack/email alerting channel to send it to instead.
    quota_warnings = serpapi.get_and_clear_quota_warnings()

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
        "rejected_unclear_geography": rejected_unclear_geography,
        "industry_rejected": industry_rejected,
        "location_scrubbed": location_scrubbed,
        "cross_icp_duplicates": cross_icp_duplicates,
        "quota_warnings": quota_warnings,
    }
    print(
        f"  ✓ Agent 02 complete: {len(queries)} queries · {pages_used} page(s) · "
        f"{raw_total} raw · {len(inserted_ids)} leads inserted"
        + (f" · {geo_rejected} geo-rejected" if geo_rejected else "")
        + (f" · {rejected_unclear_geography} unclear-geo-rejected" if rejected_unclear_geography else "")
        + (f" · {industry_rejected} industry-rejected" if industry_rejected else "")
        + (f" · {location_scrubbed} location-scrubbed" if location_scrubbed else "")
        + (f" · {cross_icp_duplicates} cross-icp-duplicate" if cross_icp_duplicates else "")
    )
    if quota_warnings:
        print(f"  ⚠⚠⚠ {len(quota_warnings)} quota warning(s) this run: {'; '.join(quota_warnings)}")
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


def _drop_cross_icp_duplicates(
    candidates: list[dict], org_existing_domains: set[str]
) -> tuple[list[dict], int]:
    """Candidates whose domain already exists SOMEWHERE ELSE in this org —
    under a different ICP (Task #8).

    Must run AFTER _fresh_candidates, not instead of it: every candidate
    reaching this function has already survived the same-ICP name+domain
    check, so any domain match against org_existing_domains here is, by
    construction, a duplicate from a DIFFERENT ICP specifically — this
    ordering is what lets the two dedup reasons be counted distinctly
    without extra bookkeeping (found live running two similar "India SaaS"
    ICPs back to back, which independently rediscovered several of the same
    companies as separate lead rows).

    leads_raw.icp_id is a single FK column — no lead<->ICP join table exists
    in the schema — so a lead can only ever belong to one ICP. The only
    schema-correct behavior is skip-and-count, not "also link" the existing
    lead to the new ICP.
    """
    out: list[dict] = []
    dropped = 0
    for cand in candidates:
        domain = _norm_domain(cand.get("company_domain"))
        if domain and domain in org_existing_domains:
            dropped += 1
            continue
        out.append(cand)
    return out, dropped


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


def _industry_mismatch(industry_match: object) -> bool:
    """True only when the LLM explicitly flagged a confident industry mismatch.

    Mirrors _country_mismatch's conservative bias: "unclear", missing, or any
    unexpected value never rejects a lead — only an explicit "no" does, since
    the prompt itself is instructed to default to "unclear" whenever it can't
    confidently judge the fit. This runs only on the LLM-normalize path (the
    regex-only fallback has no such field and is never filtered on industry,
    same scope limitation already documented for the geography filter).
    """
    return str(industry_match or "").strip().lower() == "no"


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


def _unclear_geography_rejected(geography_confidence: object, expected_codes: set[str]) -> bool:
    """True only when the ICP has an explicit target country AND this
    candidate's own geography_confidence isn't "confirmed" (missing, None,
    "unclear", or any other value — the LLM prompt only ever emits
    "confirmed"/"unclear", but any unrecognized value is treated the same
    conservative way: not confirmed).

    This flips the previous default (unclear -> keep) specifically when we
    have a real geography constraint to enforce — a country-unmapped or
    low-evidence lead is no longer assumed innocent just because
    _country_mismatch above couldn't prove it wrong. When the ICP has NO
    target country (expected_codes empty), this always returns False —
    behavior is completely unchanged for geography-agnostic ICPs.

    Candidates from the regex-only fallback normalizer (no LLM call at all,
    so no geography_confidence field ever set) fall into "not confirmed"
    here too — correct, since that path has zero evidence about geography.
    """
    if not expected_codes:
        return False
    return str(geography_confidence or "").strip().lower() != "confirmed"


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


# ccTLDs reliable enough to treat as a geography signal on their own — i.e.
# ones a company only realistically registers if it's actually based (or has
# a real local entity) there. Deliberately excludes vanity TLDs that get
# chosen for branding regardless of location (.io, .ai, .co, .us) — those
# would turn plenty of US/global companies into false "confirmed" matches
# for the wrong country.
_RELIABLE_CCTLD_TO_COUNTRY_CODE = {
    "in": "in",
    "uk": "gb", "co.uk": "gb",
    "de": "de", "fr": "fr", "ca": "ca",
    "au": "au", "com.au": "au",
    "sg": "sg", "nz": "nz", "ie": "ie", "za": "za", "jp": "jp", "cn": "cn",
    "br": "br", "mx": "mx", "nl": "nl", "ch": "ch", "se": "se", "it": "it",
    "es": "es", "pl": "pl",
}

_ADDRESS_COUNTRY_RE = re.compile(r'"addressCountry"\s*:\s*"([^"]+)"', re.IGNORECASE)
_HQ_LANGUAGE_RE = re.compile(
    r"(?:headquartered|head[- ]?quarters?|based)\s+in\s+([A-Za-z][A-Za-z .,'-]{2,60})",
    re.IGNORECASE,
)

# Blog/comparison/alternatives content riding on a real company's own domain
# — "Workday vs Competitors", "8 Best UKG Alternatives", a pricing-guide post
# — describes a market category, not the company itself, which is exactly
# why these pages never state a location (see _confirm_geography_from_homepage).
# Deliberately loose and checked against the URL path only, never used to
# drop a candidate outright: some genuine product pages legitimately contain
# "best"/"vs-" in their own slug too. Only used to flag extra scrutiny.
_CONTENT_PAGE_URL_RE = re.compile(r"/blog/|/alternatives/|vs-|best-", re.IGNORECASE)


def _looks_like_content_page(url: str | None) -> bool:
    return bool(url) and bool(_CONTENT_PAGE_URL_RE.search(url))


def _country_code_from_place_text(text: str) -> str | None:
    """Best-effort ISO code from free text pulled off a homepage — a bare
    2-letter code as schema.org addressCountry usually is, a known country
    name, or a known city name (including one buried in a comma-separated
    "City, State, Country" address string)."""
    key = text.strip().strip(".,").lower()
    if not key:
        return None
    if len(key) == 2:
        return key
    if key in _COUNTRY_NAME_TO_CODE:
        return _COUNTRY_NAME_TO_CODE[key]
    if key in _CITY_TO_COUNTRY_CODE:
        return _CITY_TO_COUNTRY_CODE[key]
    parts = [p.strip() for p in key.split(",") if p.strip()]
    for part in (parts[0] if parts else None, parts[-1] if parts else None):
        if part and part in _CITY_TO_COUNTRY_CODE:
            return _CITY_TO_COUNTRY_CODE[part]
        if part and part in _COUNTRY_NAME_TO_CODE:
            return _COUNTRY_NAME_TO_CODE[part]
    return None


def _confirm_geography_from_homepage(domain: str | None, expected_codes: set[str]) -> bool:
    """Second opinion for a candidate about to be rejected for unclear
    geography — common for content-marketing/comparison-blog pages, which
    describe a market category rather than the company itself and so never
    mention a location, even when the company IS real and IS a legitimate
    candidate (its own blog just happened to rank for the search query).

    Fetches the candidate's domain ROOT homepage (not the specific blog page
    the search result linked to — reuses website.fetch_homepage_signals, the
    same first-party-evidence fetch already used for firmographic
    confidence) and checks it for geography evidence the search snippet
    never had a chance to surface: schema.org address markup,
    "headquartered in .../based in ..." language, or — as the weakest,
    last-resort signal — a reliable country-code TLD.

    Returns True only when one of these confidently resolves to one of the
    ICP's expected countries. Best-effort and one-directional: any fetch
    failure, missing signal, or unmapped location just leaves the original
    rejection in place — this only ever RESCUES a candidate, never rejects
    one that the earlier checks didn't already reject.
    """
    if not domain or not expected_codes:
        return False
    signals = website.fetch_homepage_signals(domain)

    addr_match = _ADDRESS_COUNTRY_RE.search(signals.get("schema_org_text") or "")
    if addr_match:
        code = _country_code_from_place_text(addr_match.group(1))
        if code and code in expected_codes:
            return True

    hq_match = _HQ_LANGUAGE_RE.search(signals.get("meta_description") or "")
    if hq_match:
        code = _country_code_from_place_text(hq_match.group(1))
        if code and code in expected_codes:
            return True

    domain_parts = domain.strip().lower().split(".")
    candidate_tlds = [".".join(domain_parts[-2:]), domain_parts[-1]] if len(domain_parts) >= 2 else domain_parts
    for tld in candidate_tlds:
        code = _RELIABLE_CCTLD_TO_COUNTRY_CODE.get(tld)
        if code and code in expected_codes:
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
    companies = [c for c in companies if c.get("company_name")]
    for c in companies:
        _correct_event_forum_company_name(c)
    return _tag_normalization_method(companies, "llm")


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
    # Job boards not already covered above (indeed.com/glassdoor.com/
    # wellfound.com/angel.co/ambitionbox.com only caught the biggest global
    # names) — found live 2026-08-22: a job-listing page's own headline
    # ("Manager, Software Engineering (Bangalore) with 10", "IT Support
    # Engineer (4:00 PM TO 1:00 AM Shift)") got inserted as company_name,
    # with the enriched contact email traced back to monster.com.vn and
    # startup.jobs — these domains were never excluded, so they reached the
    # LLM normalize call and relied entirely on its judgment instead of
    # being filtered out before it ever saw them.
    "monster.com", "foundit.com", "foundit.sg", "naukri.com", "shine.com",
    "timesjobs.com", "dice.com", "ziprecruiter.com", "simplyhired.com",
    "snagajob.com", "careerxperts.com",
    # Business directories/listicle-farms — same failure shape as the
    # job boards above ("Forensic Accounting & CFE Fraud Investigation in
    # HSR Layout ...", "Top Computer Software Solution Providers in Nad
    # Kotha ..." both traced to justdial.com).
    "justdial.com", "sulekha.com", "indiamart.com", "tradeindia.com",
    # HubSpot's own partner/app-marketplace directory — hubspot.com itself
    # is a real company, but this specific subdomain lists OTHER
    # companies/agencies, same "describes, doesn't sell" issue as g2.com
    # etc. ("Search Top Agencies & Service Providers" traced here).
    "ecosystem.hubspot.com",
    # Blog/content hosting platforms — a result here is someone's blog POST,
    # never a company's own site (substring match also catches every
    # "*.wordpress.com" subdomain, e.g. "acmehr.wordpress.com").
    "medium.com", "wordpress.com",
    # Industry associations / analyst / trade-media sites — describe or
    # cover an industry's companies, never sell anything themselves. Seeded
    # from a live 2026-09-02 Jobraux run (India B2B SaaS ICP) that surfaced
    # these as "leads" instead of the companies they were reporting on.
    "nasscom.in", "saasboomi.org", "zinnov.com",
}

# Job-board BRANDS that operate under multiple country TLDs (glassdoor.co.in,
# indeed.co.uk, naukri.com, etc.) — the fixed _AGGREGATOR_DOMAINS entries
# above only catch the .com variant of each. Matched by brand root regardless
# of TLD, same "a fixed domain list is always one TLD behind" reasoning as
# _JOB_BOARD_DOMAIN_RE below.
_JOB_BOARD_BRAND_RE = re.compile(
    r"(^|\.)(glassdoor|indeed|naukri)\.[a-z.]{2,10}$", re.IGNORECASE
)


# Job-board hosts detected by pattern rather than an exhaustive domain list
# (same reasoning as _is_academic_domain — a fixed list is always one board
# behind). Catches the ".jobs" gTLD (e.g. startup.jobs) and any "jobs."
# subdomain (e.g. jobs.careerxperts.com) regardless of the base domain.
_JOB_BOARD_DOMAIN_RE = re.compile(r"(^|\.)jobs(\.[a-z]{2,3})?$|^jobs\.", re.IGNORECASE)


def _is_job_board_domain(link: str) -> bool:
    host = dns_lookup.extract_domain_from_url(link) or ""
    return bool(_JOB_BOARD_DOMAIN_RE.search(host) or _JOB_BOARD_BRAND_RE.search(host))


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
        # Same reasoning applied to job boards — see _is_job_board_domain.
        and not _is_job_board_domain(r.get("link") or "")
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
        if _is_job_board_domain(link):
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


# A safety net for the LLM normalize path: LEAD_NORMALIZATION_SYSTEM already
# instructs the model to derive the real brand from the domain instead of
# copying a page title for careers/listicle/directory pages — but found live
# 2026-08-22 to be unreliable for a DIFFERENT shape: event/forum/community
# pages hosted on the company's OWN, legitimate domain (e.g. a Checkpoint
# community-forum thread titled "VPN" on checkpoint.com, or "D2L Connection:
# Bangalore Event by D2L" on d2l.com) — the LLM sometimes still copies the
# literal thread/event title as company_name even though prompt-compliance
# elsewhere in this same call is otherwise solid. Since the domain IS the
# real company's own site here (unlike the careers/listicle case, where the
# domain is a third party), a code-level correction is safe: if the returned
# company_name matches an unambiguous event/forum/community title shape, and
# a domain-derived brand name is available and differs, override it. This
# deliberately does NOT try to catch bare generic-word titles with no such
# signal phrase (e.g. a lone "VPN") — that shape is indistinguishable from a
# legitimately short brand name (e.g. "Wiz", "Okta") without more context,
# so it's left as a known remaining gap rather than risking false corrections.
_EVENT_FORUM_TITLE_RE = re.compile(
    r"\bevent\s+by\b|\bwebinar\b|\bmeetup\b|\bconference\b|\bforum\b|"
    r"\bcommunity\b|\bdiscussion\b|\bthread\b",
    re.IGNORECASE,
)


def _correct_event_forum_company_name(candidate: dict) -> None:
    """Mutates candidate in place: swaps an event/forum-shaped company_name
    for the domain-derived brand, when one is available and differs."""
    name = (candidate.get("company_name") or "").strip()
    if not name or not _EVENT_FORUM_TITLE_RE.search(name):
        return
    website = candidate.get("company_website") or candidate.get("source_url")
    if not website:
        return
    domain_name = _company_name_from_domain(website)
    if not domain_name or domain_name.strip().lower() == name.lower():
        return
    candidate["company_name"] = domain_name
    candidate["_name_corrected_from"] = name


def _attach_domains(candidates: list[dict]) -> list[dict]:
    for c in candidates:
        site = c.get("company_website")
        domain = dns_lookup.extract_domain_from_url(site) if site else None
        if not domain:
            domain = dns_lookup.discover_domain(c.get("company_name") or "")
        c["company_domain"] = domain
        if domain and not c.get("company_website"):
            c["company_website"] = f"https://{domain}"
    return candidates


def _domain_derived_name(domain: str | None) -> str | None:
    """The company's own declared name, fetched from its homepage — see
    website.fetch_site_name's docstring. Thin wrapper kept separate (rather
    than calling website.fetch_site_name directly at each call site) so
    tests can mock this one seam."""
    if not domain:
        return None
    return website.fetch_site_name(domain)


def _apply_domain_identity(candidates: list[dict]) -> list[dict]:
    """Domain-first identity (Task: Lead Identity Verification, item 1).

    A search result's title/snippet describes what a specific PAGE is about
    — a listicle, a news article, a directory profile — which is how
    "Top 100 VARs 2024" or "IT Services India Inc. Profile & Reviews" used to
    end up as company_name despite the earlier title-cleanup heuristics.
    Once a candidate has a resolved domain, its own homepage is a much more
    reliable source: fetch the ACTUAL homepage (not the specific article/
    listing URL the search result linked to) and prefer its declared
    og:site_name/<title> brand over whatever the snippet-based normalizer
    produced. Falls back to the existing name untouched when the homepage
    fetch fails (unreachable domain, no title found) — this must never drop
    a candidate outright, only upgrade its name when a better one is found.
    """
    for c in candidates:
        domain = c.get("company_domain")
        if not domain:
            continue
        site_name = _domain_derived_name(domain)
        if site_name and site_name.strip() and site_name.strip() != c.get("company_name"):
            c["_name_before_domain_identity"] = c.get("company_name")
            c["company_name"] = site_name.strip()
    return candidates


# Legal-entity suffixes stripped before comparing two company names, so
# "Acme Inc." vs "Acme" isn't treated as a divergence.
_LEGAL_SUFFIX_RE = re.compile(
    r"\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|"
    r"pvt|private|plc|gmbh|llp)\b\.?", re.IGNORECASE
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9 ]")


def _normalize_company_name(name: str) -> str:
    cleaned = _LEGAL_SUFFIX_RE.sub(" ", name.lower())
    cleaned = _NON_ALNUM_RE.sub(" ", cleaned)
    return " ".join(cleaned.split())


def _names_diverge(stored_name: str, domain_name: str) -> bool:
    """True when two company names look like they name DIFFERENT
    organizations, not just a formatting difference.

    Deliberately permissive (substring containment either direction, after
    stripping legal suffixes/punctuation) — the goal is catching a search
    result's article/listicle/directory title that slipped past every
    earlier filter (e.g. stored_name="Best ERP Systems For Small Business",
    domain_name="Acme HR"), not flagging every minor "Acme HR" vs "Acme HR
    Tech" spelling difference as a divergence.
    """
    a, b = _normalize_company_name(stored_name), _normalize_company_name(domain_name)
    if not a or not b:
        return False
    return a not in b and b not in a


def verify_lead_identity(icp_id: int, limit: int = 500) -> dict:
    """Final QA gate (Task: Lead Identity Verification, item 5) — runs
    immediately before Agent 03 scoring so a bad company_name never reaches
    it (Agent 03's scoring pattern-matches keywords in the title, which is
    exactly how a listicle/article name that survived normalization could
    get scored HOT purely off matching words in its own junk title).

    Re-derives each lead's domain-based name (the same homepage-fetch this
    module's normalizer already prefers at generation time — see
    _apply_domain_identity) and corrects company_name to it whenever the two
    diverge significantly. This is a safety net, not the primary defense:
    most bad names should already be caught at generation time; this catches
    whatever slipped through (e.g. the homepage fetch failed transiently
    during generation but succeeds now, or a name was set before this
    verification step existed).
    """
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  Lead Identity Verification (QA gate) (ICP #{icp_id}, limit={limit})")
    print(bar)

    leads = supabase.get_leads_by_icp(icp_id, limit=limit)
    checked = 0
    corrected = 0
    for lead in leads:
        domain = lead.get("company_domain")
        stored_name = lead.get("company_name")
        if not domain or not stored_name:
            continue
        checked += 1
        domain_name = _domain_derived_name(domain)
        if not domain_name:
            continue  # homepage unreachable — nothing to compare against, leave as-is
        if _names_diverge(stored_name, domain_name):
            supabase.update_lead(lead["id"], company_name=domain_name)
            print(f"  [Identity QA] corrected '{stored_name}' → '{domain_name}' ({domain})")
            corrected += 1

    summary = {"icp_id": icp_id, "leads_checked": checked, "names_corrected": corrected}
    print(f"  ✓ Lead Identity Verification complete: {checked} checked · {corrected} corrected")
    return summary


# Sentinel stored in company_industry/company_size when the firmographic
# confidence check below can't support a value with real evidence. Chosen
# over leaving the field blank/null so the CRM shows an honest "we don't
# know" (ProspectLeadDetail.tsx's Field() renders any non-empty string
# plainly) rather than either a silently-missing field or a wrong-looking
# guess that's indistinguishable from a confirmed one.
_UNKNOWN_FIRMOGRAPHIC = "Unknown"


# Max candidates sent to the LLM in one firmographic-confidence call. Found
# live 2026-09-02 (ICP #57, Jobraux): a single unbatched call hit Groq's
# 8,000 TPM limit outright — "Requested 10250" — since each payload item
# carries a full meta_description (up to 500 chars) plus schema_org_text
# (up to 1500 chars), which adds up fast across a whole page's worth of
# candidates. Chunked into calls of this size so the feature stays reliable
# regardless of how many candidates a page produces, not just for small
# test cases.
_FIRMOGRAPHIC_BATCH_SIZE = 8


def _apply_firmographic_confidence(candidates: list[dict], icp_id: int) -> list[dict]:
    """Task #4 — Industry/company-size accuracy from verified homepage.

    Agent 02's first normalize pass (LEAD_NORMALIZATION_SYSTEM) derives
    company_industry/company_size from the search snippet alone, with no way
    to tell a confident read from a baseless guess off the company name or
    category — both come back looking identically plausible. This second
    pass fetches each domain's own meta description + schema.org markup
    (real first-party evidence, distinct from a third party's snippet) and
    asks the LLM to grade confidence per field against that evidence.
    "unknown" fields get overwritten to the literal _UNKNOWN_FIRMOGRAPHIC
    sentinel rather than left holding the original guess, so a value that
    can't be supported never reaches storage looking just as trustworthy as
    one that can.

    Batched in chunks of _FIRMOGRAPHIC_BATCH_SIZE (not one call per page,
    and not one call per candidate) — bounded LLM spend regardless of how
    many candidates a page produces, while staying under Groq's TPM ceiling
    regardless of how large that page's batch is. Candidates with no domain,
    or whose homepage yielded neither a meta description nor schema.org
    markup, are left untouched — there's no evidence for the LLM to judge
    either way, and they never take up a chunk slot.
    """
    payload_items: list[dict] = []
    indices: list[int] = []
    for i, c in enumerate(candidates):
        domain = c.get("company_domain")
        if not domain:
            continue
        signals = website.fetch_homepage_signals(domain)
        if not signals.get("meta_description") and not signals.get("schema_org_text"):
            continue
        payload_items.append({
            "company_name": c.get("company_name"),
            "guessed_industry": c.get("company_industry"),
            "guessed_company_size": c.get("company_size"),
            "meta_description": signals.get("meta_description"),
            "schema_org_text": signals.get("schema_org_text"),
        })
        indices.append(i)

    if not payload_items:
        return candidates

    for start in range(0, len(payload_items), _FIRMOGRAPHIC_BATCH_SIZE):
        chunk_items = payload_items[start:start + _FIRMOGRAPHIC_BATCH_SIZE]
        chunk_indices = indices[start:start + _FIRMOGRAPHIC_BATCH_SIZE]
        try:
            raw = llm.chat_json(
                FIRMOGRAPHIC_CONFIDENCE_SYSTEM,
                json.dumps({"companies": chunk_items}),
                agent="agent_02_leads_firmographics",
                icp_id=icp_id,
                phase="phase1",
            )
        except Exception as exc:
            print(f"  [Agent 02] firmographic confidence check failed for a batch: {exc}")
            continue  # this chunk's candidates keep their original guess; other chunks still run

        results = raw.get("results") or []
        for idx, result in zip(chunk_indices, results):
            c = candidates[idx]
            industry_confidence = str(result.get("industry_confidence") or "unknown").strip().lower()
            size_confidence = str(result.get("company_size_confidence") or "unknown").strip().lower()
            c["company_industry"] = (
                _UNKNOWN_FIRMOGRAPHIC if industry_confidence == "unknown"
                else (result.get("industry") or c.get("company_industry"))
            )
            c["company_size"] = (
                _UNKNOWN_FIRMOGRAPHIC if size_confidence == "unknown"
                else (result.get("company_size") or c.get("company_size"))
            )
            c["_industry_confidence"] = industry_confidence
            c["_company_size_confidence"] = size_confidence
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
            # regex-only fallback (see _tag_normalization_method), or its
            # source page looked like blog/comparison content, or its
            # geography was only confirmed via a homepage second-opinion
            # rather than the LLM's own snippet read — any of these means
            # this lead didn't reach the same evidence bar as an ordinary
            # LLM-normalized, snippet-confirmed candidate, so it's flagged
            # for human review or a future scoring penalty instead of being
            # trusted exactly like every other lead.
            "needs_review": (
                normalization_method == "regex_fallback"
                or bool(item.get("_content_page_suspect"))
                or item.get("_geography_confirmed_via") == "homepage_check"
            ),
            "geography_confirmed_via": item.get("_geography_confirmed_via"),
            "content_page_suspect": bool(item.get("_content_page_suspect")),
            # Task #4 — audit trail for why company_industry/company_size
            # hold "Unknown" (or a homepage-confirmed value) rather than the
            # original snippet-only guess. Missing on candidates whose domain
            # never resolved or whose homepage had no usable signal at all —
            # _apply_firmographic_confidence leaves those fields untouched.
            "industry_confidence": item.get("_industry_confidence"),
            "company_size_confidence": item.get("_company_size_confidence"),
        },
    )
