"""Agent 03 — Lead Enrichment.

For leads with a domain but no contact, finds a decision-maker via LinkedIn search,
generates email patterns, verifies with Disify, optionally falls back to Hunter.io.
"""
import json
import re

from gtm_backend.phase1.connectors import disify
from gtm_backend.phase1.connectors import hunter
from gtm_backend.phase1.connectors import gemini as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.connectors import website
from gtm_backend.phase1.core.config import get_settings
from gtm_backend.phase1.core.emails import generate_patterns
from gtm_backend.phase1.core.prompts import COMPANY_ENRICHMENT_SYSTEM, CONTACT_EXTRACTION_SYSTEM

# Company-level fields filled by website-scrape + Hunter metadata enrichment.
_COMPANY_FIELDS = (
    "company_city",
    "company_state",
    "company_country",
    "company_address",
    "company_phone",
    "company_industry",
    "company_size",
    "company_linkedin_url",
)

# The firmographic fields most often left blank — used to decide whether a lead
# still needs (re-)enrichment and to scope which gaps the LLM should target.
_LOCATION_SIZE_FIELDS = ("company_city", "company_state", "company_country", "company_size")

# Canonical employee-count bands (the only values we store for company_size).
_SIZE_BANDS = ("1-10", "11-50", "51-200", "201-500", "501-1000", "1000+")


