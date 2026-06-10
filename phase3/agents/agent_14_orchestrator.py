"""Agent 14 — Email Outreach Orchestrator.

Outreach is EMAIL-ONLY: this organization does not use LinkedIn, phone, or any
other channel. For every ICP that has leads with a ready sequence, channel plan,
and verified email, create ONE Instantly campaign per ICP, add the eligible
leads to it, activate the campaign, and write one outreach_log row per
attempt.

Business rules implemented (from AI-GTM-Agency-Business-Architecture-A4.pdf):
- Email-only — any lead whose channel plan is not email is logged as skipped
  with reason (defensive; Agent 13 already forces every plan to email).
- Verified-email gate — leads with bounce_status in {no_mx, invalid,
  bounced} are skipped.
- Dry-run safe — no Instantly API call is made when dry_run=True OR
  INSTANTLY_API_KEY is not configured.
- Every attempt is logged: sent | failed | dry_run | skipped.
"""
import random
import time
from datetime import date, datetime, timezone as _utc
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Outreach now sends through the official OAuth mailbox (the one connected in
# the CRM), not a personal SMTP app password. Aliased as `gmail_smtp` so the
# existing call sites + tests that patch `…gmail_smtp.*` keep working.
from phase3.connectors import gmail_oauth as gmail_smtp
from phase3.connectors import instantly
from phase3.connectors import supabase
from phase3.core import email_render
from phase3.core.config import get_settings
from phase3.core.schemas import OutreachLogEntry


_SKIP_BOUNCE_STATUSES = {"no_mx", "invalid", "bounced"}
_SUPPORTED_PRIMARY_CHANNEL = "email"


def run_orchestration(
    icp_id: int | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    campaign_id: str | None = None,
) -> dict:
    """Create an Instantly campaign per ICP, add leads, activate, and log.

    When `campaign_id` is provided (e.g. a CRM-supplied campaign), every
    outreach_log row written for this run is stamped with it instead of the
    per-ICP generated 'phase3-icp-...' name. When None, behaviour is unchanged.
    """
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(
        f"  AGENT 14 — Email Outreach Orchestrator "
        f"(ICP #{icp_id}, limit={limit_label}, dry_run={dry_run})"
    )
    print(bar)

    sequences = supabase.get_sequences(icp_id=icp_id, limit=limit)
    channel_plans = supabase.get_channel_plans(icp_id=icp_id, limit=limit)
    personalisations = supabase.get_personalisations(icp_id=icp_id, limit=limit)
    leads = supabase.get_leads_for_personalisation(icp_id=icp_id, limit=limit)
    print(
        f"  → {len(sequences)} sequence(s) · {len(channel_plans)} channel plan(s) · "
        f"{len(personalisations)} personalisation(s) · {len(leads)} lead(s)"
    )

    channel_plans_by_lead = {row["lead_id"]: row for row in channel_plans}
    leads_by_id = {row["id"]: row for row in leads}
    # Send-once guard: leads already marked 'sent' in outreach_log must not be
    # re-added to a new campaign on a later run (mirrors the gmail path).
    already_sent = supabase.get_sent_lead_ids()
    # Reply-pause guard: leads that have replied must not enter a new campaign
    # (PDF: "pause all outreach to an account the moment a reply is received").
    # Populated by Phase 4's inbox agent; empty/no-op until then.
    replied = supabase.get_replied_lead_ids()

    log_entries: list[OutreachLogEntry] = []
    eligible_by_icp: dict[int | None, list[dict]] = {}
    leads_skipped = 0

    for seq in sequences:
        lead_id = seq["lead_id"]
        lead = leads_by_id.get(lead_id)
        channel_plan = channel_plans_by_lead.get(lead_id)
        skip_entry = _check_skip(seq, lead, channel_plan)
        if skip_entry is not None:
            log_entries.append(skip_entry)
            leads_skipped += 1
            continue
        if lead_id in replied:
            log_entries.append(_skip_entry(
                lead_id, seq.get("icp_id"), seq.get("company_name") or "?",
                (lead.get("contact_email") if lead else None), "replied",
            ))
            leads_skipped += 1
            continue
        if lead_id in already_sent:
            log_entries.append(_skip_entry(
                lead_id, seq.get("icp_id"), seq.get("company_name") or "?",
                (lead.get("contact_email") if lead else None), "already_sent",
            ))
            leads_skipped += 1
            continue
        eligible_by_icp.setdefault(seq.get("icp_id"), []).append({
            "sequence": seq,
            "lead": lead,
            "channel_plan": channel_plan,
        })

    today_iso = date.today().isoformat()
    instantly_configured = instantly.is_configured()
    if not dry_run and not instantly_configured:
        print("  ⚠ INSTANTLY_API_KEY not set — falling back to dry-run mode")

    campaigns_created = 0
    leads_sent = 0
    leads_dry_run = 0
    leads_failed = 0

    for group_icp_id, items in eligible_by_icp.items():
        if not items:
            continue
        group_label = group_icp_id if group_icp_id is not None else "unassigned"
        first_steps = _normalise_steps(items[0]["sequence"].get("steps") or [])
        first_subject = _first_subject(first_steps)
        campaign_name = f"phase3-icp-{group_label}-{today_iso}"

        if dry_run or not instantly_configured:
            _print_dry_run_preview(campaign_name, items, first_steps)
            for item in items:
                if dry_run:
                    status, error = "dry_run", None
                    leads_dry_run += 1
                else:
                    status, error = "skipped", "INSTANTLY_API_KEY not set"
                    leads_skipped += 1
                log_entries.append(_build_log_entry(
                    item=item,
                    campaign_id=_resolve_campaign_id(campaign_id, None),
                    instantly_lead_id=None,
                    variant_subject=first_subject,
                    status=status,
                    error=error,
                ))
            print(
                f"  [Agent 14] ICP {group_label} → {len(items)} leads, "
                f"campaign=DRY_RUN"
            )
            continue

        try:
            instantly_steps = _to_instantly_sequence_steps(first_steps)
            instantly_campaign_id: str | None = instantly.create_campaign(
                name=campaign_name,
                sequence_steps=instantly_steps,
            )
        except Exception as exc:
            print(f"  [Agent 14] ICP {group_label} → create_campaign failed: {exc}")
            for item in items:
                log_entries.append(_build_log_entry(
                    item=item,
                    campaign_id=_resolve_campaign_id(campaign_id, None),
                    instantly_lead_id=None,
                    variant_subject=first_subject,
                    status="failed",
                    error=f"create_campaign: {exc}",
                ))
                leads_failed += 1
            print(
                f"  [Agent 14] ICP {group_label} → {len(items)} leads, "
                f"campaign=FAILED"
            )
            continue

        payloads = [_to_instantly_lead_payload(item["lead"]) for item in items]
        instantly_lead_ids: list[str]
        add_leads_error: str | None = None
        try:
            instantly_lead_ids = instantly.add_leads_to_campaign(instantly_campaign_id, payloads)
        except Exception as exc:
            instantly_lead_ids = []
            add_leads_error = f"add_leads_to_campaign: {exc}"
            print(f"  [Agent 14] ICP {group_label} → add_leads failed: {exc}")

        activation_error: str | None = None
        if add_leads_error is None:
            try:
                instantly.activate_campaign(instantly_campaign_id)
            except Exception as exc:
                activation_error = f"activate_campaign: {exc}"
                print(f"  [Agent 14] ICP {group_label} → activate failed: {exc}")

        for idx, item in enumerate(items):
            matched_id = instantly_lead_ids[idx] if idx < len(instantly_lead_ids) else None
            if add_leads_error is not None:
                status, error = "failed", add_leads_error
                leads_failed += 1
            elif activation_error is not None:
                status, error = "failed", activation_error
                leads_failed += 1
            else:
                status, error = "sent", None
                leads_sent += 1
            log_entries.append(_build_log_entry(
                item=item,
                campaign_id=_resolve_campaign_id(campaign_id, instantly_campaign_id),
                instantly_lead_id=matched_id,
                variant_subject=first_subject,
                status=status,
                error=error,
            ))

        campaigns_created += 1
        print(
            f"  [Agent 14] ICP {group_label} → {len(items)} leads, "
            f"campaign={instantly_campaign_id or 'DRY_RUN'}"
        )

    supabase.insert_outreach_log(_stamp_campaign_id(log_entries, campaign_id))

    summary = {
        "icp_id": icp_id,
        "campaigns_created": campaigns_created,
        "leads_sent": leads_sent,
        "leads_dry_run": leads_dry_run,
        "leads_skipped": leads_skipped,
        "leads_failed": leads_failed,
    }
    print(
        f"  ✓ Agent 14 complete: {campaigns_created} campaign(s) · "
        f"{leads_sent} sent · {leads_dry_run} dry_run · "
        f"{leads_skipped} skipped · {leads_failed} failed"
    )
    return summary


def run_gmail_orchestration(
    icp_id: int | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    now_utc: datetime | None = None,
    campaign_id: str | None = None,
) -> dict:
    """Send the intro email of each eligible lead's sequence directly via Gmail.

    A self-hosted alternative to the Instantly path (ported from the n8n
    "Email Outreach" automation). For every lead with a ready sequence, a
    channel plan picking email, and a verified address, this:

      - suppresses unsubscribed recipients (never re-emails an opt-out),
      - pauses outreach to leads that have replied (reply-pause gate),
      - skips leads that opened a message in the last 24h (no-nag guardrail),
      - honours the recipient's local send window (8am–6pm rule),
      - de-dupes against leads already marked 'sent' (no double-send),
      - enforces a per-run daily cap (domain-reputation guardrail),
      - throttles between sends with a randomised delay,
      - renders the branded HTML with an open-tracking pixel + unsubscribe link,
      - sends over Gmail SMTP and writes one outreach_log row per attempt.

    `now_utc` overrides the clock used for the send-window check (tests pass a
    fixed time; production leaves it None to use the real current time).

    `campaign_id` overrides the per-run campaign identifier stamped on every
    outreach_log row (and the tracking pixel / unsubscribe links). When the CRM
    supplies one (a first-class campaign), it is used for every lead instead of
    the generated 'gmail-icp-{id}-{date}' value. When None, behaviour is
    unchanged.

    dry_run=True (or gmail not configured) renders + previews but never sends.
    """
    settings = get_settings()
    bar = "═" * 72
    limit_label = limit if limit is not None else "all"
    print(f"\n{bar}")
    print(
        f"  AGENT 14 — Gmail Sender "
        f"(ICP #{icp_id}, limit={limit_label}, dry_run={dry_run}, cap={settings.daily_send_cap})"
    )
    print(bar)

    sequences = supabase.get_sequences(icp_id=icp_id, limit=limit)
    channel_plans = supabase.get_channel_plans(icp_id=icp_id, limit=limit)
    leads = supabase.get_leads_for_personalisation(icp_id=icp_id, limit=limit)
    channel_plans_by_lead = {row["lead_id"]: row for row in channel_plans}
    leads_by_id = {row["id"]: row for row in leads}

    unsubscribed = supabase.get_unsubscribed_emails()
    already_sent = supabase.get_sent_lead_ids()
    replied = supabase.get_replied_lead_ids()
    recently_opened = supabase.get_recently_opened_lead_ids(within_hours=24)
    enforce_window = getattr(settings, "enforce_send_window", True)
    print(
        f"  → {len(sequences)} sequence(s) · {len(channel_plans)} channel plan(s) · "
        f"{len(leads)} lead(s) · {len(unsubscribed)} unsubscribed · "
        f"{len(already_sent)} already sent · {len(replied)} replied · "
        f"{len(recently_opened)} opened<24h"
    )

    gmail_ready = gmail_smtp.is_configured()
    if not dry_run and not gmail_ready:
        print("  ⚠ GMAIL_ADDRESS/GMAIL_APP_PASSWORD not set — falling back to dry-run mode")
    if not settings.tracking_base_url:
        print("  ⚠ TRACKING_BASE_URL not set — emails render without open/unsubscribe tracking")

    today_iso = date.today().isoformat()
    log_entries: list[OutreachLogEntry] = []
    counts = {"sent": 0, "dry_run": 0, "skipped": 0, "failed": 0}
    dispatched = 0  # eligible leads processed — drives even A/B variant split

    for seq in sequences:
        if counts["sent"] + counts["dry_run"] >= settings.daily_send_cap:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), seq.get("company_name") or "?",
                None, f"daily_send_cap={settings.daily_send_cap} reached",
            ))
            counts["skipped"] += 1
            continue

        lead = leads_by_id.get(seq["lead_id"])
        channel_plan = channel_plans_by_lead.get(seq["lead_id"])
        skip_entry = _check_skip(seq, lead, channel_plan)
        if skip_entry is not None:
            log_entries.append(skip_entry)
            counts["skipped"] += 1
            continue

        email = (lead.get("contact_email") or "").strip()
        company = seq.get("company_name") or "?"
        if email.lower() in unsubscribed:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email, "unsubscribed",
            ))
            counts["skipped"] += 1
            continue
        if seq["lead_id"] in already_sent:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email, "already_sent",
            ))
            counts["skipped"] += 1
            continue
        if seq["lead_id"] in replied:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email, "replied",
            ))
            counts["skipped"] += 1
            continue
        if seq["lead_id"] in recently_opened:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email, "opened_recently",
            ))
            counts["skipped"] += 1
            continue
        if enforce_window and not _within_send_window(channel_plan, now_utc):
            tz_name = (channel_plan or {}).get("timezone") or "UTC"
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email,
                f"outside_send_window ({tz_name})",
            ))
            counts["skipped"] += 1
            continue

        steps = _normalise_steps(seq.get("steps") or [])
        # Even A/B split: alternate the intro variant across eligible leads so
        # both subject lines get a roughly 50/50 share (PDF Agent 15 rule).
        subject, body = _pick_variant(steps, dispatched)
        if not subject or not body:
            log_entries.append(_skip_entry(
                seq["lead_id"], seq.get("icp_id"), company, email, "empty_intro_step",
            ))
            counts["skipped"] += 1
            continue
        dispatched += 1

        generated_cid = (
            f"gmail-icp-{seq.get('icp_id') if seq.get('icp_id') is not None else 'na'}-{today_iso}"
        )
        row_campaign_id = _resolve_campaign_id(campaign_id, generated_cid)
        html = email_render.render_email_html(
            body,
            lead_id=seq["lead_id"],
            email=email,
            subject=subject,
            campaign_id=row_campaign_id,
            tracking_base_url=settings.tracking_base_url,
            brand_name=settings.email_brand_name,
        )

        if dry_run or not gmail_ready:
            print(f"  [Agent 14] DRY-RUN → {company:<26} {email} · subj: {subject}")
            log_entries.append(_build_log_entry(
                item={"sequence": seq, "lead": lead, "channel_plan": channel_plan},
                campaign_id=row_campaign_id, instantly_lead_id=None,
                variant_subject=subject, status="dry_run", error=None,
            ))
            counts["dry_run"] += 1
            continue

        unsub_url = None
        if settings.tracking_base_url:
            unsub_url = email_render.unsubscribe_url(
                settings.tracking_base_url,
                lead_id=seq["lead_id"], email=email, campaign_id=row_campaign_id,
            )
        message_id: str | None = None
        thread_id: str | None = None
        try:
            result = gmail_smtp.send_html_email(
                to=email, subject=subject, html_body=html,
                from_name=settings.email_brand_name,
                list_unsubscribe_url=unsub_url,
            )
            status, error = "sent", None
            message_id = result.get("message_id")
            thread_id = result.get("thread_id")
            counts["sent"] += 1
            print(f"  [Agent 14] SENT → {company:<26} {email} · {(message_id or '')[:32]}")
        except Exception as exc:
            status, error = "failed", str(exc)
            counts["failed"] += 1
            print(f"  [Agent 14] FAILED → {company:<26} {email} · {exc}")
        log_entries.append(_build_log_entry(
            item={"sequence": seq, "lead": lead, "channel_plan": channel_plan},
            campaign_id=row_campaign_id, instantly_lead_id=None,
            variant_subject=subject, status=status, error=error,
            message_id=message_id, thread_id=thread_id,
        ))

        _throttle(settings)

    supabase.insert_outreach_log(_stamp_campaign_id(log_entries, campaign_id))
    summary = {
        "icp_id": icp_id,
        "sender": "gmail",
        "leads_sent": counts["sent"],
        "leads_dry_run": counts["dry_run"],
        "leads_skipped": counts["skipped"],
        "leads_failed": counts["failed"],
    }
    print(
        f"  ✓ Agent 14 (gmail) complete: {counts['sent']} sent · "
        f"{counts['dry_run']} dry_run · {counts['skipped']} skipped · {counts['failed']} failed"
    )
    return summary


