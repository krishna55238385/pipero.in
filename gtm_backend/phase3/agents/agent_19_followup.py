"""Agent 19 — Follow-up Sequencing (PDF Phase 4 — ENGAGE).

Agent 14 only ever sends the FIRST step of a lead's Agent 12 sequence. This
agent is what actually delivers steps 2..N later, each fired only once its
`delay_days` has elapsed since the previous step was sent — so a lead who
doesn't reply to the intro still gets the rest of the cadence instead of
being forgotten (PDF Agent 19 mandate: "Manages the complete follow-up
cadence so no lead is ever forgotten").

Lives inside the phase3 package (not a separate phase4 module) because it
reads/writes the exact same tables Agent 14 already owns
(outreach_sequences, outreach_log, outreach_replies, outreach_unsubscribes)
and reuses its skip/send-window/render helpers — there is no new schema.

Business rules implemented:
- Only advances leads Agent 14 has already started (a step-1 'sent' or
  'dry_run' row must exist) — this agent never originates a thread.
- A step fires once `delay_days` (from Agent 12's step definition) have
  elapsed since the PREVIOUS step's outreach_log row was written.
- Replied / unsubscribed / bounced / missing-field leads are never advanced
  (same gates as Agent 14's gmail path).
- Once every step in the sequence has a log row, the lead is complete and is
  skipped on every subsequent run ('sequence_complete').
- dry_run=True (or Gmail not configured) previews but never sends, matching
  Agent 14's behaviour exactly.
"""
from datetime import datetime, timezone as _utc

from gtm_backend.phase3.agents.agent_14_orchestrator import (
    _check_skip,
    _normalise_steps,
    _resolve_campaign_id,
    _throttle,
    _within_send_window,
)
from gtm_backend.phase3.connectors import gmail_oauth as gmail_smtp
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core import email_render
from gtm_backend.phase3.core.config import get_settings
from gtm_backend.phase3.core.schemas import OutreachLogEntry

# Only these statuses count as a real, delivered touch when figuring out
# what step a lead is currently on — 'skipped'/'failed' rows are noise from
# a prior run and must not advance or stall the cadence.
_DELIVERED_STATUSES = {"sent", "dry_run"}