def enrich_leads(icp_id: int | None = None, limit: int = 50) -> dict:
    """Find contacts + verified emails for leads missing them."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 03 — Lead Enrichment (ICP #{icp_id}, limit={limit})")
    print(bar)

    icp_filter = supabase.get_icp(icp_id) if icp_id else None
    role_keywords = (icp_filter or {}).get("buyer_titles") or ["CEO", "Founder", "Head"]
    leads = supabase.get_leads_for_enrichment(limit=limit, icp_id=icp_id)
    print(f"  → {len(leads)} leads to enrich · target titles: {role_keywords[:3]}")

    enriched = 0
    skipped = 0
    for lead in leads:
        success = _enrich_one(lead, role_keywords, icp_id=icp_id)
        if success:
            enriched += 1
        else:
            skipped += 1

    summary = {
        "icp_id": icp_id,
        "leads_examined": len(leads),
        "leads_enriched": enriched,
        "leads_skipped": skipped,
    }
    print(
        f"  ✓ Agent 03 complete: {len(leads)} examined · "
        f"{enriched} enriched · {skipped} skipped"
    )
    return summary


def _enrich_one(lead: dict, role_keywords: list[str], icp_id: int | None = None) -> bool:
    company_name = lead.get("company_name")
    domain = lead.get("company_domain")
    if not company_name or not domain:
        print(f"  [Agent 03] {company_name or '?':<28} → skipped (no domain)")
        return False

    updates: dict = {}

    # 1) Company-level details (location, phone, industry, size, LinkedIn).
    #    Only fields the lead is still missing get re-derived, so re-runs are
    #    idempotent and never clobber good data already stored.
    missing_company = [f for f in _COMPANY_FIELDS if not _clean_value(lead.get(f))]
    if missing_company:
        company = _enrich_company(company_name, domain, missing_company, icp_id=icp_id)
        # Belt-and-braces: never overwrite a field the lead already had.
        updates.update({k: v for k, v in company.items() if not _clean_value(lead.get(k))})

    # 2) Decision-maker contact + verified email. Skip if already on file so a
    #    backfill re-run (lead has email but no location/size) stays cheap.
    contact_found = bool(_clean_value(lead.get("contact_email")))
    email = lead.get("contact_email")
    verified = bool(lead.get("verified"))
    if not contact_found:
        contact = _find_contact(company_name, role_keywords, icp_id=icp_id)
        contact_found = bool(contact and contact.get("contact_name"))
        if contact_found:
            email, bounce_status, verified = _find_email(contact["contact_name"], domain)
            updates.update(
                contact_name=contact.get("contact_name"),
                contact_title=contact.get("contact_title"),
                contact_linkedin_url=contact.get("contact_linkedin_url"),
                contact_email=email,
                verified=verified,
                bounce_status=bounce_status,
            )

    if not updates:
        print(f"  [Agent 03] {company_name:<28} → skipped (no data found)")
        return False

    supabase.update_lead(lead["id"], **updates)

    n_company = sum(1 for k in updates if k in _COMPANY_FIELDS)
    contact_name = updates.get("contact_name") or _clean_value(lead.get("contact_name"))
    if contact_found and contact_name:
        mark = "✓" if verified else "~"
        print(
            f"  [Agent 03] {company_name:<28} {mark} {contact_name} "
            f"<{email or '—'}> · +{n_company} company fields"
        )
    else:
        print(f"  [Agent 03] {company_name:<28} ⊙ company details only (+{n_company} fields)")
    return True


def _enrich_company(
    company_name: str,
    domain: str,
    missing_fields: list[str],
    icp_id: int | None = None,
) -> dict:
    """Fill company-level fields from Hunter metadata + website + web search.

    Sources, in priority order: Hunter (structured) → scraped website → SerpAPI
    snippets (HQ location / employee count) → the LLM's own knowledge. The LLM
    decomposes a full address into city/state/country and maps any headcount to
    a canonical band; ``company_size`` is never left blank when an estimate is
    possible. Returns only fields that were actually found, so it never blanks
    out values another step already set.
    """
    meta = hunter.domain_metadata(domain)
    text = website.fetch_text(domain)

    # Targeted web search only for the gaps we still have, to keep search/token
    # spend down. Snippets give the LLM HQ-location and headcount evidence that
    # the homepage rarely states outright.
    needs_location = any(f in missing_fields for f in ("company_city", "company_state", "company_country"))
    needs_size = "company_size" in missing_fields
    location_snippets = _location_snippets(company_name) if needs_location else []
    size_snippets = _size_snippets(company_name) if needs_size else []

    payload = json.dumps({
        "company_name": company_name,
        "domain": domain,
        "hunter_metadata": meta,
        "website_text": text,
        "location_snippets": location_snippets,
        "size_snippets": size_snippets,
    })
    try:
        extracted = llm.chat_json(
            COMPANY_ENRICHMENT_SYSTEM,
            payload,
            agent="agent_03_enrichment",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 03] company enrichment failed for {company_name}: {exc}")
        extracted = {}

    # Hunter's company LinkedIn URL is authoritative when the LLM didn't find one.
    if meta.get("linkedin") and not extracted.get("company_linkedin_url"):
        extracted["company_linkedin_url"] = meta["linkedin"]

    # Normalize size to one of the canonical employee-count bands.
    if extracted.get("company_size"):
        extracted["company_size"] = _normalize_size_band(extracted["company_size"])

    cleaned: dict = {}
    for key in _COMPANY_FIELDS:
        value = _clean_value(extracted.get(key))
        if value:
            cleaned[key] = value
    return cleaned


def _location_snippets(company_name: str) -> list[dict]:
    try:
        results = serpapi.search_company_location(company_name)
    except Exception:
        return []
    return [
        {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
        for r in results[:5]
    ]


def _size_snippets(company_name: str) -> list[dict]:
    try:
        results = serpapi.search_company_size(company_name)
    except Exception:
        return []
    return [
        {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
        for r in results[:5]
    ]


def _normalize_size_band(value) -> str | None:
    """Map any headcount expression to a canonical employee band.

    Accepts already-canonical bands, free-text headcounts ("approx 120
    employees", "5,000 staff", "team of 8"), and explicit ranges ("50-200").
    Returns one of :data:`_SIZE_BANDS` or ``None`` when no number can be read.
    """
    if not value:
        return None
    text = str(value).strip().lower()
    if text in _SIZE_BANDS:
        return text

    # Pull all integers (commas/dots stripped) and use the largest, since
    # ranges like "51-200" and "approx 1,000-5,000" should map by upper bound.
    numbers = [int(n.replace(",", "").replace(".", "")) for n in re.findall(r"\d[\d.,]*", text)]
    if not numbers:
        return None
    count = max(numbers)
    if count <= 10:
        return "1-10"
    if count <= 50:
        return "11-50"
    if count <= 200:
        return "51-200"
    if count <= 500:
        return "201-500"
    if count <= 1000:
        return "501-1000"
    return "1000+"


# LLMs sometimes emit the *string* "null"/"n/a" instead of JSON null; treat those
# (and blanks) as missing so we never store the text "null" in a column.
_EMPTY_VALUES = {"", "null", "none", "n/a", "na", "unknown", "not stated", "not available", "-"}


def _clean_value(value):
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    return stripped if stripped.lower() not in _EMPTY_VALUES else None


def _find_contact(company_name: str, role_keywords: list[str], icp_id: int | None = None) -> dict | None:
    try:
        snippets = serpapi.search_linkedin(company_name, role_keywords)
    except Exception as exc:
        print(f"  [Agent 03] linkedin search failed for {company_name}: {exc}")
        return None
    if not snippets:
        return None
    payload = json.dumps({
        "company_name": company_name,
        "preferred_titles": role_keywords,
        "linkedin_snippets": [
            {"title": s.get("title"), "link": s.get("link"), "snippet": s.get("snippet")}
            for s in snippets[:8]
        ],
    })
    try:
        return llm.chat_json(
            CONTACT_EXTRACTION_SYSTEM,
            payload,
            agent="agent_03_enrichment",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Agent 03] LLM contact extraction failed: {exc}")
        return None


def _find_email(full_name: str, domain: str) -> tuple[str | None, str | None, bool]:
    """Try generated email patterns first; fall back to Hunter.io if available."""
    for candidate in generate_patterns(full_name, domain):
        result = disify.verify_email(candidate)
        if result.get("verified"):
            return candidate, result.get("bounce_status"), True

    settings = get_settings()
    if settings.hunter_api_key:
        hunter_results = hunter.find_emails(domain)
        for item in hunter_results:
            email = item.get("email")
            if not email:
                continue
            verdict = disify.verify_email(email)
            if verdict.get("verified"):
                return email, verdict.get("bounce_status"), True

    first_pattern = next(iter(generate_patterns(full_name, domain)), None)
    return first_pattern, "unknown", False
