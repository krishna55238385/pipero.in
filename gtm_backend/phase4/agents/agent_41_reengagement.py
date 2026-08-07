"""Agent 41 — Re-engagement (PDF Phase 7 — RETAIN & GROW).

"Revives dormant leads and previously lost deals when conditions change."

Runs on CRM `deals` marked lost/closed_lost. One reengagement_touches row is
appended per attempt, forming the history that enforces cooldown and permanent
opt-out.

PDF rules and how each is actually handled:
- "Revive dormant leads and previously lost deals" — BUILT, scoped to lost
  deals specifically (see limitation below for the "dormant lead with no
  deal" half of this).
- "Must trigger when conditions change (buying signal, market shift, etc.)"
  — PARTIALLY BUILT, documented honestly rather than faked: the PDF's ideal
  trigger is a fresh buying signal on the account. That's not wired here —
  buying_signals (phase1) is keyed to leads_raw.id, and CRM deals/leads don't
  currently share a join key with leads_raw, so there's no reliable link
  between "this CRM deal" and "this phase1 lead's signal feed" yet. Making
  that link would need its own schema change (out of scope for this agent).
  Until it exists, "conditions changed" is operationalized as: a minimum
  cooling-off period since the deal closed (COOLDOWN_DAYS, first attempt and
  between repeat attempts), combined with a hard LLM gate that the message
  must ground itself in the deal's own history — hold rather than send a
  hollow "just checking in" if the deal notes give nothing to work with.
- "Must not repeatedly contact a lead that has ignored re-engagement" —
  BUILT via the same cooldown/next_eligible_at gate as Agent 40's nurture
  cadence, applied here at a longer interval (colder contacts).
- "Opt-out must be immediate and permanent" — BUILT by reusing the EXISTING
  outreach_unsubscribes table/gate, same mechanism Agent 14's sender and
  Agent 40's nurture already respect.
- "Re-engagement content must reference what's changed, not repeat the old
  pitch" — enforced in the prompt (REENGAGEMENT_SYSTEM): explicit instruction
  not to re-pitch the same thing, and to name the elapsed time as the reason
  now is different from before.

Draft-only, same human-review-first pattern as every other messaging agent
this session — content_text is never sent automatically.
"""
import json
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import REENGAGEMENT_SYSTEM

_COOLDOWN_DAYS = 120


def run_reengagement(limit: int | None = None) -> dict:
    """Advance the re-engagement programme for every lost deal: skip if
    unsubscribed or still within cooldown, otherwise draft a fresh outreach
    attempt if the LLM finds genuine grounds to reopen the conversation."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 41 — Re-engagement (limit={limit or 'all'})")
    print(bar)

    deals = supabase.get_closed_lost_deals(limit=limit)
    unsubscribed = supabase.get_unsubscribed_emails()
    print(f"  → {len(deals)} lost deal(s) examined")

    # Batch the per-deal contact lookup (was one get_contact_by_id call per
    # deal in the loop — same N+1 pattern already fixed elsewhere).
    contact_ids = [d.get("contact_id") for d in deals if d.get("contact_id")]
    contacts_map = supabase.get_contacts_by_ids(contact_ids)

    drafted = 0
    opted_out = 0
    not_yet_eligible = 0
    held = 0
    failed = 0

    for deal in deals:
        result = _process_deal(deal, unsubscribed, contacts_map)
        status = result["status"]
        if status == "drafted":
            drafted += 1
        elif status == "opted_out":
            opted_out += 1
        elif status == "not_yet_eligible":
            not_yet_eligible += 1
        elif status == "held":
            held += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 41 complete: {drafted} drafted · {opted_out} opted out · "
        f"{not_yet_eligible} not yet eligible (cooldown) · "
        f"{held} held (no genuine grounds) · {failed} failed"
    )
    return {
        "deals_examined": len(deals),
        "drafted": drafted,
        "opted_out": opted_out,
        "not_yet_eligible": not_yet_eligible,
        "held": held,
        "failed": failed,
    }


def _process_deal(deal: dict, unsubscribed: set[str], contacts_map: dict[str, dict] | None = None) -> dict:
    deal_id = deal.get("id")
    title = deal.get("title") or "?"
    contact_id = deal.get("contact_id")

    if deal_id is None:
        return {"status": "held", "reason": "deal has no id"}

    if contacts_map is not None:
        contact = contacts_map.get(contact_id) or {}
    else:
        contact = supabase.get_contact_by_id(contact_id) or {}
    email = (contact.get("email") or "").strip().lower()
    # contacts has no denormalized company name (only company_id, a separate
    # FK lookup this agent doesn't need for anything else) — deal title is
    # the best available label for logging/the touch record.
    company_name = title

    if email and email in unsubscribed:
        print(f"  [Agent 41] deal {deal_id} ({title}) → opted out, skipping")
        return {"status": "opted_out"}

    history = supabase.get_reengagement_touch_history(deal_id)
    latest = history[0] if history else None

    if latest and latest.get("status") == "opted_out":
        return {"status": "opted_out"}

    if latest and latest.get("next_eligible_at"):
        next_eligible = _parse_dt(latest["next_eligible_at"])
        if next_eligible and datetime.now(timezone.utc) < next_eligible:
            return {"status": "not_yet_eligible"}

    reference_date = _parse_dt(deal.get("close_date")) or _parse_dt(deal.get("last_activity_at")) or _parse_dt(deal.get("created_at"))
    if reference_date is None:
        return {"status": "held", "reason": "no close/activity date to measure cooldown against"}

    days_since = (datetime.now(timezone.utc) - reference_date).days
    if not latest and days_since < _COOLDOWN_DAYS:
        return {"status": "not_yet_eligible"}

    payload = {
        "deal_title": title,
        "deal_value": deal.get("value"),
        "deal_notes": deal.get("notes"),
        "days_since_closed": days_since,
    }

    try:
        raw = llm.chat_json(
            REENGAGEMENT_SYSTEM,
            _stringify(payload),
            agent="agent_41_reengagement",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 41] deal {deal_id} ({title}) → generation failed: {exc}")
        return {"status": "failed", "error": str(exc)}

    held_flag = bool(raw.get("held"))
    content_text = str(raw.get("content_text") or "").strip()
    trigger_reason = str(raw.get("trigger_reason") or "").strip() or None

    if held_flag or not content_text:
        reason = str(raw.get("held_reason") or "no genuine grounds to reopen this deal yet").strip()
        supabase.create_reengagement_touch(
            deal_id=deal_id,
            crm_lead_id=deal.get("lead_id"),
            company_name=company_name,
            touch_number=len(history) + 1,
            trigger_reason=trigger_reason,
            status="held",
            held_reason=reason,
            next_eligible_at=_next_eligible_iso(),
        )
        print(f"  [Agent 41] deal {deal_id} ({title}) → held: {reason}")
        return {"status": "held"}

    supabase.create_reengagement_touch(
        deal_id=deal_id,
        crm_lead_id=deal.get("lead_id"),
        company_name=company_name,
        touch_number=len(history) + 1,
        trigger_reason=trigger_reason,
        content_text=content_text,
        status="draft",
        next_eligible_at=_next_eligible_iso(),
    )
    print(f"  [Agent 41] deal {deal_id} ({title}) → drafted attempt #{len(history) + 1} ({trigger_reason})")
    return {"status": "drafted"}


def _next_eligible_iso() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=_COOLDOWN_DAYS)).isoformat()


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