def run_followups(
    icp_id: int | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    now_utc: datetime | None = None,
) -> dict:
    """Advance every eligible lead to the next due step of its sequence."""
    settings = get_settings()
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(f"  AGENT 19 — Follow-up Sequencing (ICP #{icp_id}, limit={limit_label}, dry_run={dry_run})")
    print(bar)

    sequences = supabase.get_sequences(icp_id=icp_id, limit=limit)
    channel_plans = supabase.get_channel_plans(icp_id=icp_id, limit=limit)
    leads = supabase.get_leads_for_personalisation(icp_id=icp_id, limit=limit)
    channel_plans_by_lead = {row["lead_id"]: row for row in channel_plans}
    leads_by_id = {row["id"]: row for row in leads}

    lead_ids = {seq["lead_id"] for seq in sequences}
    history_by_lead = _delivered_history_by_lead(lead_ids)
    unsubscribed = supabase.get_unsubscribed_emails()
    replied = supabase.get_replied_lead_ids()

    print(
        f"  → {len(sequences)} sequence(s) · {len(history_by_lead)} lead(s) with prior sends · "
        f"{len(replied)} replied · {len(unsubscribed)} unsubscribed"
    )

    now = now_utc or datetime.now(_utc.utc)
    log_entries: list[OutreachLogEntry] = []
    counts = {"sent": 0, "dry_run": 0, "skipped": 0, "failed": 0}
    gmail_ready = gmail_smtp.is_configured()
    if not dry_run and not gmail_ready:
        print("  ⚠ GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set — falling back to dry-run mode")

    for seq in sequences:
        lead_id = seq["lead_id"]
        company = seq.get("company_name") or "?"
        history = history_by_lead.get(lead_id)

        if not history:
            # Agent 14 hasn't sent step 1 yet — nothing for this agent to advance.
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, None, "no_prior_send"))
            counts["skipped"] += 1
            continue

        steps = _normalise_steps(seq.get("steps") or [])
        last_step_number, last_sent_at = history
        next_step_number = last_step_number + 1
        next_step = next((s for s in steps if s["step_number"] == next_step_number), None)

        if next_step is None:
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, None, "sequence_complete"))
            counts["skipped"] += 1
            continue

        lead = leads_by_id.get(lead_id)
        channel_plan = channel_plans_by_lead.get(lead_id)
        skip_entry = _check_skip(seq, lead, channel_plan)
        if skip_entry is not None:
            log_entries.append(skip_entry)
            counts["skipped"] += 1
            continue

        email = (lead.get("contact_email") or "").strip()
        if email.lower() in unsubscribed:
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, email, "unsubscribed"))
            counts["skipped"] += 1
            continue
        if lead_id in replied:
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, email, "replied"))
            counts["skipped"] += 1
            continue

        elapsed_days = (now - last_sent_at).total_seconds() / 86400
        delay_days = next_step["delay_days"]
        if elapsed_days < delay_days:
            log_entries.append(_skip(
                lead_id, seq.get("icp_id"), company, email,
                f"not_due_yet ({elapsed_days:.1f}/{delay_days}d)",
            ))
            counts["skipped"] += 1
            continue

        enforce_window = getattr(settings, "enforce_send_window", True)
        if enforce_window and not _within_send_window(channel_plan, now_utc):
            tz_name = (channel_plan or {}).get("timezone") or "UTC"
            log_entries.append(_skip(
                lead_id, seq.get("icp_id"), company, email, f"outside_send_window ({tz_name})",
            ))
            counts["skipped"] += 1
            continue

        variants = next_step.get("variants") or []
        if not variants:
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, email, "empty_step_variants"))
            counts["skipped"] += 1
            continue
        subject = str(variants[0].get("subject") or "") or None
        body = str(variants[0].get("body") or "") or None
        if not subject or not body:
            log_entries.append(_skip(lead_id, seq.get("icp_id"), company, email, "empty_step_variants"))
            counts["skipped"] += 1
            continue

        today_iso = now.date().isoformat()
        generated_cid = f"followup-icp-{seq.get('icp_id') if seq.get('icp_id') is not None else 'na'}-{today_iso}"
        row_campaign_id = _resolve_campaign_id(None, generated_cid)

        if dry_run or not gmail_ready:
            print(
                f"  [Agent 19] DRY-RUN → {company:<26} step {next_step_number} · {email} · subj: {subject}"
            )
            log_entries.append(_build_entry(
                seq, lead, next_step_number, row_campaign_id, subject, "dry_run", None,
            ))
            counts["dry_run"] += 1
            continue

        html = email_render.render_email_html(
            body,
            lead_id=lead_id,
            email=email,
            subject=subject,
            campaign_id=row_campaign_id,
            tracking_base_url=settings.tracking_base_url,
            brand_name=settings.email_brand_name,
        )
        unsub_url = None
        if settings.tracking_base_url:
            unsub_url = email_render.unsubscribe_url(
                settings.tracking_base_url, lead_id=lead_id, email=email, campaign_id=row_campaign_id,
            )
        message_id: str | None = None
        thread_id: str | None = None
        try:
            result = gmail_smtp.send_html_email(
                to=email, subject=subject, html_body=html,
                from_name=settings.email_brand_name, list_unsubscribe_url=unsub_url,
            )
            status, error = "sent", None
            message_id = result.get("message_id")
            thread_id = result.get("thread_id")
            counts["sent"] += 1
            print(f"  [Agent 19] SENT → {company:<26} step {next_step_number} · {email}")
        except Exception as exc:
            status, error = "failed", str(exc)
            counts["failed"] += 1
            print(f"  [Agent 19] FAILED → {company:<26} step {next_step_number} · {exc}")

        log_entries.append(_build_entry(
            seq, lead, next_step_number, row_campaign_id, subject, status, error,
            message_id=message_id, thread_id=thread_id,
        ))
        _throttle(settings)

    supabase.insert_outreach_log(log_entries)
    summary = {
        "icp_id": icp_id,
        "leads_sent": counts["sent"],
        "leads_dry_run": counts["dry_run"],
        "leads_skipped": counts["skipped"],
        "leads_failed": counts["failed"],
    }
    print(
        f"  ✓ Agent 19 complete: {counts['sent']} sent · {counts['dry_run']} dry_run · "
        f"{counts['skipped']} skipped · {counts['failed']} failed"
    )
    return summary


def _delivered_history_by_lead(lead_ids: set[int]) -> dict[int, tuple[int, datetime]]:
    """Map lead_id -> (highest delivered step_number, that row's created_at).

    Only 'sent'/'dry_run' rows count as delivered. `created_at` is used as the
    cadence anchor (not `sent_at`, which the dry_run path never sets) so this
    works identically whether Agent 14 ran for real or in preview mode.
    """
    rows = supabase.get_outreach_log()
    best: dict[int, tuple[int, datetime]] = {}
    for row in rows:
        lead_id = row.get("lead_id")
        if lead_id not in lead_ids or row.get("status") not in _DELIVERED_STATUSES:
            continue
        step_number = int(row.get("step_number") or 1)
        created_at = _parse_ts(row.get("created_at"))
        if created_at is None:
            continue
        current = best.get(lead_id)
        if current is None or step_number > current[0]:
            best[lead_id] = (step_number, created_at)
    return best


def _parse_ts(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=_utc.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=_utc.utc)
        except ValueError:
            return None
    return None


def _skip(
    lead_id: int, icp_id: int | None, company_name: str, contact_email: str | None, reason: str,
) -> OutreachLogEntry:
    return OutreachLogEntry(
        lead_id=lead_id, icp_id=icp_id, company_name=company_name,
        contact_email=contact_email, status="skipped", error=reason,
    )


def _build_entry(
    seq: dict,
    lead: dict | None,
    step_number: int,
    campaign_id: str | None,
    subject: str | None,
    status: str,
    error: str | None,
    message_id: str | None = None,
    thread_id: str | None = None,
) -> OutreachLogEntry:
    lead = lead or {}
    return OutreachLogEntry(
        lead_id=seq["lead_id"],
        icp_id=seq.get("icp_id"),
        company_name=seq.get("company_name") or lead.get("company_name") or "?",
        contact_email=lead.get("contact_email"),
        campaign_id=campaign_id,
        channel="email",
        step_number=step_number,
        variant_subject=subject,
        status=status,
        error=error,
        message_id=message_id,
        thread_id=thread_id,
    )
