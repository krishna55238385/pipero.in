"""Agent 42 — Champion Tracker (PDF Phase 7 — RETAIN & GROW).

"Follows your best contacts when they move to new companies."

Runs on CRM contacts attached to WON deals (verified past customers — the
PDF's own population definition: "contacts who have previously engaged
positively or been customers"). One champion_moves row is logged per contact
the first time it's checked, recording whatever the check found (no move, a
move to a competitor, or a move worth a warm re-connect).

PDF rules and how each is actually handled:
- "Must monitor all contacts who have previously engaged positively or been
  customers" — SCOPED, documented honestly: this agent covers WON-deal
  contacts (verified customers) only, not the broader "engaged positively"
  set, since that would need a defined signal for positive engagement this
  codebase doesn't track yet.
- "Job change alert must fire within 48 hours of detection" — SATISFIED VIA
  RUN FREQUENCY, not real-time push: this codebase has no event/webhook
  layer, so "alert within 48 hours" means this agent should be scheduled to
  run at least daily. Each run either finds and logs a move immediately, or
  finds nothing — there's no polling delay built into the agent itself.
- "Re-engagement outreach must happen within 1 week of the job change" —
  the draft is created in the SAME run the move is detected, so the human
  reviewing drafts is never more than one run cycle behind — same
  draft-immediately, review-before-send pattern as every other messaging
  agent this session.
- "Must reference the previous relationship naturally" — enforced in the
  prompt (CHAMPION_MOVE_SYSTEM).
- "Must research the new company before reaching out — is it an ICP fit?"
  — PARTIALLY BUILT, documented honestly: full ICP scoring (Agent 03's own
  logic) isn't invoked here — that would mean creating a brand-new lead
  record for a company that may not even be in this org's ICP, which is a
  bigger decision than this agent should make silently. Instead, the LLM
  is asked to make a coarse read of the new company from search snippets +
  the org's own product description, and a human reviews the fit before
  sending — same review-first posture as everywhere else.
- "Must not reach out if the contact moved to a competitor" — BUILT as a
  hard gate: if the LLM flags is_competitor=true, no content is drafted at
  all, regardless of anything else in its response — status is set to
  'competitor_skip' before the outreach-drafting code path is ever reached.
- "All champion move activity must be logged and tracked for ROI
  measurement" — BUILT: every contact that gets a real check (LinkedIn
  search returned something) gets exactly one champion_moves row logging
  the outcome — 'held' (no move found / not enough evidence),
  'competitor_skip', or 'drafted'.

Known scope limitation: each contact is checked once, ever (any existing
champion_moves row — regardless of outcome — permanently skips it on future
runs). A contact who moves TWICE won't be caught by v1. Adding a periodic
re-check cadence (like Agent 40/41's next_eligible_at) would be a natural
follow-up once this is proven useful; kept out of v1 to avoid re-running
LinkedIn searches against contacts already resolved as "no move" every
single day for no reason.

Draft-only, same human-review-first pattern as every other messaging agent
this session — content_text is never sent automatically.
"""
import json

from gtm_backend.phase1.connectors import serpapi
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import CHAMPION_MOVE_SYSTEM