def _pick_variant(steps: list[dict], index: int) -> tuple[str | None, str | None]:
    """Return (subject, body) of the intro step's variant for an even A/B split.

    `index` is the running count of eligible leads; index % n_variants selects
    the variant so two-variant intros alternate ~50/50 across the batch.
    """
    if not steps:
        return None, None
    variants = steps[0].get("variants") or []
    if not variants:
        return None, None
    chosen = variants[index % len(variants)]
    subject = str(chosen.get("subject") or "") or None
    body = str(chosen.get("body") or "") or None
    return subject, body


def _within_send_window(channel_plan: dict | None, now_utc: datetime | None = None) -> bool:
    """True if the recipient's local time falls inside the plan's send window.

    Reads send_window_start_hour/end_hour (24h, recipient-local) and timezone
    from the channel plan. Defaults to True (don't block) when the window or
    timezone is missing or unparseable, so bad data never silently halts sends.
    """
    if not channel_plan:
        return True
    start = channel_plan.get("send_window_start_hour")
    end = channel_plan.get("send_window_end_hour")
    if start is None or end is None:
        return True
    tz_name = str(channel_plan.get("timezone") or "UTC")
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")
    now = now_utc or datetime.now(_utc.utc)
    local_hour = now.astimezone(tz).hour
    try:
        return int(start) <= local_hour < int(end)
    except (TypeError, ValueError):
        return True


