"""Agent 27 — Executive Engagement (PDF Phase 5 — CONVERT).

"Engages senior decision makers with board-level business conversations."

Runs on the same 'qualified' deals Agent 25 (Proposal Generation) reads,
drafting a one-page executive business case — outcomes and financial impact,
never product features — for a C-suite reader.

PDF hard rule: "must never be sent before a Champion has been engaged and
briefed." This codebase has no dedicated Champion-tracking agent/table yet
(that's further out in the roadmap), so this agent uses the most honest
available proxy: Agent 24's own BANT "authority=yes" finding on the deal
(literally "someone with decision-making authority is engaged," which is
what a Champion being briefed implies at minimum). A deal without that
signal is skipped entirely — no row is even created — rather than guessing
readiness. This is a proxy, not the real thing; worth revisiting once an
actual Champion Tracker agent (Agent 42, Phase 7) exists.

Same draft-only pattern as every other messaging agent this session — this
never sends anything, and the PDF's own rule underlines why: "executive
engagement must be coordinated with Champion — no surprises." Coordinating
with a human Champion is inherently a human's job, not this agent's.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.config import get_settings
from gtm_backend.phase4.core.prompts import EXECUTIVE_ENGAGEMENT_SYSTEM


def generate_pending_executive_briefs(limit: int | None = None) -> dict:
    """Draft an executive brief for every qualified deal with an engaged
    champion signal that doesn't have one yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 27 — Executive Engagement (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_qualified_deals(limit=limit)
    print(f"  → {len(deals)} qualified deal(s) examined")

    drafted = 0
    held = 0
    already_exists = 0
    skipped_no_champion = 0
    failed = 0
    for deal in deals:
        result = generate_executive_brief(deal)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "held":
            held += 1
        elif status == "already_exists":
            already_exists += 1
        elif status == "skipped_no_champion_signal":
            skipped_no_champion += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 27 complete: {drafted} drafted · {held} held · "
        f"{already_exists} already had a brief · "
        f"{skipped_no_champion} skipped (no champion/authority signal) · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "drafted": drafted,
        "held": held,
        "already_exists": already_exists,
        "skipped_no_champion_signal": skipped_no_champion,
        "failed": failed,
    }


def generate_executive_brief(deal: dict) -> dict:
    """Draft (or hold) one executive brief for one qualified deal. Hard-gated
    on an authority/champion signal before anything else happens."""
    deal_id = deal.get("id")
    company = deal.get("title") or "this prospect"
    notes = deal.get("notes") or ""

    if not _has_champion_signal(notes):
        return {"status": "skipped_no_champion_signal", "deal_id": deal_id}

    existing = supabase.get_brief_for_deal(deal_id)
    if existing is not None:
        return {"status": "already_exists", "deal_id": deal_id}

    payload = {
        "deal_notes": notes,
        "estimated_deal_value": deal.get("value"),
        "seller_product_description": get_settings().seller_product_description,
    }

    try:
        raw = llm.chat_json(
            EXECUTIVE_ENGAGEMENT_SYSTEM,
            _stringify(payload),
            agent="agent_27_executive_engagement",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 27] deal {deal_id} ({company}) → brief generation failed: {exc}")
        return {"status": "failed", "deal_id": deal_id, "error": str(exc)}

    held_flag = bool(raw.get("held"))
    brief_text = str(raw.get("brief_text") or "").strip()
    outcome_summary = str(raw.get("business_outcome_summary") or "").strip() or None
    peer_reference = raw.get("peer_reference")
    if not isinstance(peer_reference, str) or not peer_reference.strip():
        peer_reference = None

    if held_flag or not brief_text:
        reason = str(raw.get("held_reason") or "insufficient evidence for a credible executive case").strip()
        supabase.create_executive_brief(
            deal_id=deal_id,
            crm_lead_id=deal.get("lead_id"),
            company_name=company,
            brief_text="",
            business_outcome_summary=outcome_summary,
            peer_reference=None,
            status="held",
        )
        print(f"  [Agent 27] deal {deal_id} ({company}) → held: {reason}")
        return {"status": "held", "deal_id": deal_id, "reason": reason}

    brief = supabase.create_executive_brief(
        deal_id=deal_id,
        crm_lead_id=deal.get("lead_id"),
        company_name=company,
        brief_text=brief_text,
        business_outcome_summary=outcome_summary,
        peer_reference=peer_reference,
        status="draft",
    )
    brief_id = brief.get("id") if brief else None
    print(f"  [Agent 27] deal {deal_id} ({company}) → drafted (brief {brief_id}), awaiting review")
    return {"status": "drafted", "deal_id": deal_id, "brief_id": brief_id}


def _has_champion_signal(notes: str) -> bool:
    """Proxy for 'a Champion has been engaged and briefed' — see module
    docstring. Looks for Agent 24's exact BANT summary phrase."""
    return "authority=yes" in notes.lower()


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