def run_champion_tracker(limit: int | None = None) -> dict:
    """Check every not-yet-checked champion contact for a job change; log
    the outcome, and draft a warm re-connect if they've moved somewhere
    that isn't a competitor."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 42 — Champion Tracker (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_won_deals_with_contacts(limit=limit)
    print(f"  → {len(deals)} won deal(s) with a contact on file")

    drafted = 0
    competitor_skip = 0
    held = 0
    already_checked = 0
    failed = 0

    for deal in deals:
        result = _process_champion(deal)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "competitor_skip":
            competitor_skip += 1
        elif status == "held":
            held += 1
        elif status == "already_checked":
            already_checked += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 42 complete: {drafted} drafted (warm re-connect) · "
        f"{competitor_skip} skipped (moved to competitor) · {held} held (no move found) · "
        f"{already_checked} already checked · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "drafted": drafted,
        "competitor_skip": competitor_skip,
        "held": held,
        "already_checked": already_checked,
        "failed": failed,
    }


def _process_champion(deal: dict) -> dict:
    contact_id = deal.get("contact_id")
    if not contact_id:
        return {"status": "failed", "reason": "deal has no contact_id"}

    history = supabase.get_champion_move_history(contact_id)
    if history:
        # Already checked once, ever — see module docstring for why this
        # doesn't re-check on a cadence yet.
        return {"status": "already_checked"}

    contact = supabase.get_contact_by_id(contact_id) or {}
    contact_name = (contact.get("name") or "").strip()
    if not contact_name:
        return {"status": "failed", "reason": "contact has no name on file"}

    company = supabase.get_company_by_id(contact.get("company_id"))
    original_company = (company or {}).get("name") or deal.get("title") or "their previous company"

    try:
        results = serpapi.search(f'site:linkedin.com/in "{contact_name}"', num=5)
    except Exception as exc:
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → LinkedIn search failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    if not results:
        supabase.create_champion_move(
            contact_id=contact_id,
            contact_name=contact_name,
            original_company=original_company,
            original_deal_id=deal.get("id"),
            status="held",
            held_reason="no LinkedIn results found for this contact",
        )
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → held: no LinkedIn results")
        return {"status": "held"}

    snippets = [
        {"title": r.get("title"), "snippet": r.get("snippet"), "link": r.get("link")}
        for r in results
    ]
    seller_product_description = supabase.get_org_product_description(deal.get("organization_id"))
    payload = {
        "contact_name": contact_name,
        "original_company": original_company,
        "linkedin_snippets": snippets,
        "seller_product_description": seller_product_description,
    }

    try:
        raw = llm.chat_json(
            CHAMPION_MOVE_SYSTEM,
            _stringify(payload),
            agent="agent_42_champion_tracker",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → generation failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    moved = bool(raw.get("moved"))
    new_company_name = str(raw.get("new_company_name") or "").strip() or None
    new_title = str(raw.get("new_title") or "").strip() or None
    is_competitor = bool(raw.get("is_competitor"))
    content_text = str(raw.get("content_text") or "").strip()
    held_flag = bool(raw.get("held"))

    if not moved:
        reason = str(raw.get("held_reason") or "no clear job change found in available evidence").strip()
        supabase.create_champion_move(
            contact_id=contact_id,
            contact_name=contact_name,
            original_company=original_company,
            original_deal_id=deal.get("id"),
            status="held",
            held_reason=reason,
        )
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → held: {reason}")
        return {"status": "held"}

    if is_competitor:
        supabase.create_champion_move(
            contact_id=contact_id,
            contact_name=contact_name,
            original_company=original_company,
            original_deal_id=deal.get("id"),
            new_company_name=new_company_name,
            new_title=new_title,
            is_competitor=True,
            status="competitor_skip",
            held_reason="moved to a competitor — PDF rule prohibits outreach",
        )
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → competitor_skip: moved to {new_company_name}")
        return {"status": "competitor_skip"}

    if held_flag or not content_text:
        reason = str(raw.get("held_reason") or "moved, but not enough to draft a credible message").strip()
        supabase.create_champion_move(
            contact_id=contact_id,
            contact_name=contact_name,
            original_company=original_company,
            original_deal_id=deal.get("id"),
            new_company_name=new_company_name,
            new_title=new_title,
            is_competitor=False,
            status="held",
            held_reason=reason,
        )
        print(f"  [Agent 42] contact {contact_id} ({contact_name}) → held: {reason}")
        return {"status": "held"}

    supabase.create_champion_move(
        contact_id=contact_id,
        contact_name=contact_name,
        original_company=original_company,
        original_deal_id=deal.get("id"),
        new_company_name=new_company_name,
        new_title=new_title,
        is_competitor=False,
        content_text=content_text,
        status="drafted",
    )
    print(f"  [Agent 42] contact {contact_id} ({contact_name}) → drafted: moved to {new_company_name}")
    return {"status": "drafted"}


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
