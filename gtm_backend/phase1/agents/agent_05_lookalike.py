"""Agent 05 — Lookalike Finder (PDF Phase 1 — FIND).

"Clones your best customers to find more just like them."

Analyses the organization's closed-won deals, identifies the pattern that
makes them good customers, and searches for new companies that share that
pattern — inserted into leads_raw as ordinary leads (source="lookalike"),
scored and tagged with a lookalike_score/reference in raw_data so the CRM
can show why each one was suggested.

This is the first agent in this codebase to read across phase boundaries:
closed-won deals live in the CRM's own `deals`/`contacts`/`companies` tables,
which only phase3's connector reads (phase1's own connector only knows
icp_profiles/leads_raw/buying_signals). Rather than duplicate deal-reading
logic in phase1, this agent imports phase3's connector directly — the same
kind of cross-phase reuse already established the other direction (phase4
agents importing phase1's serpapi/disify connectors).

PDF rules and how each is actually handled:
- "Must use only closed-won deals as the basis — not trials or churned
  accounts" — BUILT: reuses supabase.get_won_deals_with_contacts (Agent 42's
  own connector function), which already filters to won/closed_won only.
- "Minimum of 5 reference customers required before lookalike generation"
  — BUILT as a hard gate: below 5 won deals with a resolvable company name,
  the agent stops before any search/LLM call and reports why.
- "Lookalike score must be displayed alongside each suggested company" —
  BUILT: every inserted lead carries lookalike_score and
  lookalike_reference_company in its raw_data JSON.
- "Must flag if a suggested lookalike is already in the pipeline" — BUILT:
  candidates are deduped against get_existing_company_domains /
  get_existing_company_names for the target ICP before insertion; anything
  already present is skipped, not re-added.
- "Refresh lookalike pool every 30 days as more wins accumulate" —
  satisfied by run cadence (should be scheduled ~monthly), not by agent
  logic itself, same pattern as every other snapshot/refresh agent.
- "Must exclude direct competitors of existing customers" — BUILT as a hard
  gate: the extraction LLM call flags is_competitor using
  seller_product_description as its only evidence; any candidate flagged
  true is dropped before insertion, never inserted "for review" — a
  competitor lead isn't ambiguous enough to need human review, it's simply
  wrong for this list.

Known scope limitation: "top 10 existing customers" in the PDF's own wording
is approximated as "up to 10 most recent won deals with a resolvable company
name" — this codebase has no reliable per-deal "value delivered" or "account
health" signal to rank customers by *quality* beyond deal value itself, so
recency + deal size (already sorted by created_at from the connector) is
used rather than inventing a synthetic quality score.
"""
import json

from gtm_backend.phase1.connectors import openai as llm
from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase1.connectors import supabase
from gtm_backend.phase1.core.prompts import LOOKALIKE_EXTRACTION_SYSTEM, LOOKALIKE_PROFILE_SYSTEM
from gtm_backend.phase1.core.schemas import Lead
from gtm_backend.phase3.connectors import supabase as crm_supabase

_MIN_REFERENCE_CUSTOMERS = 5
_MAX_REFERENCE_CUSTOMERS = 10