def _throttle(settings) -> None:
    """Sleep a randomised inter-send delay to protect sender reputation."""
    lo = max(0.0, settings.send_throttle_min_seconds)
    hi = max(lo, settings.send_throttle_max_seconds)
    if hi <= 0:
        return
    time.sleep(random.uniform(lo, hi))


def _check_skip(
    seq: dict,
    lead: dict | None,
    channel_plan: dict | None,
) -> OutreachLogEntry | None:
    """Return a skip log entry if this lead is ineligible, else None."""
    lead_id = seq["lead_id"]
    icp_id = seq.get("icp_id")
    company_name = seq.get("company_name") or "?"

    if channel_plan is None:
        return _skip_entry(lead_id, icp_id, company_name, None, "no_channel_plan")
    if lead is None:
        return _skip_entry(lead_id, icp_id, company_name, None, "lead_not_found")
    # Completeness gate ("no blanks" rule): never email a lead whose identity
    # fields are blank — a missing name/company renders an obviously broken,
    # templated message. Applies to both the Instantly and Gmail paths.
    missing = [
        field
        for field in ("contact_email", "contact_name", "company_name")
        if not str(lead.get(field) or "").strip()
    ]
    if missing:
        return _skip_entry(
            lead_id, icp_id, company_name,
            str(lead.get("contact_email") or "").strip() or None,
            "missing:" + ",".join(missing),
        )
    contact_email = lead.get("contact_email")
    primary_channel = channel_plan.get("primary_channel")
    if primary_channel != _SUPPORTED_PRIMARY_CHANNEL:
        return _skip_entry(
            lead_id, icp_id, company_name, contact_email,
            f"primary_channel={primary_channel} (phase 3 supports email only)",
        )
    bounce_status = (lead.get("bounce_status") or "").strip().lower()
    if bounce_status in _SKIP_BOUNCE_STATUSES:
        return _skip_entry(
            lead_id, icp_id, company_name, contact_email,
            f"bounce_status={bounce_status}",
        )
    return None


