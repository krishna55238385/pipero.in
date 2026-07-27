"""Agent 40 — Lead Nurturing (PDF Phase 7 — RETAIN & GROW).

"Manages a long-term engagement programme for leads that said not now —
sends relevant, valuable content, checks in at the right intervals, and
re-activates the sales conversation when a buying signal appears."

Runs on outreach_replies classified 'not_now' (Agent 16's classification —
a soft decline tied to timing, not a hard no). One nurture_touches row is
appended per touch, forming the history that enforces the PDF's own cadence
and no-repeat rules.

PDF rules and how each is actually handled:
- "Nurture cadence: maximum one meaningful touch per month" — BUILT. The
  latest nurture_touches row's next_eligible_at gates every subsequent draft.
- "Must not use the same content twice with the same contact within 6
  months" — BUILT. Full touch history (content_topic) is passed to the LLM
  as previous_topics_sent, with an explicit hard rule against repeating any
  of them.
- "Every touchpoint must provide genuine value — no hollow check-ins" —
  enforced in the prompt (LEAD_NURTURE_SYSTEM) with an explicit held=true
  escape hatch when nothing genuinely new/valuable can be said.
- "Must trigger immediate re-engagement when a buying signal is detected" —
  BUILT. Checks buying_signals for anything detected since the lead's last
  touch (or since they entered nurture, if no touch yet); if found, the lead
  exits nurture (status='converted') instead of getting more content — no
  content is drafted, this is a hard gate before the LLM is even called.
- "Opt-out from nurture must be immediate and permanent" — BUILT by reusing
  the EXISTING outreach_unsubscribes table/gate (get_unsubscribed_emails) —
  the same one Agent 14's sender already respects — rather than building a
  second, parallel opt-out mechanism.
- "Leads in nurture must be reviewed quarterly — are they still a valid
  ICP?" — approximated, documented honestly: rather than a literal calendar-
  quarter review cycle (which would need its own scheduler state), this
  agent re-checks the lead's current score_tier (Agent 05's own scoring,
  already fresh from Agent 37/re-runs) EVERY run — if a lead now scores
  cold/disqualified, nurture is paused. This is MORE frequent than the PDF's
  quarterly minimum, not less, so it satisfies the rule's intent (verify
  ICP validity isn't stale) via a mechanism this codebase already has,
  rather than inventing new "quarter" bookkeeping.
- "Nurture content must be relevant to the lead's industry and pain points"
  — grounded in the same account_intelligence/gtm_insights data Agent 11
  already uses for personalisation, when available; genuinely absent for a
  lead, the prompt is instructed to write industry-general value rather than
  inventing specifics.

Draft-only, same human-review-first pattern as every messaging agent this
session — content_text is never sent automatically.
"""
import json
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import LEAD_NURTURE_SYSTEM

_TOUCH_INTERVAL_DAYS = 30
_INVALID_ICP_TIERS = {"cold", "disqualified"}