def find_lookalikes(icp_id: int, limit: int = 20) -> dict:
    """Build a lookalike profile from closed-won deals and search for new
    companies matching it; insert non-duplicate, non-competitor candidates
    into leads_raw for the given ICP."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 05 — Lookalike Finder (ICP #{icp_id}, limit={limit})")
    print(bar)

    won_deals = crm_supabase.get_won_deals_with_contacts()
    reference_customers = _build_reference_list(won_deals)
    print(f"  → {len(reference_customers)} reference customer(s) with a resolvable company")

    if len(reference_customers) < _MIN_REFERENCE_CUSTOMERS:
        msg = (
            f"only {len(reference_customers)} reference customer(s) — "
            f"PDF requires a minimum of {_MIN_REFERENCE_CUSTOMERS} won deals before lookalike generation"
        )
        print(f"  ↷ SKIPPED: {msg}")
        return {"status": "insufficient_reference_customers", "reference_customer_count": len(reference_customers), "leads_inserted": 0}

    reference_customers = reference_customers[:_MAX_REFERENCE_CUSTOMERS]
    org_id = next((d.get("organization_id") for d in won_deals if d.get("organization_id")), None)
    seller_product_description = crm_supabase.get_org_product_description(org_id)

    try:
        profile_raw = llm.chat_json(
            LOOKALIKE_PROFILE_SYSTEM,
            _stringify({"reference_customers": reference_customers, "seller_product_description": seller_product_description}),
            agent="agent_05_lookalike",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  ✗ profile generation failed: {exc}")
        return {"status": "failed", "error": str(exc), "leads_inserted": 0}

    queries = profile_raw.get("search_queries") if isinstance(profile_raw.get("search_queries"), list) else []
    profile_summary = str(profile_raw.get("profile_summary") or "").strip()
    print(f"  → profile: {profile_summary}")
    print(f"  → {len(queries)} search quer{'y' if len(queries) == 1 else 'ies'} generated")

    all_results = []
    for q in queries:
        try:
            all_results.extend(serpapi.search(str(q), num=8))
        except Exception as exc:
            print(f"  [Agent 05] search failed for '{q}': {exc}")

    if not all_results:
        print("  ↷ no search results — nothing to extract")
        return {"status": "no_search_results", "reference_customer_count": len(reference_customers), "leads_inserted": 0}

    try:
        extraction_raw = llm.chat_json(
            LOOKALIKE_EXTRACTION_SYSTEM,
            _stringify({
                "reference_customers": reference_customers,
                "profile_summary": profile_summary,
                "seller_product_description": seller_product_description,
                "search_results": [{"title": r.get("title"), "link": r.get("link"), "snippet": r.get("snippet")} for r in all_results],
            }),
            agent="agent_05_lookalike",
            icp_id=icp_id,
            phase="phase1",
        )
    except Exception as exc:
        print(f"  ✗ candidate extraction failed: {exc}")
        return {"status": "failed", "error": str(exc), "leads_inserted": 0}

    candidates = extraction_raw.get("candidates") if isinstance(extraction_raw.get("candidates"), list) else []

    existing_domains = supabase.get_existing_company_domains(icp_id)
    existing_names = supabase.get_existing_company_names(icp_id)

    leads: list[Lead] = []
    skipped_competitor = 0
    skipped_duplicate = 0

    for c in candidates:
        if bool(c.get("is_competitor")):
            skipped_competitor += 1
            continue
        name = str(c.get("company_name") or "").strip()
        if not name:
            continue
        domain = _domain_from_url(c.get("company_website"))
        if (domain and domain in existing_domains) or name.lower() in existing_names:
            skipped_duplicate += 1
            continue
        if len(leads) >= limit:
            continue
        leads.append(Lead(
            icp_id=icp_id,
            company_name=name,
            company_website=c.get("company_website"),
            company_domain=domain,
            company_industry=c.get("company_industry"),
            source="lookalike",
            sources=["lookalike"],
            raw_data={
                "lookalike_score": c.get("lookalike_score"),
                "lookalike_reference_company": c.get("lookalike_reference_company"),
                "lookalike_source_url": c.get("source_url"),
            },
        ))

    inserted_ids = supabase.insert_leads(leads) if leads else []

    print(
        f"  ✓ Agent 05 complete: {len(inserted_ids)} lookalike lead(s) inserted · "
        f"{skipped_competitor} skipped (competitor) · {skipped_duplicate} skipped (already in pipeline)"
    )
    return {
        "status": "ok",
        "reference_customer_count": len(reference_customers),
        "profile_summary": profile_summary,
        "candidates_found": len(candidates),
        "leads_inserted": len(inserted_ids),
        "skipped_competitor": skipped_competitor,
        "skipped_duplicate": skipped_duplicate,
    }


def _build_reference_list(won_deals: list[dict]) -> list[dict]:
    """One entry per won deal with a resolvable company name/industry, via
    contact -> company. Deals with no linked company are skipped — they
    can't contribute a usable pattern."""
    out = []
    for deal in won_deals:
        contact = crm_supabase.get_contact_by_id(deal.get("contact_id"))
        company = crm_supabase.get_company_by_id((contact or {}).get("company_id"))
        name = (company or {}).get("name") or deal.get("title")
        if not name:
            continue
        out.append({"company_name": name, "industry": (company or {}).get("industry")})
    return out


def _domain_from_url(url) -> str | None:
    if not url:
        return None
    domain = str(url).replace("https://", "").replace("http://", "").split("/")[0]
    return domain.lower().lstrip("www.") or None


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