def _resolve_campaign_id(
    override: str | None, generated: str | None
) -> str | None:
    """Pick the campaign_id to stamp on a log row / tracking link.

    `override` is the CRM-supplied campaign_id (a first-class campaign). When
    present it wins for the whole run; otherwise fall back to the agent's own
    `generated` value (the per-ICP Instantly id or 'gmail-icp-...' string),
    preserving the legacy behaviour exactly.
    """
    return override if override else generated


def _stamp_campaign_id(
    entries: list[OutreachLogEntry], campaign_id: str | None
) -> list[OutreachLogEntry]:
    """When a CRM campaign_id is supplied, stamp it onto every log row.

    Sent/failed/dry_run rows already carry the resolved campaign_id; this
    backfills the skip rows (built before the per-lead id is known) so the
    whole run is attributed to the one CRM campaign. No-op when campaign_id
    is None (legacy behaviour).
    """
    if campaign_id:
        for entry in entries:
            entry.campaign_id = campaign_id
    return entries


def _skip_entry(
    lead_id: int,
    icp_id: int | None,
    company_name: str,
    contact_email: str | None,
    reason: str,
) -> OutreachLogEntry:
    """Build a single 'skipped' outreach log entry with a human reason."""
    return OutreachLogEntry(
        lead_id=lead_id,
        icp_id=icp_id,
        company_name=company_name,
        contact_email=contact_email,
        status="skipped",
        error=reason,
    )


