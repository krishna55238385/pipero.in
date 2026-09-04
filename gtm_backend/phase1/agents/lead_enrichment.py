"""Lead Enrichment (support step — not one of the PDF's 52 numbered agents).

For leads with a domain but no contact, finds a decision-maker via LinkedIn search,
generates email patterns, verifies with Disify, optionally falls back to Hunter.io.

Renamed from agent_03_enrichment.py -> lead_enrichment.py: this step was
filed under "Agent 03" in the code, but the PDF architecture spec defines
Agent 03 as ICP Scoring, not Lead Enrichment. This enrichment step doesn't
correspond to any of the PDF's 52 numbered agents — it's real, necessary
pipeline infrastructure (finds/verifies contact emails between lead
generation and scoring), just not part of the formal spec, so it's been
dropped from the agent_NN_ numbering scheme entirely rather than given an
incorrect number. No functional change, filename only.
"""
import json
import re

from gtm_backend.phase1.agents.agent_02_leads import _country_mismatch, _expected_country_codes
from gtm_backend.phase1.connectors import disify
from gtm_backend.phase1.connectors import hunter
from gtm_backend.phase1.connectors import openai as llm
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
    print(f"  Lead Enrichment (support step) (ICP #{icp_id}, limit={limit})")
    print(bar)

    icp_filter = supabase.get_icp(icp_id) if icp_id else None
    role_keywords = (icp_filter or {}).get("buyer_titles") or ["CEO", "Founder", "Head"]
    # Same target-country resolution Agent 02 already enforced when this
    # lead was generated — reused here so enrichment's own location fill
    # can be checked against it instead of silently overwriting a value
    # Agent 02's geography check already vetted (see _enrich_one below).
    expected_countries = _expected_country_codes((icp_filter or {}).get("geography") or [])
    leads = supabase.get_leads_for_enrichment(limit=limit, icp_id=icp_id)
    print(f"  → {len(leads)} leads to enrich · target titles: {role_keywords[:3]}")

    enriched = 0
    skipped = 0
    for lead in leads:
        success = _enrich_one(lead, role_keywords, icp_id=icp_id, expected_countries=expected_countries)
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
        f"  ✓ Lead Enrichment complete: {len(leads)} examined · "
        f"{enriched} enriched · {skipped} skipped"
    )
    return summary


def _enrich_one(
    lead: dict, role_keywords: list[str], icp_id: int | None = None,
    expected_countries: set[str] | None = None,
) -> bool:
    company_name = lead.get("company_name")
    domain = lead.get("company_domain")
    if not company_name or not domain:
        print(f"  [Lead Enrichment] {company_name or '?':<28} → skipped (no domain)")
        return False

    updates: dict = {}

    # 1) Company-level details (location, phone, industry, size, LinkedIn).
    #    Only fields the lead is still missing get re-derived, so re-runs are
    #    idempotent and never clobber good data already stored.
    missing_company = [f for f in _COMPANY_FIELDS if not _clean_value(lead.get(f))]
    if missing_company:
        company = _enrich_company(company_name, domain, missing_company, icp_id=icp_id)
        # Belt-and-braces: never overwrite a field the lead already had.
        company_updates = {k: v for k, v in company.items() if not _clean_value(lead.get(k))}

        # Found live 2026-09-03 (ICP #62, Jobraux): this step's location
        # search is by company NAME, which can collide with an unrelated,
        # more prominent same-named company (a "Bloomberry" SaaS company's
        # domain got a Philippine casino operator's address written onto
        # it). Agent 02 already vetted this lead against the ICP's target
        # geography at generation time — if the freshly-found country now
        # contradicts that, don't silently overwrite it: drop the location
        # fields (the lead keeps its earlier value, blank or not) and flag
        # needs_review so a human resolves the conflict instead.
        #
        # This originally only covered city/state/country — confirmed live
        # 2026-09-05 that it wasn't enough: company_address came back from
        # the SAME contaminated snippet in the SAME LLM call (the literal
        # Solaire Resort/Parañaque City HQ address of the Philippine resorts
        # company sharing the "Bloomberry" name) and was written through
        # untouched, since only city/state/country were in the discard set.
        # An address is tied to a location the same way city/state/country
        # are, so it's discarded on the same signal.
        new_country = company_updates.get("company_country")
        if expected_countries and new_country and _country_mismatch(new_country, expected_countries):
            conflicting = {
                k: company_updates.pop(k) for k in (
                    "company_city", "company_state", "company_country", "company_address",
                )
                if k in company_updates
            }
            print(
                f"  [Lead Enrichment] {company_name:<28} ⚠ enrichment found "
                f"{conflicting.get('company_country')!r} which conflicts with this "
                f"ICP's target geography — discarding, flagging needs_review"
            )
            raw_data = dict(lead.get("raw_data") or {})
            raw_data["needs_review"] = True
            raw_data["geography_conflict_at_enrichment"] = conflicting
            updates["raw_data"] = raw_data

        updates.update(company_updates)

    # 2) Decision-maker contact + verified email. Skip if already on file so a
    #    backfill re-run (lead has email but no location/size) stays cheap.
    contact_found = bool(_clean_value(lead.get("contact_email")))
    email = lead.get("contact_email")
    verified = bool(lead.get("verified"))
    if not contact_found:
        contact = _find_contact(
            company_name, role_keywords, domain,
            company_context=lead.get("company_industry"), icp_id=icp_id,
        )
        contact_found = bool(contact and contact.get("contact_name"))
        if contact_found:
            email, bounce_status, verified = _find_email(contact["contact_name"], domain)
            tier = _email_verification_tier(verified, contact["contact_name"], domain)
            updates.update(
                contact_name=contact.get("contact_name"),
                contact_title=contact.get("contact_title"),
                contact_linkedin_url=contact.get("contact_linkedin_url"),
                contact_email=email,
                verified=verified,
                bounce_status=bounce_status,
                email_verification_tier=tier,
            )

    if not updates:
        print(f"  [Lead Enrichment] {company_name:<28} → skipped (no data found)")
        return False

    supabase.update_lead(lead["id"], **updates)

    n_company = sum(1 for k in updates if k in _COMPANY_FIELDS)
    contact_name = updates.get("contact_name") or _clean_value(lead.get("contact_name"))
    if contact_found and contact_name:
        mark = "✓" if verified else "~"
        print(
            f"  [Lead Enrichment] {company_name:<28} {mark} {contact_name} "
            f"<{email or '—'}> · +{n_company} company fields"
        )
    else:
        print(f"  [Lead Enrichment] {company_name:<28} ⊙ company details only (+{n_company} fields)")
    return True


