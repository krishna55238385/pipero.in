"""Agent 26 — Proposal Follow-up (PDF Phase 5 — CONVERT).

"Tracks proposal engagement and follows up at exactly the right moment."

Runs on deal_proposals rows a human has marked status='sent'. Reads whatever
engagement signal exists (opened_at, open_count, shared_with_others — fields
Agent 25 created but nothing populates yet, since no proposal send/tracking
integration is wired up. Built ahead of that integration on purpose, same
pattern as Agent 16 being built before the real inbox connection existed:
until something starts writing real values into those columns, this agent
simply never finds anything to act on. That's the correct, safe default —
not a bug.

PDF business rules encoded directly in the branching logic below:
- Not opened within 48 hours -> a light check-in follow-up.
- Opened multiple times (open_count >= 2) -> a more direct, high-intent
  follow-up (a real next step, not just "any thoughts?").
- Shared with others -> alert the seller immediately (not an LLM draft, a
  plain notification — this is a "wake a human up" signal, not a message to
  the prospect).
- Maximum 3 follow-ups, then stop — moving to a different approach is a
  human decision, not something this agent invents on its own.
- Every follow-up drafted must reference a specific point from the actual
  proposal_text (enforced in the prompt itself, phase4/core/prompts.py).
- Never creates false urgency (also enforced in the prompt).

Draft-only, same as every other Phase 4/5 messaging agent this session: this
never sends anything, only writes draft_followup_text for a human to review
and send via whatever channel they're already using.
"""
import json
from datetime import datetime, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import PROPOSAL_FOLLOWUP_SYSTEM

_MAX_FOLLOWUPS = 3
_NOT_OPENED_HOURS_THRESHOLD = 48
_HIGH_INTENT_OPEN_COUNT = 2


def check_proposal_followups(limit: int | None = None) -> dict:
    """Evaluate every sent proposal and act on whichever single rule applies
    (seller alert takes priority over a drafted follow-up in the same pass)."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 26 — Proposal Follow-up (limit={limit or 'all'})")
    print(bar)

    proposals = supabase.get_sent_proposals(limit=limit)
    print(f"  → {len(proposals)} sent proposal(s) examined")

    drafted = 0
    seller_alerted = 0
    no_action = 0
    max_reached = 0
    failed = 0
    for proposal in proposals:
        result = evaluate_proposal(proposal)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "seller_alerted":
            seller_alerted += 1
        elif status == "max_followups_reached":
            max_reached += 1
        elif status == "no_action_needed":
            no_action += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 26 complete: {drafted} follow-up(s) drafted · "
        f"{seller_alerted} seller alert(s) · {max_reached} at max follow-ups · "
        f"{no_action} no action needed · {failed} failed"
    )
    return {
        "proposals_examined": len(proposals),
        "drafted": drafted,
        "seller_alerted": seller_alerted,
        "max_followups_reached": max_reached,
        "no_action_needed": no_action,
        "failed": failed,
    }


def evaluate_proposal(proposal: dict) -> dict:
    """Apply the PDF's rules to one sent proposal and take at most one
    action."""
    proposal_id = proposal.get("id")
    company = proposal.get("company_name") or "this deal"

    if proposal.get("shared_with_others") and not proposal.get("seller_alerted"):
        supabase.update_deal_proposal(proposal_id, seller_alerted=True)
        print(f"  [Agent 26] proposal {proposal_id} ({company}) → ⚠ ALERT: shared with others, notify seller immediately")
        return {"status": "seller_alerted", "proposal_id": proposal_id}

    followup_count = proposal.get("followup_count") or 0
    if followup_count >= _MAX_FOLLOWUPS:
        return {"status": "max_followups_reached", "proposal_id": proposal_id}

    signal = _determine_signal(proposal)
    if signal is None:
        return {"status": "no_action_needed", "proposal_id": proposal_id}

    proposal_text = proposal.get("proposal_text") or ""
    payload = {"proposal_text": proposal_text, "signal": signal}

    try:
        raw = llm.chat_json(
            PROPOSAL_FOLLOWUP_SYSTEM,
            _stringify(payload),
            agent="agent_26_proposal_followup",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 26] proposal {proposal_id} ({company}) → follow-up draft failed: {exc}")
        return {"status": "failed", "proposal_id": proposal_id, "error": str(exc)}

    followup_text = str(raw.get("followup_text") or "").strip()
    if not followup_text:
        print(f"  [Agent 26] proposal {proposal_id} ({company}) → LLM returned empty follow-up")
        return {"status": "failed", "proposal_id": proposal_id, "error": "empty follow-up"}

    supabase.update_deal_proposal(
        proposal_id,
        draft_followup_text=followup_text,
        followup_status="drafted",
        followup_count=followup_count + 1,
        last_followup_at=_now_iso(),
    )
    print(f"  [Agent 26] proposal {proposal_id} ({company}) → {signal} follow-up drafted, awaiting review")
    return {"status": "drafted", "proposal_id": proposal_id, "signal": signal}


def _determine_signal(proposal: dict) -> str | None:
    """Which follow-up rule (if any) applies right now. Only ever fires once
    per signal — a proposal already followed up on isn't re-triggered by the
    same still-true condition next run."""
    if (proposal.get("followup_count") or 0) > 0:
        # Keep v1 simple and conservative: only ever draft ONE automatic
        # follow-up per proposal. Whether/when to draft a 2nd or 3rd (up to
        # the PDF's max of 3) is left to a human decision in the CRM rather
        # than this agent re-triggering on the same signal repeatedly.
        return None

    open_count = proposal.get("open_count") or 0
    if open_count >= _HIGH_INTENT_OPEN_COUNT:
        return "high_intent"

    if proposal.get("opened_at"):
        return None  # opened once, not enough opens for high-intent, not a "never opened" case either

    sent_at = _parse_dt(proposal.get("sent_at"))
    if sent_at is None:
        return None
    hours_since_sent = (datetime.now(timezone.utc) - sent_at).total_seconds() / 3600
    if hours_since_sent >= _NOT_OPENED_HOURS_THRESHOLD:
        return "not_opened"
    return None


def _parse_dt(value: object) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stringify(payload: dict) -> str:
    return json.dumps(payload, default=str)
