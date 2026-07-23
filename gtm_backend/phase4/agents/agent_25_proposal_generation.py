"""Agent 25 — Proposal Generation (PDF Phase 5 — CONVERT).

"Creates a customised, compelling proposal for every qualified deal."

Runs on CRM `deals` rows Agent 24 marked status='qualified' that don't yet
have a `deal_proposals` row. Drafts a short, personalised proposal grounded
in the deal's own notes (Agent 24's BANT reasoning, which already cites the
prospect's actual stated evidence) and its estimated value, leading with
outcomes rather than product features, per the PDF's business rules.

PDF rule "unqualified deals must never receive a proposal" is enforced simply
by only ever reading from get_qualified_deals() (status='qualified').

PDF rule "must be reviewed by a human before sending for deals above a
defined value threshold" — since there's no reliable value threshold defined
yet and no automated send path exists for proposals at all, the safe default
(same as Agent 17) is: every proposal is drafted only, status='draft', and
a human in the CRM must move it to 'approved'/'sent' themselves. No
send_approved_proposal function exists yet because there's no send channel
wired for proposals — that's a future agent's job, not this one's.

Conservative-by-design, matching every other agent this session:
- If the LLM can't find a real, specific stated pain point to reference, it
  returns held=True with no proposal_text — this agent still records a
  deal_proposals row (status='held') so it isn't silently re-attempted every
  run burning quota, but the "proposal" is empty/not sendable.
- Never invents a dollar figure, a case study, or a specific expiry date —
  see phase4/core/prompts.py PROPOSAL_GENERATION_SYSTEM for the exact rules
  enforced in the prompt itself.
"""
import json
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import PROPOSAL_GENERATION_SYSTEM

_EXPIRY_DAYS = 14


def generate_pending_proposals(limit: int | None = None) -> dict:
    """Draft a proposal for every qualified deal that doesn't have one yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 25 — Proposal Generation (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_qualified_deals(limit=limit)
    print(f"  → {len(deals)} qualified deal(s) examined")

    drafted = 0
    held = 0
    already_exists = 0
    failed = 0
    for deal in deals:
        result = generate_proposal(deal)
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
        f"  ✓ Agent 25 complete: {drafted} drafted · {held} held (no clear pain point) · "
        f"{already_exists} already had a proposal · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "drafted": drafted,
        "held": held,
        "already_exists": already_exists,
        "failed": failed,
    }


def generate_proposal(deal: dict) -> dict:
    """Draft (or hold) one proposal for one qualified deal. Idempotent — a
    deal that already has a deal_proposals row is skipped, not re-drafted."""
    deal_id = deal.get("id")
    company = deal.get("title") or "this prospect"
    notes = deal.get("notes") or ""
    value = deal.get("value")

    existing = supabase.get_proposal_for_deal(deal_id)
    if existing is not None:
        return {"status": "already_exists", "deal_id": deal_id}

    payload = {"deal_notes": notes, "estimated_deal_value": value}

    try:
        raw = llm.chat_json(
            PROPOSAL_GENERATION_SYSTEM,
            _stringify(payload),
            agent="agent_25_proposal_generation",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 25] deal {deal_id} ({company}) → generation failed: {exc}")
        return {"status": "failed", "deal_id": deal_id, "error": str(exc)}

    held_flag = bool(raw.get("held"))
    proposal_text = str(raw.get("proposal_text") or "").strip()
    pain_points = raw.get("pain_points_referenced")
    if not isinstance(pain_points, list):
        pain_points = []

    if held_flag or not proposal_text:
        reason = str(raw.get("held_reason") or "no specific stated pain point found").strip()
        supabase.create_deal_proposal(
            deal_id=deal_id,
            crm_lead_id=deal.get("lead_id"),
            company_name=company,
            proposal_text="",
            pain_points_referenced=[],
            status="held",
            expires_at=None,
        )
        print(f"  [Agent 25] deal {deal_id} ({company}) → held: {reason}")
        return {"status": "held", "deal_id": deal_id, "reason": reason}

    expires_at = (datetime.now(timezone.utc) + timedelta(days=_EXPIRY_DAYS)).isoformat()
    proposal = supabase.create_deal_proposal(
        deal_id=deal_id,
        crm_lead_id=deal.get("lead_id"),
        company_name=company,
        proposal_text=proposal_text,
        pain_points_referenced=pain_points,
        status="draft",
        expires_at=expires_at,
    )
    proposal_id = proposal.get("id") if proposal else None
    print(f"  [Agent 25] deal {deal_id} ({company}) → drafted (proposal {proposal_id}), awaiting review")
    return {"status": "drafted", "deal_id": deal_id, "proposal_id": proposal_id}


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
