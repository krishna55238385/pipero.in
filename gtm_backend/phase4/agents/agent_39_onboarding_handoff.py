"""Agent 39 — Onboarding Handoff (PDF Phase 7 — RETAIN & GROW).

"At the moment a deal closes, immediately briefs the delivery or customer
success team with complete context — what was promised, what the client
expects, their key stakeholders, and agreed success criteria."

Runs on CRM `deals` rows with status won/closed_won that don't yet have an
onboarding_handoffs row. Synthesizes a handoff brief grounded in the deal's
own notes (Agent 24's qualification reasoning + the prospect's own quoted
words), the sent proposal (Agent 25), and the executive brief (Agent 27,
when one exists) — the same "only ever cite real evidence" pattern as every
other drafting agent this session.

Honest scope, not the PDF's full spec:
- "Handoff brief delivered within 2 hours of close" — this agent CREATES the
  brief the moment it runs against a newly-won deal; actually hitting a
  2-hour SLA is a scheduling-frequency decision (run this agent often — e.g.
  every 30 minutes via the `schedule` tooling), not logic this agent
  enforces itself. No code path here can guarantee real-world timing.
- "Sales team available for a 30-minute handoff call within 48 hours" — a
  human calendar coordination step, not something an agent can do. Out of
  scope entirely, same as Meeting Booking (Agent 22, not yet built).
- "Delivery team must confirm receipt and readiness before onboarding
  begins" / "handoff quality must be tracked, delivery team rates every
  handoff" — the `status` and `quality_rating` columns on
  onboarding_handoffs exist to support this from a future CRM UI, but this
  agent never sets them past 'draft'/'held' itself. A human confirming
  receipt and rating a handoff is exactly the kind of judgment call this
  session has consistently left to a person, not automated.

Conservative-by-design, matching every other agent this session:
- If there's genuinely nothing to build a brief from (no notes, no proposal,
  no brief), held=True and no handoff_brief — never invented filler.
- success_criteria and communication_preference are only ever stated when
  actually evidenced; otherwise the brief says so explicitly rather than
  guessing, per ONBOARDING_HANDOFF_SYSTEM's own rules.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import ONBOARDING_HANDOFF_SYSTEM

_CLOSED_WON = {"won", "closed_won"}


def generate_pending_handoffs(limit: int | None = None) -> dict:
    """Draft a handoff brief for every won deal that doesn't have one yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 39 — Onboarding Handoff (limit={limit or 'all'})")
    print(bar)

    all_deals = supabase.get_all_deals()
    won_deals = [d for d in all_deals if (d.get("status") or "").lower() in _CLOSED_WON]
    if limit is not None:
        won_deals = won_deals[:limit]
    print(f"  → {len(won_deals)} won deal(s) examined")

    drafted = 0
    held = 0
    already_exists = 0
    failed = 0
    for deal in won_deals:
        result = generate_handoff(deal)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "held":
            held += 1
        elif status == "already_exists":
            already_exists += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 39 complete: {drafted} drafted · {held} held (insufficient evidence) · "
        f"{already_exists} already had a handoff · {failed} failed"
    )
    return {
        "won_deals_examined": len(won_deals),
        "drafted": drafted,
        "held": held,
        "already_exists": already_exists,
        "failed": failed,
    }


def generate_handoff(deal: dict) -> dict:
    """Draft (or hold) one handoff brief for one won deal. Idempotent — a
    deal that already has an onboarding_handoffs row is skipped."""
    deal_id = deal.get("id")
    company = deal.get("title") or "this client"
    notes = deal.get("notes") or ""

    existing = supabase.get_handoff_for_deal(deal_id)
    if existing is not None:
        return {"status": "already_exists", "deal_id": deal_id}

    proposal = supabase.get_proposal_for_deal(deal_id)
    brief = supabase.get_brief_for_deal(deal_id)
    crm_lead = supabase.get_crm_lead_by_id(deal.get("lead_id"))

    if not notes and not proposal and not brief:
        supabase.create_onboarding_handoff(
            deal_id=deal_id,
            crm_lead_id=deal.get("lead_id"),
            company_name=company,
            status="held",
            held_reason="no deal notes, proposal, or executive brief to build a handoff from",
        )
        print(f"  [Agent 39] deal {deal_id} ({company}) → held: no evidence to draft from")
        return {"status": "held", "deal_id": deal_id, "reason": "no evidence"}

    payload = {
        "deal_notes": notes,
        "proposal_text": (proposal or {}).get("proposal_text"),
        "executive_brief_text": (brief or {}).get("brief_text"),
        "business_outcome_summary": (brief or {}).get("business_outcome_summary"),
        "crm_lead_context": crm_lead or {},
    }

    try:
        raw = llm.chat_json(
            ONBOARDING_HANDOFF_SYSTEM,
            _stringify(payload),
            agent="agent_39_onboarding_handoff",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 39] deal {deal_id} ({company}) → generation failed: {exc}")
        return {"status": "failed", "deal_id": deal_id, "error": str(exc)}

    handoff_brief = str(raw.get("handoff_brief") or "").strip()
    if not handoff_brief:
        supabase.create_onboarding_handoff(
            deal_id=deal_id,
            crm_lead_id=deal.get("lead_id"),
            company_name=company,
            status="held",
            held_reason="LLM returned no usable brief text",
        )
        print(f"  [Agent 39] deal {deal_id} ({company}) → held: empty brief returned")
        return {"status": "held", "deal_id": deal_id, "reason": "empty brief"}

    stakeholders = raw.get("key_stakeholders")
    if not isinstance(stakeholders, list):
        stakeholders = []
    comm_pref = raw.get("communication_preference")
    if not isinstance(comm_pref, str) or not comm_pref.strip():
        comm_pref = None

    handoff = supabase.create_onboarding_handoff(
        deal_id=deal_id,
        crm_lead_id=deal.get("lead_id"),
        company_name=company,
        handoff_brief=handoff_brief,
        what_was_promised=str(raw.get("what_was_promised") or "").strip() or None,
        success_criteria=str(raw.get("success_criteria") or "").strip() or None,
        key_stakeholders=stakeholders,
        primary_contact_name=(crm_lead or {}).get("name") or (crm_lead or {}).get("full_name"),
        primary_contact_email=(crm_lead or {}).get("email"),
        communication_preference=comm_pref,
        status="draft",
    )
    handoff_id = handoff.get("id") if handoff else None
    print(f"  [Agent 39] deal {deal_id} ({company}) → drafted (handoff {handoff_id}), awaiting delivery-team confirmation")
    return {"status": "drafted", "deal_id": deal_id, "handoff_id": handoff_id}


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