def _name_on_team_page(full_name: str, domain: str) -> bool:
    """True when full_name is independently corroborated by the company's own
    team/about page — a real presence signal distinct from a disify domain
    check, which only confirms the MAILBOX'S DOMAIN accepts mail, never that
    this specific person actually works there.

    Deliberately a plain substring match (both first AND last name tokens
    must appear somewhere in the fetched page text) rather than an LLM call —
    Agent 07 already does the heavier LLM-based team-page reasoning for its
    own stakeholder-mapping purpose; this check only needs a cheap, bounded-
    cost yes/no signal for THIS contact specifically, not a full roster
    extraction. False on any fetch failure or a name too short to check
    meaningfully (avoids a single-token name matching common page filler).
    """
    parts = [p for p in re.split(r"\s+", full_name.strip()) if len(p) > 1]
    if len(parts) < 2:
        return False
    try:
        pages = website.fetch_team_pages(domain)
    except Exception:
        return False
    if not pages:
        return False
    combined = " ".join(p.get("text", "") for p in pages).lower()
    return all(part.lower() in combined for part in parts)


def _email_verification_tier(verified: bool, full_name: str, domain: str) -> str | None:
    """Task #5 — the honest confidence tier behind the CRM's "Verified" badge.

    "domain_verified": the email passed disify's MX/domain-record check
    (verified=True) but nothing confirms this specific person still works
    there. "person_confirmed": the same check passed AND the contact's name
    was independently found on the company's own team/about page — a real,
    if imperfect, presence signal. None when the email isn't verified at all
    (unchanged meaning — no badge shown either way).
    """
    if not verified:
        return None
    if _name_on_team_page(full_name, domain):
        return "person_confirmed"
    return "domain_verified"


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
    location_snippets = _location_snippets(company_name, domain) if needs_location else []
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
            agent="lead_enrichment",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Lead Enrichment] company enrichment failed for {company_name}: {exc}")
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


