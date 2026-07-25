"""Agent 32 — CRM Sync (PDF Phase 6 — MANAGE & REPORT).

"Automatically logs every touchpoint — every message sent, reply received,
meeting held, and deal stage change — into the CRM in real time. Ensures the
data is always complete and trustworthy."

Honest scope, not the PDF's full spec — most of what this agent describes is
already happening as a side effect of other agents writing directly to the
CRM's own tables:
- "Every outreach touchpoint logged within 1 hour" — Agent 14 writes
  outreach_log at send time. Already real-time by construction.
- "Every reply logged with classification attached" — Agent 16 writes
  outreach_replies with classification set. Already real-time.
- "Deal stage must update automatically based on milestone triggers" —
  Agent 24 sets deals.status from the qualification score at the moment a
  reply is qualified. Already real-time.
- "Meeting notes attached within 24 hours" — no Meeting Booking agent exists
  yet (22/23 blocked on a calendar vendor decision), so there's nothing to
  sync here. Not built, not faked.

What's genuinely missing, and what this agent actually does: a data-hygiene
AUDIT — surfacing exactly the problems the PDF's own business rules call out
(duplicate contacts, contacts needing verification, deals gone quiet) so a
human can fix them. It deliberately does NOT act on what it finds:
- Duplicates are FLAGGED, never auto-merged. The PDF says "must be flagged
  and merged," but auto-merging real CRM records is exactly the kind of
  destructive, hard-to-undo action this whole session's human-review-first
  pattern exists to avoid — a wrong auto-merge is much worse than a flag
  sitting unresolved for a day.
- "Data must never be deleted — only archived with a reason" is a policy
  about what the CODEBASE must never do, not something this agent needs to
  monitor for — no code path anywhere in this system issues a DELETE against
  CRM tables, so there's nothing to detect. Documented, not built as an
  unrequested audit system for an action that doesn't happen.

Pure Python, no LLM — this is set-comparison and date arithmetic against
real CRM rows, same "the LLM never touches a number/fact it doesn't need to"
principle as Agents 33/34/35/36.
"""
from datetime import datetime, timedelta, timezone

from gtm_backend.phase3.connectors import supabase

_STALE_DAYS = 14  # PDF's own success metric: "Zero deals with no activity in the last 14 days"


def run_crm_sync() -> dict:
    """Audit the CRM for duplicate contacts, stale deals, and unverifiable
    contacts. Flags each for human review; never merges, deletes, or edits a
    CRM record itself."""
    bar = "═" * 72
    print(f"\n{bar}")
    print("  AGENT 32 — CRM Sync (data hygiene audit)")
    print(bar)

    leads = supabase.get_all_crm_leads()
    deals = supabase.get_all_deals()
    print(f"  → {len(leads)} CRM lead(s), {len(deals)} CRM deal(s) examined")

    dup_count = _flag_duplicate_contacts(leads)
    invalid_count = _flag_invalid_contacts(leads)
    stale_count = _flag_stale_deals(deals)

    print(
        f"  ✓ Agent 32 complete: {dup_count} duplicate-contact group(s) · "
        f"{invalid_count} unverifiable contact(s) · {stale_count} stale deal(s) flagged"
    )
    return {
        "leads_examined": len(leads),
        "deals_examined": len(deals),
        "duplicate_contact_groups_flagged": dup_count,
        "invalid_contacts_flagged": invalid_count,
        "stale_deals_flagged": stale_count,
    }


def _flag_duplicate_contacts(leads: list[dict]) -> int:
    """Group leads by normalized email; any group with 2+ members is a
    duplicate-contact flag. Never merges — just names the group."""
    by_email: dict[str, list[dict]] = {}
    for lead in leads:
        email = (lead.get("email") or "").strip().lower()
        if not email:
            continue
        by_email.setdefault(email, []).append(lead)

    flagged = 0
    for email, group in by_email.items():
        if len(group) < 2:
            continue
        lead_ids = sorted(str(l.get("id")) for l in group)
        dedupe_key = "|".join(lead_ids)
        details = f"{len(group)} CRM lead records share the email {email!r}: ids {', '.join(lead_ids)}."
        supabase.upsert_crm_sync_flag(
            flag_type="duplicate_contact",
            dedupe_key=dedupe_key,
            related_lead_ids=lead_ids,
            details=details,
            detected_at=_now_iso(),
        )
        flagged += 1
        print(f"  [Agent 32] duplicate_contact → {details}")
    return flagged


def _flag_invalid_contacts(leads: list[dict]) -> int:
    """Flag leads with a missing or structurally malformed email — the PDF
    rule 'contact details must be verified before being entered into the
    CRM,' applied after the fact as a cleanup pass since this agent doesn't
    sit in the entry path itself."""
    flagged = 0
    for lead in leads:
        email = (lead.get("email") or "").strip()
        if _is_valid_email(email):
            continue
        lead_id = lead.get("id")
        reason = "missing email" if not email else f"malformed email: {email!r}"
        details = f"CRM lead {lead_id} ({lead.get('company_name') or '?'}) has {reason}."
        supabase.upsert_crm_sync_flag(
            flag_type="invalid_contact",
            dedupe_key=str(lead_id),
            crm_lead_id=lead_id,
            details=details,
            detected_at=_now_iso(),
        )
        flagged += 1
        print(f"  [Agent 32] invalid_contact → {details}")
    return flagged


def _flag_stale_deals(deals: list[dict]) -> int:
    """Flag active (non-closed) deals with no activity in _STALE_DAYS — the
    PDF's own success metric verbatim: 'zero deals with no activity logged in
    the last 14 days.' Distinct from Agent 33's at_risk/stuck classification
    (7d/21d, paired with a next-best-action) — this is a data-hygiene flag
    for ops, not a sales-motion recommendation."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=_STALE_DAYS)
    flagged = 0
    for deal in deals:
        status = (deal.get("status") or "").lower()
        if status in {"won", "lost", "closed_won", "closed_lost"}:
            continue
        last_activity = _parse_dt(deal.get("last_activity_at") or deal.get("updated_at") or deal.get("created_at"))
        if last_activity is not None and last_activity >= cutoff:
            continue
        deal_id = deal.get("id")
        days = (datetime.now(timezone.utc) - last_activity).days if last_activity else None
        days_label = f"{days} days" if days is not None else "unknown — no activity timestamp at all"
        details = f"Deal {deal_id} ({deal.get('title') or '?'}) has had no logged activity in {days_label}."
        supabase.upsert_crm_sync_flag(
            flag_type="stale_deal",
            dedupe_key=str(deal_id),
            deal_id=deal_id,
            details=details,
            detected_at=_now_iso(),
        )
        flagged += 1
        print(f"  [Agent 32] stale_deal → {details}")
    return flagged


def _is_valid_email(email: str) -> bool:
    """Deliberately simple structural check (not a full RFC validator, not a
    deliverability check) — enough to catch obviously bad data (empty,
    missing '@', missing domain) without a false-positive-prone regex."""
    if not email or "@" not in email:
        return False
    local, _, domain = email.partition("@")
    return bool(local.strip()) and "." in domain and not domain.startswith(".")


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
