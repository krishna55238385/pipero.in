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
import re

from gtm_backend.phase3.connectors import gmail_oauth
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


# Task #5 — bounce feedback loop. A real hard bounce arrives asynchronously
# as a Delivery Status Notification (DSN) from the receiving mail system, not
# as a synchronous error from Agent 14's own send call — Gmail's send API
# returns 200 even for a mailbox that doesn't exist; the actual failure comes
# back later as an inbound message, which is why this lives in the inbox
# poller rather than gmail_oauth.send_html_email itself.
_BOUNCE_SENDER_RE = re.compile(
    r"mailer-daemon|postmaster|mail delivery subsystem|mail delivery system", re.IGNORECASE
)
_BOUNCE_SUBJECT_RE = re.compile(
    r"delivery status notification|undelivered mail|mail delivery failed|"
    r"delivery has failed|returned to sender|failure notice",
    re.IGNORECASE,
)
# System addresses that show up IN THE BODY of a DSN (the reporting MTA's own
# postmaster/mailer-daemon, quoted headers, etc.) — never the actual failed
# recipient, so excluded when picking which extracted address to act on.
_BOUNCE_SYSTEM_ADDRESS_RE = re.compile(r"mailer-daemon|postmaster|no-?reply", re.IGNORECASE)
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")


def _extract_bounce_recipient(from_email: str, subject: str, body_text: str) -> str | None:
    """Returns the ORIGINALLY-FAILED recipient's email address if this
    message looks like a hard-bounce DSN, else None.

    Two-part check, both required: (1) the message itself looks like a DSN
    (sender or subject matches the well-known mailer-daemon/postmaster/
    "Delivery Status Notification" shape — this is a deterministic pattern,
    not something worth an LLM call to judge), and (2) the body actually
    contains a recoverable email address to act on. Best-effort: DSN body
    formats vary a lot across mail systems, so this takes the first email
    address in the body that isn't itself a system address — not a fully
    robust MIME/DSN parser, but sufficient to close the loop for the common
    case without a heavier dependency.
    """
    looks_like_bounce = bool(
        _BOUNCE_SENDER_RE.search(from_email or "") or _BOUNCE_SUBJECT_RE.search(subject or "")
    )
    if not looks_like_bounce:
        return None
    for match in _EMAIL_RE.finditer(body_text or ""):
        candidate = match.group(0)
        if _BOUNCE_SYSTEM_ADDRESS_RE.search(candidate):
            continue
        return candidate.lower()
    return None


def record_hard_bounce(email: str) -> bool:
    """Write a hard-bounce signal back to the lead this email belongs to.

    Downgrades the honest-confidence work from Task #5 rather than leaving a
    stale "Verified"/"domain_verified"/"person_confirmed" badge on an email
    that just proved wrong in practice: verified is cleared, bounce_status is
    set to the value Agent 14's own pre-send gate already checks for and
    skips (_SKIP_BOUNCE_STATUSES), email_verification_tier is cleared (no
    badge should show at all for a known-bad address), and
    needs_reverification is set so this lead surfaces for a human/re-
    enrichment pass instead of being silently retried or silently trusted on
    the next campaign.

    Returns True iff a lead with this contact_email was found and updated —
    same "never invent which lead a signal belongs to" discipline
    classify_reply already follows for replies.
    """
    lead = supabase.get_lead_by_email(email)
    if lead is None:
        print(f"  [Agent 16] hard bounce for {email:<32} → unmatched (no lead with this contact_email)")
        return False
    supabase.update_lead_raw(
        lead["id"],
        verified=False,
        bounce_status="bounced",
        email_verification_tier=None,
        needs_reverification=True,
    )
    print(f"  [Agent 16] hard bounce for {email:<32} → {lead.get('company_name','?')} downgraded, flagged for reverification")
    return True


