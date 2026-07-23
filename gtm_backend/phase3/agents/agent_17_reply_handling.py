"""Agent 17 — Reply Handling (PDF Phase 4 — ENGAGE).

"Responds to every reply with the right message at the right speed."

Drafts a response for each reply Agent 16 classified as needing one
(interested / not_now / wrong_person / has_question). Deliberately DRAFT-ONLY:
this agent never sends anything itself. The architecture doc's own rule for
this agent is "all automated responses must be reviewed before sending for
high-value accounts" — since there's no reliable way yet to tell which
accounts are "high-value" versus safe to fully automate, the safer default is
to hold EVERY draft for human approval. A human (via the CRM) reviews the
draft and calls `send_approved_response` to actually dispatch it.

Flow: Agent 16 classifies -> response_status='pending_draft' (for anything
actionable) -> Agent 17 drafts -> response_status='pending_review' -> human
approves in the CRM -> response_status='approved' -> send_approved_response
sends it -> response_status='sent'.

not_interested and unknown replies never reach this agent (Agent 16 already
marks them 'no_response_needed' — nothing to draft, the pause gate is enough).
"""
import json
from datetime import datetime, timezone

from gtm_backend.phase3.connectors import gmail_oauth as gmail_smtp
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.config import get_settings
from gtm_backend.phase3.core.prompts import REPLY_RESPONSE_DRAFT_SYSTEM


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def draft_pending_responses(limit: int | None = None) -> dict:
    """Draft a response for every reply currently awaiting one."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 17 — Reply Handling (drafting, limit={limit or 'all'})")
    print(bar)

    replies = supabase.get_replies_needing_draft(limit=limit)
    print(f"  → {len(replies)} reply(ies) awaiting a draft")

    drafted = 0
    failed = 0
    for reply in replies:
        result = draft_response(reply)
        if result["status"] == "drafted":
            drafted += 1
        else:
            failed += 1

    print(f"  ✓ Agent 17 complete: {drafted} drafted · {failed} failed")
    return {"replies_examined": len(replies), "drafted": drafted, "failed": failed}


def draft_response(reply: dict) -> dict:
    """Draft one response, grounded in whatever account context is available.
    Always leaves the row at response_status='pending_review' — never
    auto-approves or sends."""
    reply_id = reply.get("id")
    lead_id = reply.get("lead_id")
    classification = reply.get("classification")
    reply_text = reply.get("reply_text") or ""
    company = reply.get("company_name") or "this account"

    context = _build_context(lead_id)
    payload = {
        "classification": classification,
        "reply_text": reply_text,
        "account_context": context,
        # Populated by Agent 18 when it ran first and found a real objection;
        # null/absent otherwise (e.g. this reply hasn't been through Agent 18
        # yet, or Agent 18 found no objection) — the draft prompt is written
        # to just ignore these fields when they're not meaningfully present.
        "objection_type": reply.get("objection_type"),
        "rebuttal_angle": reply.get("rebuttal_angle"),
    }

    try:
        raw = llm.chat_json(
            REPLY_RESPONSE_DRAFT_SYSTEM,
            _stringify(payload),
            agent="agent_17_reply_handling",
            icp_id=context.get("icp_id"),
            phase="phase3",
        )
        draft = str(raw.get("draft_response") or "").strip()
    except Exception as exc:
        print(f"  [Agent 17] reply {reply_id} ({company}) → draft failed: {exc}")
        supabase.update_reply(reply_id, response_status="pending_review", draft_response=None)
        return {"status": "failed", "reply_id": reply_id, "error": str(exc)}

    if not draft:
        print(f"  [Agent 17] reply {reply_id} ({company}) → LLM returned empty draft")
        supabase.update_reply(reply_id, response_status="pending_review", draft_response=None)
        return {"status": "failed", "reply_id": reply_id, "error": "empty draft"}

    supabase.update_reply(
        reply_id,
        draft_response=draft,
        response_status="pending_review",
        drafted_at=_now_iso(),
    )
    print(f"  [Agent 17] reply {reply_id} ({company}, {classification}) → drafted, awaiting review")
    return {"status": "drafted", "reply_id": reply_id, "draft_response": draft}


def send_approved_response(reply_id: int) -> dict:
    """Send a draft a human has already approved. Refuses to send anything
    not explicitly marked response_status='approved' — this is the one hard
    gate preventing an un-reviewed draft from ever going out."""
    reply = supabase.get_reply_by_id(reply_id)
    if reply is None:
        return {"status": "not_found", "reply_id": reply_id}
    if reply.get("response_status") != "approved":
        print(
            f"  [Agent 17] reply {reply_id} → refusing to send "
            f"(response_status={reply.get('response_status')!r}, must be 'approved')"
        )
        return {"status": "not_approved", "reply_id": reply_id}

    draft = reply.get("draft_response")
    email = reply.get("email")
    if not draft or not email:
        return {"status": "missing_content", "reply_id": reply_id}

    settings = get_settings()
    if not gmail_smtp.is_configured():
        print(f"  [Agent 17] reply {reply_id} → Gmail not configured, cannot send")
        return {"status": "not_configured", "reply_id": reply_id}

    try:
        result = gmail_smtp.send_html_email(
            to=email,
            subject=_reply_subject(reply),
            html_body=draft.replace("\n", "<br>\n"),
            from_name=settings.email_brand_name,
        )
    except Exception as exc:
        print(f"  [Agent 17] reply {reply_id} → send failed: {exc}")
        return {"status": "failed", "reply_id": reply_id, "error": str(exc)}

    supabase.update_reply(
        reply_id,
        response_status="sent",
        sent_at=_now_iso(),
        response_message_id=result.get("message_id"),
        response_thread_id=result.get("thread_id"),
    )
    print(f"  [Agent 17] reply {reply_id} → sent to {email}")
    return {"status": "sent", "reply_id": reply_id}


def _build_context(lead_id: int | None) -> dict:
    """Pull whatever account context exists for this lead — grounds the draft
    so it can answer questions accurately instead of guessing."""
    if lead_id is None:
        return {}
    intel = supabase.get_account_intel_for_lead(lead_id) or {}
    return {
        "icp_id": intel.get("icp_id"),
        "business_model": intel.get("business_model"),
        "executive_summary": intel.get("executive_summary"),
    }


def _reply_subject(reply: dict) -> str:
    company = reply.get("company_name") or ""
    return f"Re: {company}".strip() or "Re: your message"


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
