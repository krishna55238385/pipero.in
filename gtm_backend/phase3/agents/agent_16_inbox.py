"""Agent 16 — Inbox Management (PDF Phase 4 — ENGAGE).

"Monitors and classifies every reply across every channel instantly."

This agent is deliberately decoupled from the actual mailbox-reading
mechanism: it does NOT poll or watch Gmail itself. That piece (matching an
incoming message to the right thread, extracting sender + body) belongs to
the CRM's own Gmail integration, being built separately. Agent 16's job
starts one step later: given a reply that's already been fetched — a From
address, campaign_id (optional), and body text — classify it and write the
result to outreach_replies, which Agent 14's reply-pause gate already reads.

This means Agent 16 can be built, tested, and deployed today even though the
raw-reply-fetching integration hasn't landed yet: whoever finishes that
piece just needs to call `classify_reply(...)` per new message.

Business rules (from AI-GTM-Agency-Business-Architecture-A4.pdf, Agent 16):
- Every reply is classified into one of 6 buckets (see REPLY_CLASSIFICATION_SYSTEM).
- Low-confidence classifications are still recorded, never dropped, so a human
  can review — this agent doesn't gate on confidence, it flags it.
- Idempotent: re-processing the same (lead_id, campaign_id) reply does not
  create a duplicate row or reclassify — the first classification wins.
- Never invents which lead a reply belongs to: if the From-address doesn't
  match any known contact_email, the reply is reported as unmatched rather
  than guessed at.
"""
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.prompts import REPLY_CLASSIFICATION_SYSTEM
from gtm_backend.phase3.core.schemas import ReplyRecord

_VALID_CLASSIFICATIONS = {
    "interested", "not_now", "wrong_person", "has_question", "not_interested", "unknown",
}
_VALID_CONFIDENCE = {"low", "medium", "high"}

# not_interested = hard decline, pause only, nothing to draft (Agent 14's
# reply-pause gate already handles this the moment this row exists).
# unknown = auto-reply/bounce/ambiguous — needs a human to triage before any
# draft is worth generating, so Agent 17 skips it too.
_NO_DRAFT_NEEDED = {"not_interested", "unknown"}


def classify_reply(
    from_email: str,
    reply_text: str,
    campaign_id: str = "",
) -> dict:
    """Classify one incoming reply and persist it. Returns a summary dict.

    `from_email` is matched against leads_raw.contact_email to find the lead
    this reply belongs to. If no match is found, nothing is written and the
    summary reports status='unmatched' — this agent never guesses a lead_id.
    """
    lead = supabase.get_lead_by_email(from_email)
    if lead is None:
        print(f"  [Agent 16] {from_email:<32} → unmatched (no lead with this contact_email)")
        return {"status": "unmatched", "email": from_email}

    lead_id = lead["id"]
    company = lead.get("company_name") or "?"

    existing = supabase.get_reply_for_lead(lead_id, campaign_id)
    if existing is not None:
        print(f"  [Agent 16] {company:<28} → already classified ({existing.get('classification')}), skipping")
        return {
            "status": "already_classified",
            "lead_id": lead_id,
            "classification": existing.get("classification"),
        }

    classification, confidence, suggested_action = _classify_text(reply_text)
    response_status = "no_response_needed" if classification in _NO_DRAFT_NEEDED else "pending_draft"

    record = ReplyRecord(
        lead_id=lead_id,
        email=from_email,
        campaign_id=campaign_id,
        classification=classification,
        confidence=confidence,
        reply_text=reply_text,
        suggested_action=suggested_action,
        response_status=response_status,
    )
    reply_id = supabase.insert_reply(record)

    flag = "⚠ REVIEW" if confidence == "low" else ""
    print(
        f"  [Agent 16] {company:<28} → {classification} ({confidence}) · {suggested_action} {flag}"
    )
    return {
        "status": "classified",
        "reply_id": reply_id,
        "lead_id": lead_id,
        "classification": classification,
        "confidence": confidence,
        "suggested_action": suggested_action,
    }


def classify_replies_batch(replies: list[dict]) -> dict:
    """Classify a batch of {"from_email", "reply_text", "campaign_id"} dicts.

    Convenience entrypoint for whoever wires up the real Gmail-polling loop —
    call this once per polling cycle with all new messages found.
    """
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 16 — Inbox Management ({len(replies)} reply(ies) to process)")
    print(bar)

    counts = {"classified": 0, "already_classified": 0, "unmatched": 0}
    results = []
    for item in replies:
        result = classify_reply(
            from_email=item.get("from_email", ""),
            reply_text=item.get("reply_text", ""),
            campaign_id=item.get("campaign_id", ""),
        )
        counts[result["status"]] = counts.get(result["status"], 0) + 1
        results.append(result)

    print(
        f"  ✓ Agent 16 complete: {counts['classified']} classified · "
        f"{counts['already_classified']} already done · {counts['unmatched']} unmatched"
    )
    return {"counts": counts, "results": results}


def _classify_text(reply_text: str) -> tuple[str, str, str]:
    """Ask the LLM to classify raw reply text. Falls back to a safe default
    ('unknown'/'low'/escalate-to-human) on any LLM failure — never crashes
    the caller, and never silently guesses a confident answer when the LLM
    call itself failed."""
    try:
        raw = llm.chat_json(
            REPLY_CLASSIFICATION_SYSTEM,
            reply_text,
            agent="agent_16_inbox",
            phase="phase3",
        )
    except Exception as exc:
        print(f"  [Agent 16] classification failed, escalating to human: {exc}")
        return "unknown", "low", "escalate to human — classification failed"

    classification = str(raw.get("classification") or "unknown").lower()
    if classification not in _VALID_CLASSIFICATIONS:
        classification = "unknown"
    confidence = str(raw.get("confidence") or "low").lower()
    if confidence not in _VALID_CONFIDENCE:
        confidence = "low"
    suggested_action = str(raw.get("suggested_action") or "").strip() or "escalate to human — no action suggested"
    return classification, confidence, suggested_action