def _build_log_entry(
    item: dict,
    campaign_id: str | None,
    instantly_lead_id: str | None,
    variant_subject: str | None,
    status: str,
    error: str | None,
    message_id: str | None = None,
    thread_id: str | None = None,
) -> OutreachLogEntry:
    """Build one outreach_log row for a (sequence, lead) pair."""
    seq = item["sequence"]
    lead = item["lead"] or {}
    return OutreachLogEntry(
        lead_id=seq["lead_id"],
        icp_id=seq.get("icp_id"),
        company_name=seq.get("company_name") or lead.get("company_name") or "?",
        contact_email=lead.get("contact_email"),
        campaign_id=campaign_id,
        instantly_lead_id=instantly_lead_id,
        channel="email",
        step_number=1,
        variant_subject=variant_subject,
        status=status,
        error=error,
        message_id=message_id,
        thread_id=thread_id,
    )


def _normalise_steps(steps: list[object]) -> list[dict]:
    """Coerce Agent 12 step dicts into a uniform shape with str/int fields."""
    out: list[dict] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        variants_in = step.get("variants") or []
        variants_out: list[dict] = []
        for variant in variants_in:
            if not isinstance(variant, dict):
                continue
            variants_out.append({
                "subject": str(variant.get("subject") or ""),
                "body": str(variant.get("body") or ""),
            })
        out.append({
            "step_number": int(step.get("step_number") or 1),
            "step_type": str(step.get("step_type") or "follow_up"),
            "delay_days": int(step.get("delay_days") or 0),
            "variants": variants_out,
        })
    return out