def run_lead_nurturing(limit: int | None = None) -> dict:
    """Advance the nurture programme for every 'not_now' lead: exit on a
    fresh buying signal, pause if no longer a valid ICP fit, skip if
    unsubscribed, otherwise draft the next touch if the cadence allows it."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 40 — Lead Nurturing (limit={limit or 'all'})")
    print(bar)

    replies = supabase.get_not_now_replies(limit=limit)
    unsubscribed = supabase.get_unsubscribed_emails()
    print(f"  → {len(replies)} 'not_now' repl(y/ies) examined")

    drafted = 0
    converted = 0
    paused = 0
    opted_out = 0
    not_yet_eligible = 0
    held = 0
    failed = 0

    for reply in replies:
        result = _process_lead(reply, unsubscribed)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "converted_by_signal":
            converted += 1
        elif status == "paused_invalid_icp":
            paused += 1
        elif status == "opted_out":
            opted_out += 1
        elif status == "not_yet_eligible":
            not_yet_eligible += 1
        elif status == "held":
            held += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 40 complete: {drafted} drafted · {converted} converted (signal detected) · "
        f"{paused} paused (invalid ICP) · {opted_out} opted out · "
        f"{not_yet_eligible} not yet eligible (cadence) · {held} held (no genuine value) · {failed} failed"
    )
    return {
        "replies_examined": len(replies),
        "drafted": drafted,
        "converted_by_signal": converted,
        "paused_invalid_icp": paused,
        "opted_out": opted_out,
        "not_yet_eligible": not_yet_eligible,
        "held": held,
        "failed": failed,
    }


def _process_lead(reply: dict, unsubscribed: set[str]) -> dict:
    lead_id = reply.get("lead_id")
    reply_id = reply.get("id")
    email = (reply.get("email") or "").strip().lower()
    company = reply.get("company_name") or "?"

    if lead_id is None:
        return {"status": "held", "reason": "no lead_id on reply"}

    if email and email in unsubscribed:
        print(f"  [Agent 40] lead {lead_id} ({company}) → opted out, skipping")
        return {"status": "opted_out"}

    history = supabase.get_nurture_touch_history(lead_id)
    latest = history[0] if history else None

    since = latest.get("created_at") if latest else reply.get("replied_at")
    fresh_signals = supabase.get_signals_since(lead_id, since)
    if fresh_signals:
        supabase.create_nurture_touch(
            lead_id=lead_id,
            reply_id=reply_id,
            touch_number=len(history) + 1,
            status="converted",
            held_reason=f"buying signal detected ({fresh_signals[0].get('signal_type', 'unknown')}) — route to re-engagement",
        )
        print(f"  [Agent 40] lead {lead_id} ({company}) → converted: fresh buying signal detected")
        return {"status": "converted_by_signal"}

    lead = supabase.get_account_intel_for_lead(lead_id) or {}
    lead_row = supabase.get_lead_raw_by_id(lead_id) or {}
    score_tier = (lead_row.get("score_tier") or "").lower()
    if score_tier in _INVALID_ICP_TIERS:
        supabase.create_nurture_touch(
            lead_id=lead_id,
            reply_id=reply_id,
            touch_number=len(history) + 1,
            status="paused",
            held_reason=f"current score_tier={score_tier} — no longer a valid ICP fit",
        )
        print(f"  [Agent 40] lead {lead_id} ({company}) → paused: score_tier={score_tier}")
        return {"status": "paused_invalid_icp"}

    if latest and latest.get("status") in {"converted", "paused"}:
        # Already exited nurture in a prior run; don't re-process.
        return {"status": "not_yet_eligible"}

    if latest and latest.get("next_eligible_at"):
        next_eligible = _parse_dt(latest["next_eligible_at"])
        if next_eligible and datetime.now(timezone.utc) < next_eligible:
            return {"status": "not_yet_eligible"}

    previous_topics = [h.get("content_topic") for h in history if h.get("content_topic")]
    payload = {
        "company_name": company,
        "account_context": lead,
        "previous_topics_sent": previous_topics,
    }

    try:
        raw = llm.chat_json(
            LEAD_NURTURE_SYSTEM,
            _stringify(payload),
            agent="agent_40_lead_nurturing",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 40] lead {lead_id} ({company}) → generation failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    held_flag = bool(raw.get("held"))
    content_text = str(raw.get("content_text") or "").strip()
    content_topic = str(raw.get("content_topic") or "").strip() or None

    if held_flag or not content_text:
        reason = str(raw.get("held_reason") or "no genuinely new value to offer this touch").strip()
        supabase.create_nurture_touch(
            lead_id=lead_id,
            reply_id=reply_id,
            touch_number=len(history) + 1,
            content_topic=content_topic,
            status="draft",
            held_reason=reason,
            next_eligible_at=_next_eligible_iso(),
        )
        print(f"  [Agent 40] lead {lead_id} ({company}) → held: {reason}")
        return {"status": "held"}

    supabase.create_nurture_touch(
        lead_id=lead_id,
        reply_id=reply_id,
        touch_number=len(history) + 1,
        content_topic=content_topic,
        content_text=content_text,
        status="draft",
        next_eligible_at=_next_eligible_iso(),
    )
    print(f"  [Agent 40] lead {lead_id} ({company}) → drafted touch #{len(history) + 1} ({content_topic})")
    return {"status": "drafted"}


def _next_eligible_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=_TOUCH_INTERVAL_DAYS)).isoformat()


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