def classify_reply(
    from_email: str,
    reply_text: str,
    campaign_id: str = "",
    message_id: str | None = None,
    thread_id: str | None = None,
) -> dict:
    """Classify one incoming reply and persist it. Returns a summary dict.

    `from_email` is matched against leads_raw.contact_email to find the lead
    this reply belongs to. If no match is found, nothing is written and the
    summary reports status='unmatched' — this agent never guesses a lead_id.

    `message_id`/`thread_id` are the real inbound Gmail identifiers, set by
    the inbox poller (poll_and_classify_inbox). When present, idempotency is
    checked against message_id — the true per-message dedupe key, which is
    what allows a lead to have MORE THAN ONE reply on record (Task #34: the
    old lead+campaign uniqueness ratchet made that impossible). When absent
    (the legacy/manual `classify-reply` CLI path, or hand-inserted test
    rows), idempotency falls back to the old lead+campaign check, unchanged.
    """
    lead = supabase.get_lead_by_email(from_email)
    if lead is None:
        print(f"  [Agent 16] {from_email:<32} → unmatched (no lead with this contact_email)")
        return {"status": "unmatched", "email": from_email}

    lead_id = lead["id"]
    company = lead.get("company_name") or "?"

    if message_id:
        existing = supabase.get_reply_by_message_id(message_id)
    else:
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
        message_id=message_id,
        thread_id=thread_id,
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


def poll_and_classify_inbox(days_back: int = 3, max_results: int = 25) -> dict:
    """Task #35 — the real inbox-ingestion entrypoint, replacing the manual-
    only `classify-reply` CLI path with an actual Gmail read.

    Pulls recent inbox messages from the connected mailbox (gmail_oauth),
    best-effort recovers which campaign a reply belongs to via outreach_log's
    thread_id, and runs each through the same classify_reply() everything
    else uses. Safe to call repeatedly / on a schedule: dedup is enforced at
    the DB layer by message_id (see classify_reply + schema.sql's
    uniq_outreach_replies_message_id), so the same inbox message is never
    classified twice even though every poll re-scans the whole time window.
    """
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 16 — Inbox Poller (last {days_back}d, max {max_results})")
    print(bar)

    if not gmail_oauth.is_configured():
        print("  [Agent 16] Gmail not connected — nothing to poll")
        return {"polled": 0, "counts": {}}

    messages = gmail_oauth.list_inbox_replies(days_back=days_back, max_results=max_results)
    print(f"  → {len(messages)} inbox message(s) in window")

    counts = {"classified": 0, "already_classified": 0, "unmatched": 0, "skipped_no_body": 0, "hard_bounces": 0}
    results = []
    for msg in messages:
        bounced_email = _extract_bounce_recipient(
            msg.get("from_email", ""), msg.get("subject", ""), msg.get("body_text", "")
        )
        if bounced_email:
            # A DSN is an actionable delivery-failure signal, not an
            # ambiguous reply — handled here instead of falling through to
            # classify_reply, which would otherwise just bucket it as the
            # generic "unknown" (auto-reply/bounce-looking/ambiguous) type
            # and lose the specific recipient-downgrade action.
            matched = record_hard_bounce(bounced_email)
            counts["hard_bounces"] += 1
            results.append({"status": "hard_bounce", "email": bounced_email, "matched": matched})
            continue
        if not msg.get("body_text"):
            counts["skipped_no_body"] += 1
            continue
        result = classify_reply(
            from_email=msg.get("from_email", ""),
            reply_text=msg.get("body_text", ""),
            campaign_id=_campaign_id_for_thread(msg.get("thread_id")),
            message_id=msg.get("message_id"),
            thread_id=msg.get("thread_id"),
        )
        counts[result["status"]] = counts.get(result["status"], 0) + 1
        results.append(result)

    print(
        f"  ✓ Agent 16 poll complete: {counts['classified']} classified · "
        f"{counts['already_classified']} already done · {counts['unmatched']} unmatched · "
        f"{counts['hard_bounces']} hard bounce(s) · "
        f"{counts['skipped_no_body']} skipped (no readable body)"
    )
    return {"polled": len(messages), "counts": counts, "results": results}


def _campaign_id_for_thread(thread_id: str | None) -> str:
    """Best-effort campaign_id recovery for an inbound reply: match the
    Gmail thread_id against outreach_log (populated when Agent 14 sends via
    Gmail). Returns "" — not None — when nothing matches, e.g. a cold reply
    to a thread we didn't originate; classify_reply treats "" the same as
    any other campaign_id."""
    if not thread_id:
        return ""
    log_row = supabase.get_outreach_log_by_thread_id(thread_id)
    return (log_row or {}).get("campaign_id") or ""


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