def _location_snippets(company_name: str, domain: str | None = None) -> list[dict]:
    try:
        results = serpapi.search_company_location(company_name, domain=domain)
    except Exception:
        return []
    return [
        {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
        for r in results[:3]
    ]


def _size_snippets(company_name: str) -> list[dict]:
    try:
        results = serpapi.search_company_size(company_name)
    except Exception:
        return []
    return [
        {"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")}
        for r in results[:3]
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


# Deterministic pre-filter for _find_contact (see its docstring/comment for
# the incident this fixes): extracts an explicitly-stated "at <Company>"
# affiliation from a LinkedIn search snippet and checks whether it shares
# any token with the company actually being searched for.
_AFFILIATION_RE = re.compile(r"\bat\s+([A-Za-z0-9&.,'\-‑ ]{2,60})", re.I)
_NAME_TOKEN_RE = re.compile(r"[a-z0-9]+")
_NAME_STOPWORDS = {"inc", "llc", "ltd", "corp", "corporation", "co", "company", "the", "group"}


def _name_tokens(text: str) -> set[str]:
    return {t for t in _NAME_TOKEN_RE.findall(text.lower()) if t not in _NAME_STOPWORDS and len(t) > 1}


def _affiliation_mismatch(text: str, company_name: str) -> bool:
    """True when a search snippet explicitly states an affiliation with a
    company that shares none of the target company's name tokens. A snippet
    with no explicit "at <Company>" language is left alone — inconclusive,
    not a mismatch — since most real matches never phrase it that plainly.
    """
    match = _AFFILIATION_RE.search(text or "")
    if not match:
        return False
    mentioned = _name_tokens(match.group(1))
    target = _name_tokens(company_name)
    if not mentioned or not target:
        return False
    return not (mentioned & target)


def _hunter_contact(domain: str, role_keywords: list[str]) -> dict | None:
    """Reuse Hunter's already-cached domain-search results (free — same lookup
    ``_enrich_company`` already made for this domain) to see if a real,
    named contact is already known before paying for a SerpAPI LinkedIn
    search + LLM extraction call.
    """
    entries = hunter.find_emails(domain)
    named = [e for e in entries if e.get("first_name") and e.get("last_name")]
    if not named:
        return None

    def _score(entry: dict) -> tuple[bool, int]:
        position = (entry.get("position") or "").lower()
        title_match = any(kw.lower() in position for kw in role_keywords)
        return (title_match, entry.get("confidence") or 0)

    best = max(named, key=_score)
    return {
        "contact_name": f"{best['first_name']} {best['last_name']}".strip(),
        "contact_title": best.get("position") or None,
        "contact_linkedin_url": None,
    }


def _find_contact(
    company_name: str, role_keywords: list[str], domain: str,
    company_context: str | None = None, icp_id: int | None = None,
) -> dict | None:
    hunter_contact = _hunter_contact(domain, role_keywords)
    if hunter_contact:
        return hunter_contact

    try:
        snippets = serpapi.search_linkedin(company_name, role_keywords, domain=domain)
    except Exception as exc:
        print(f"  [Lead Enrichment] linkedin search failed for {company_name}: {exc}")
        return None
    if not snippets:
        return None

    # Fast, free, deterministic pre-filter before ever spending an LLM call:
    # drop any snippet that explicitly states the person's affiliation is
    # with a DIFFERENT company than the one being searched for (e.g. "Manager
    # at Mitek Systems" when searching for "Bloomberry"). Found live
    # 2026-09-05, ICP #62: this exact pattern let real people at unrelated
    # companies (Donorbox, Formulytic) become this lead's stakeholders — the
    # same class of bug affects the primary-contact search here. A snippet
    # with NO explicit affiliation stated is left alone (inconclusive, not
    # rejected) — this only catches the loud, unambiguous mismatches; the
    # LLM's own entity check below (see CONTACT_EXTRACTION_SYSTEM) is what
    # catches the harder case where the snippet genuinely does say the
    # search company's name, just referring to a different real company by
    # that same name.
    snippets = [
        s for s in snippets
        if not _affiliation_mismatch(f"{s.get('title') or ''} {s.get('snippet') or ''}", company_name)
    ]
    if not snippets:
        return None

    payload = json.dumps({
        "company_name": company_name,
        "domain": domain,
        "company_context": company_context,
        "preferred_titles": role_keywords,
        "linkedin_snippets": [
            {"title": s.get("title"), "link": s.get("link"), "snippet": s.get("snippet")}
            for s in snippets[:5]
        ],
    })
    try:
        result = llm.chat_json(
            CONTACT_EXTRACTION_SYSTEM,
            payload,
            agent="lead_enrichment",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  [Lead Enrichment] LLM contact extraction failed: {exc}")
        return None

    # Identity verification gate: only trust a contact when the LLM
    # explicitly marked the name+company match as "high" confidence.
    #
    # UPDATED 2026-09-05 (was: keep contact_name/contact_title, blank only
    # contact_linkedin_url on non-"high"). That older behavior was found live
    # to let a real person at a completely different, unrelated company
    # (ICP #62's "Bloomberry" -> a different company's founder, real name and
    # title, wrong employer) become this lead's primary contact whenever the
    # LLM's confidence happened to land on "high" for the wrong reason (the
    # snippet genuinely said the search company's bare name — just referring
    # to a different real company by that name). Once confidence is anything
    # other than "high", there's no reliable signal left to salvage even the
    # name from — the whole contact is dropped rather than attached with an
    # unconfirmed employer.
    if str(result.get("match_confidence") or "").strip().lower() != "high":
        return None
    return result


def _find_email(full_name: str, domain: str) -> tuple[str | None, str | None, bool]:
    """Try generated email patterns first; fall back to Hunter.io if available."""
    for candidate in generate_patterns(full_name, domain):
        result = disify.verify_email(candidate)
        if result.get("verified"):
            return candidate, result.get("bounce_status"), True

    settings = get_settings()
    if settings.hunter_api_key:
        hunter_results = hunter.find_emails(domain)
        # Cap to the top 3 by confidence instead of trying every result Hunter
        # returns (up to 10) — each candidate costs a Disify verification call.
        hunter_results = sorted(
            hunter_results, key=lambda e: e.get("confidence") or 0, reverse=True
        )[:3]
        for item in hunter_results:
            email = item.get("email")
            if not email:
                continue
            verdict = disify.verify_email(email)
            if verdict.get("verified"):
                return email, verdict.get("bounce_status"), True

    first_pattern = next(iter(generate_patterns(full_name, domain)), None)
    return first_pattern, "unknown", False