def _to_instantly_sequence_steps(steps: list[dict]) -> list[dict]:
    """Convert step dicts into Instantly v2's sequence_steps payload shape."""
    return [
        {
            "type": "email",
            "delay": step["delay_days"],
            "variants": [
                {"subject": v["subject"], "body": v["body"]} for v in step["variants"]
            ],
        }
        for step in steps
    ]


def _to_instantly_lead_payload(lead: dict | None) -> dict:
    """Convert one lead row into the per-lead payload Instantly expects."""
    lead = lead or {}
    contact_name = (lead.get("contact_name") or "").strip()
    parts = contact_name.split()
    first_name = parts[0] if parts else ""
    last_name = " ".join(parts[1:]) if len(parts) > 1 else ""
    return {
        "email": lead.get("contact_email") or "",
        "first_name": first_name,
        "last_name": last_name,
        "company_name": lead.get("company_name") or "",
    }


def _first_subject(steps: list[dict]) -> str | None:
    """Return the first variant subject of the first step, if available."""
    if not steps:
        return None
    variants = steps[0].get("variants") or []
    if not variants:
        return None
    subject = variants[0].get("subject")
    return str(subject) if subject else None


def _print_dry_run_preview(
    campaign_name: str,
    items: list[dict],
    steps: list[dict],
) -> None:
    """Print a brief dry-run preview: campaign name, lead count, first email."""
    first_subject = _first_subject(steps) or "(empty)"
    first_body = ""
    if steps and steps[0].get("variants"):
        body = steps[0]["variants"][0].get("body") or ""
        first_body = body.replace("\n", " ")[:160]
    print(f"  [Agent 14] DRY-RUN preview · campaign='{campaign_name}' · leads={len(items)}")
    print(f"             first subject: {first_subject}")
    if first_body:
        print(f"             first body:    {first_body}…")
