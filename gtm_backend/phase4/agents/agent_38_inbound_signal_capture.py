"""Agent 38 — Inbound Signal Capture (PDF Phase 6 — MANAGE & REPORT).

"Detects when a company visits the website, engages with content, or
interacts with the brand without making direct contact — and surfaces them
as warm leads for immediate follow-up."

Honest scope, built on real existing infrastructure rather than invented:
the CRM (magnivo.ai) already has a GA4 integration (`website_visitor_signals`
table, populated by a `/ga4/sync` job) that tracks company-level site visits
— sessions, engaged sessions, page views, top pages, a computed visitor
score, and a low/medium/high signal_strength. This agent's real job is to
apply the PDF's business rules on top of data that already exists, not to
build web tracking from scratch.

PDF rules and how each is actually handled:
- "Must not contact someone based solely on a single page view — require
  2+ signals" — BUILT: only companies with sessions >= 2 are surfaced.
- "Companies visiting pricing or case-study pages must be flagged as high
  intent" — BUILT: top_pages is checked for pricing/case-study keywords
  (substring match, no LLM needed for this).
- "Must link inbound signal to any existing lead record if the company is
  already in the pipeline" — BUILT: checked by company_domain against
  leads_raw before ever creating a new row.
- "Inbound leads must be tagged separately from outbound leads for
  attribution" — BUILT: new leads_raw rows get lead_channel='inbound_signal'
  (see phase1/data/schema.sql comment — reusing the existing `source` column
  would have collided with its real meaning, so a new column was added).
- "Must respect privacy laws — only use aggregated company-level data, not
  individual tracking" — satisfied by the DATA SOURCE itself: GA4 client-ID-
  level data was never brought into website_visitor_signals in the first
  place, only company-level rollups. Nothing for this agent to additionally
  enforce.
- "Inbound signals must be correlated with the ICP before being added as
  leads" — PARTIALLY built, documented honestly: website_visitor_signals has
  no industry/firmographic data on the visiting company (GA4 doesn't know a
  visitor's industry), so a real ICP-fit check would need a fresh
  enrichment/research call per company — expensive, and exactly the kind of
  LLM-heavy step this session is avoiding today given the Groq quota
  exhaustion. v1's correlation is a cheaper, honest substitute: skip
  companies already scored 'cold'/'disqualified' elsewhere in leads_raw (a
  clear ICP-fit signal already on file), but a genuinely new company gets
  surfaced as a candidate for a human to review, not auto-assumed to fit.
- "Signal must be acted upon within 24 hours" — this agent doesn't send
  anything itself (draft-only pattern, same as every messaging agent this
  session); the 24h clock is a scheduling concern (run this agent
  frequently) paired with the existing draft-review queue, not logic this
  agent enforces on its own.
"""
from gtm_backend.phase3.connectors import supabase

_MIN_SESSIONS = 2
_HIGH_INTENT_KEYWORDS = ("pricing", "price", "plans", "case-study", "case_study", "customer-story", "customers")
_DISQUALIFYING_TIERS = {"cold", "disqualified"}


def run_inbound_signal_capture(limit: int | None = None) -> dict:
    """Read website_visitor_signals, apply PDF's qualification rules, and
    link/create leads for genuine multi-session company visits."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 38 — Inbound Signal Capture (limit={limit or 'all'})")
    print(bar)

    signals = supabase.get_website_visitor_signals(limit=limit)
    print(f"  → {len(signals)} visitor signal(s) examined")

    promoted = 0
    linked_existing = 0
    held_single_session = 0
    held_known_cold = 0

    for signal in signals:
        result = _process_signal(signal)
        status = result["status"]
        if status == "created_new_lead":
            promoted += 1
        elif status == "linked_existing":
            linked_existing += 1
        elif status == "held_single_session":
            held_single_session += 1
        elif status == "held_known_cold":
            held_known_cold += 1

    print(
        f"  ✓ Agent 38 complete: {promoted} new inbound lead(s) created · "
        f"{linked_existing} linked to existing leads · "
        f"{held_single_session} held (single session) · {held_known_cold} held (known cold/disqualified)"
    )
    return {
        "signals_examined": len(signals),
        "new_leads_created": promoted,
        "linked_to_existing": linked_existing,
        "held_single_session": held_single_session,
        "held_known_cold": held_known_cold,
    }


def _process_signal(signal: dict) -> dict:
    domain = (signal.get("domain") or signal.get("company_domain") or "").strip().lower()
    company_name = signal.get("company") or signal.get("company_name") or domain or "?"
    sessions = int(signal.get("sessions") or 0)
    page_views = int(signal.get("pageViews") or signal.get("page_views") or 0)
    strength = signal.get("strength") or signal.get("signal_strength") or "low"
    top_pages = signal.get("topPages") or signal.get("top_pages") or []
    high_intent = _has_high_intent_page(top_pages)

    if sessions < _MIN_SESSIONS:
        supabase.upsert_inbound_signal_capture(
            company_name=company_name,
            company_domain=domain,
            signal_strength=strength,
            sessions=sessions,
            page_views=page_views,
            high_intent_pages_hit=high_intent,
            status="held",
            held_reason=f"only {sessions} session(s) — PDF rule requires 2+",
        )
        print(f"  [Agent 38] {company_name:<28} → held (only {sessions} session)")
        return {"status": "held_single_session"}

    existing_lead = supabase.get_lead_by_company_domain(domain) if domain else None
    if existing_lead is not None:
        tier = (existing_lead.get("score_tier") or "").lower()
        if tier in _DISQUALIFYING_TIERS:
            supabase.upsert_inbound_signal_capture(
                company_name=company_name,
                company_domain=domain,
                signal_strength=strength,
                sessions=sessions,
                page_views=page_views,
                high_intent_pages_hit=high_intent,
                status="held",
                held_reason=f"existing lead already scored {tier} — likely poor ICP fit",
            )
            print(f"  [Agent 38] {company_name:<28} → held (already scored {tier})")
            return {"status": "held_known_cold"}

        supabase.upsert_inbound_signal_capture(
            company_name=company_name,
            company_domain=domain,
            signal_strength=strength,
            sessions=sessions,
            page_views=page_views,
            high_intent_pages_hit=high_intent,
            status="promoted",
            promoted_lead_id=existing_lead.get("id"),
        )
        print(f"  [Agent 38] {company_name:<28} → linked to existing lead {existing_lead.get('id')} (high_intent={high_intent})")
        return {"status": "linked_existing", "lead_id": existing_lead.get("id")}

    new_lead = supabase.create_inbound_lead(
        company_name=company_name,
        company_domain=domain or None,
        lead_channel="inbound_signal",
    )
    new_lead_id = new_lead.get("id") if new_lead else None
    supabase.upsert_inbound_signal_capture(
        company_name=company_name,
        company_domain=domain,
        signal_strength=strength,
        sessions=sessions,
        page_views=page_views,
        high_intent_pages_hit=high_intent,
        status="promoted",
        promoted_lead_id=new_lead_id,
    )
    print(f"  [Agent 38] {company_name:<28} → created new inbound lead {new_lead_id} (high_intent={high_intent})")
    return {"status": "created_new_lead", "lead_id": new_lead_id}


def _has_high_intent_page(top_pages) -> bool:
    if not top_pages:
        return False
    text = " ".join(str(p) for p in top_pages).lower()
    return any(keyword in text for keyword in _HIGH_INTENT_KEYWORDS)
