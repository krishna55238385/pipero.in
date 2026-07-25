"""Agent 24 — Deal Qualification (PDF Phase 5 — CONVERT).

"Turns a genuinely interested reply into a scored opportunity the sales team
can see and act on."

Runs on outreach_replies rows Agent 16 classified as 'interested'
(deal_qualified=false). For each: matches the reply's email to a row in the
CRM's OWN `leads` table (magnivo.ai's leads — UUID id, distinct from
gtm_backend's leads_raw), scores buying-readiness with a BANT-style LLM read
grounded only in the reply text + whatever account research already exists,
and creates or updates a row in the CRM's existing `deals` table so the
opportunity shows up in the pipeline sales already works from.

Deliberately does NOT invent a new pipeline/stage model: `deals.status` and
`deals.probability` already exist and already drive the CRM's Kanban view
(updateDealStage in src/app/actions/crm.ts) — this agent just populates them
with a real, evidence-based score instead of a human doing that read by hand.

Conservative-by-design, matching every other agent this session:
- No CRM lead match (email never promoted into the CRM) -> the reply is
  marked deal_qualified=True (so it's not re-checked forever) but NO deal is
  created or guessed at. Nothing to attach a deal to.
- BANT dimensions with no evidence are left "unknown" by the LLM, not
  invented — see phase4/core/prompts.py.
- estimated_deal_value is only ever a number the LLM grounded in real
  evidence; otherwise null, never fabricated.
"""
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import DEAL_QUALIFICATION_SYSTEM
import json


def qualify_pending_deals(limit: int | None = None) -> dict:
    """Score and (where a CRM lead exists) create/update a deal for every
    reply currently awaiting qualification."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 24 — Deal Qualification (limit={limit or 'all'})")
    print(bar)

    replies = supabase.get_replies_needing_qualification(limit=limit)
    print(f"  → {len(replies)} interested reply(ies) awaiting qualification")

    deals_created = 0
    deals_updated = 0
    no_crm_match = 0
    failed = 0
    for reply in replies:
        result = qualify_deal(reply)
        if result["status"] == "created":
            deals_created += 1
        elif result["status"] == "updated":
            deals_updated += 1
        elif result["status"] == "no_crm_lead":
            no_crm_match += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 24 complete: {deals_created} deal(s) created · "
        f"{deals_updated} updated · {no_crm_match} no CRM lead match · {failed} failed"
    )
    return {
        "replies_examined": len(replies),
        "deals_created": deals_created,
        "deals_updated": deals_updated,
        "no_crm_lead_match": no_crm_match,
        "failed": failed,
    }


def qualify_deal(reply: dict) -> dict:
    """Score one reply and create/update its CRM deal. Always marks
    deal_qualified=True on the reply (even on 'no CRM lead' or failure) so a
    re-run of the batch doesn't reprocess the same reply forever."""
    reply_id = reply.get("id")
    email = (reply.get("email") or "").strip()
    company = reply.get("company_name") or "?"
    reply_text = reply.get("reply_text") or ""

    crm_lead = supabase.get_crm_lead_by_email(email) if email else None
    if crm_lead is None:
        print(
            f"  [Agent 24] reply {reply_id} ({company}) → no CRM lead found for "
            f"{email or '(no email on reply)'}, skipping deal creation"
        )
        supabase.update_reply(reply_id, deal_qualified=True)
        return {"status": "no_crm_lead", "reply_id": reply_id}

    context = _build_context(reply.get("lead_id"))
    payload = {
        "reply_text": reply_text,
        "account_context": context,
    }

    try:
        raw = llm.chat_json(
            DEAL_QUALIFICATION_SYSTEM,
            _stringify(payload),
            agent="agent_24_deal_qualification",
            icp_id=context.get("icp_id"),
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 24] reply {reply_id} ({company}) → qualification failed: {exc}")
        supabase.update_reply(reply_id, deal_qualified=True)
        return {"status": "failed", "reply_id": reply_id, "error": str(exc)}

    score = _coerce_score(raw.get("qualification_score"))
    value = _coerce_value(raw.get("estimated_deal_value"))
    reasoning = str(raw.get("reasoning") or "").strip() or None
    bant_note = _bant_summary(raw)
    # Include the prospect's own words verbatim, not just Agent 24's paraphrase
    # of them — downstream agents (25 Proposal Generation, 27 Executive
    # Engagement) read deal.notes as their only grounding material, and a
    # paraphrase-of-a-paraphrase produces noticeably more generic drafts than
    # working from the actual quote. Added 2026-07-25 after live-testing 24-27
    # end-to-end and finding the proposal/brief text read as boilerplate.
    quote = f'Prospect\'s own words: "{reply_text}"' if reply_text else None
    notes_parts = [p for p in (reasoning, bant_note, quote) if p]
    notes = "\n\n".join(notes_parts)

    existing_deal = supabase.get_deal_for_crm_lead(crm_lead["id"])
    deal_fields = {
        "probability": score,
        "notes": notes,
        "value": value,
        "status": _status_for_score(score),
    }

    if existing_deal is not None:
        supabase.update_deal(existing_deal["id"], **deal_fields)
        supabase.update_reply(reply_id, deal_qualified=True)
        print(f"  [Agent 24] reply {reply_id} ({company}) → updated deal {existing_deal['id']} (score={score})")
        return {"status": "updated", "reply_id": reply_id, "deal_id": existing_deal["id"], "score": score}

    new_deal = supabase.create_deal(
        lead_id=crm_lead["id"],
        title=f"{company} — inbound interest",
        **deal_fields,
    )
    supabase.update_reply(reply_id, deal_qualified=True)
    deal_id = new_deal.get("id") if new_deal else None
    print(f"  [Agent 24] reply {reply_id} ({company}) → created deal {deal_id} (score={score})")
    return {"status": "created", "reply_id": reply_id, "deal_id": deal_id, "score": score}


def _build_context(lead_id: int | None) -> dict:
    if lead_id is None:
        return {}
    intel = supabase.get_account_intel_for_lead(lead_id) or {}
    return {
        "icp_id": intel.get("icp_id"),
        "business_model": intel.get("business_model"),
        "executive_summary": intel.get("executive_summary"),
    }


def _status_for_score(score: int) -> str:
    if score >= 70:
        return "qualified"
    if score >= 30:
        return "open"
    return "needs_info"


def _bant_summary(raw: dict) -> str:
    parts = [
        f"budget={raw.get('budget', 'unknown')}",
        f"authority={raw.get('authority', 'unknown')}",
        f"need={raw.get('need', 'unknown')}",
        f"timing={raw.get('timing', 'unknown')}",
    ]
    return "BANT: " + ", ".join(parts)


def _coerce_score(value: object) -> int:
    try:
        score = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, score))


def _coerce_value(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
