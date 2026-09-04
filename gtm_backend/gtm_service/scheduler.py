"""Background scheduler for the GTM trigger service.

An asyncio loop (started from the FastAPI lifespan when SCHEDULER_ENABLED)
ticks every 60 seconds and does two things:

  1. CRM worker ping — POST {CRM_BASE_URL}/api/engage/worker with the shared
     x-worker-token so the CRM's campaign/follow-up worker drains even when no
     browser has the app open. Skipped silently when CRM_BASE_URL is unset.

  2. Daily schedules — reads enabled gtm_schedules rows; when a row's local
     time (zoneinfo) has passed run_hour:run_minute and it hasn't run today,
     it is claimed atomically (last_run_date=today, last_run_status='running')
     and the daily pipeline executes in a background thread:
       phase1: leads → enrich → signals → score   (discovery skipped when
               icp_id is null — `phase1 leads` requires an ICP)
       phase3: run-all --sender <sender> [--dry-run when auto_send is off]
     Each phase records a phase_runs row exactly like a manual trigger, and the
     combined output tail lands in gtm_schedules.last_run_log.

Every failure is logged and swallowed — the loop must never crash.
"""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from gtm_backend.gtm_service import db, ga4_ingest, runner
from gtm_backend.gtm_service.config import config

TICK_SECONDS = 60
LOG_TAIL_CHARS = 8000
_WORKER_PING_TIMEOUT = 120.0

# Tracks the UTC date on which the warmup endpoint was last pinged so it fires
# at most once per calendar day (UTC), regardless of how many ticks have passed.
_warmup_last_run_date: str = ""

# Same once-per-UTC-day guard for the GA4 website-visitor ingest.
_ga4_last_run_date: str = ""

# Reply/meeting pipelines (Task #50) run on their own ~10-minute cadence, not
# every 60s tick — matches the old EC2 crontab's `*/10 * * * *` frequency
# this replaces. Tracked as a monotonic-ish wall-clock timestamp rather than
# a UTC-date guard (unlike warmup/GA4 above) since this needs to fire many
# times a day, not once.
_REPLY_MEETING_INTERVAL_SECONDS = 10 * 60
_reply_meeting_last_run_at: float = 0.0

# Agent 37 (Data Refresh, Task #6) — once daily is enough. Its own internal
# 90-day staleness + bounce-status checks already prevent redundant
# re-verification of fresh leads; running daily just means a lead that goes
# stale/bounces gets caught promptly instead of needing someone to notice
# and trigger `refresh-data` manually. Interval-based like the reply/meeting
# tick above (not a UTC-date guard) so it survives a service restart
# mid-day without silently skipping that day's run until midnight UTC.
_DATA_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60
_data_refresh_last_run_at: float = 0.0


async def run_forever() -> None:
    """The background loop: ping the CRM worker + tick schedules every 60s."""
    print("[scheduler] started (tick every %ss)" % TICK_SECONDS)
    while True:
        try:
            await asyncio.to_thread(ping_crm_worker)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] crm worker ping crashed: {exc}")
        try:
            await asyncio.to_thread(tick_schedules)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] schedule tick crashed: {exc}")
        try:
            await asyncio.to_thread(ping_warmup_once_daily)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] warmup ping crashed: {exc}")
        try:
            await asyncio.to_thread(sync_ga4_once_daily)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] GA4 sync crashed: {exc}")
        try:
            await asyncio.to_thread(tick_reply_and_meeting_pipelines)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] reply/meeting pipeline tick crashed: {exc}")
        try:
            await asyncio.to_thread(tick_data_refresh)
        except Exception as exc:  # noqa: BLE001 - never crash the loop
            print(f"[scheduler] data refresh tick crashed: {exc}")
        await asyncio.sleep(TICK_SECONDS)


# --------------------------------------------------------------------------- #
# 1) CRM engage-worker ping
# --------------------------------------------------------------------------- #
def ping_crm_worker() -> None:
    """POST the CRM's engage worker endpoint so queued campaign emails go out."""
    base = (config.CRM_BASE_URL or "").rstrip("/")
    if not base:
        return  # CRM integration not configured — skip silently
    try:
        resp = httpx.post(
            f"{base}/api/engage/worker",
            headers={"x-worker-token": config.ENGAGE_WORKER_TOKEN},
            timeout=_WORKER_PING_TIMEOUT,
        )
        if resp.status_code >= 400:
            print(
                f"[scheduler] engage worker ping → {resp.status_code}: "
                f"{resp.text[:200]}"
            )
    except Exception as exc:  # noqa: BLE001 - log, never raise
        print(f"[scheduler] engage worker ping failed: {exc}")


# --------------------------------------------------------------------------- #
# 2) Daily warmup ping (once per UTC day)
# --------------------------------------------------------------------------- #
def ping_warmup_once_daily() -> None:
    """POST the CRM's warmup endpoint once per UTC day."""
    global _warmup_last_run_date
    today = datetime.utcnow().date().isoformat()
    if _warmup_last_run_date == today:
        return  # already ran today
    base = (config.CRM_BASE_URL or "").rstrip("/")
    if not base:
        return  # CRM integration not configured — skip silently
    try:
        resp = httpx.post(
            f"{base}/api/engage/warmup/run",
            headers={"x-worker-token": config.ENGAGE_WORKER_TOKEN},
            timeout=_WORKER_PING_TIMEOUT,
        )
        if resp.status_code >= 400:
            print(
                f"[scheduler] warmup ping → {resp.status_code}: "
                f"{resp.text[:200]}"
            )
        else:
            _warmup_last_run_date = today
            print(f"[scheduler] warmup ping succeeded for {today}")
    except Exception as exc:  # noqa: BLE001 - log, never raise
        print(f"[scheduler] warmup ping failed: {exc}")


# --------------------------------------------------------------------------- #
# 3) Daily GA4 website-visitor ingest (once per UTC day)
# --------------------------------------------------------------------------- #
def sync_ga4_once_daily() -> None:
    """Ingest every connected GA4 property once per UTC day so anonymous website
    visitor signals flow in automatically — no more relying on the manual
    "Sync now" button on the CRM's Prospects → Visitors page. No-op (silent)
    when GA4 credentials aren't configured on this host."""
    global _ga4_last_run_date
    today = datetime.utcnow().date().isoformat()
    if _ga4_last_run_date == today:
        return  # already ran today
    try:
        result = ga4_ingest.sync_all()
    except ga4_ingest.GA4NotConfigured:
        # Service account not set on this host. Mark done for today so we don't
        # re-attempt (and re-log) every 60s tick; the UI "Sync now" still works.
        _ga4_last_run_date = today
        return
    except Exception as exc:  # noqa: BLE001 - log, never raise
        print(f"[scheduler] GA4 sync failed: {exc}")
        return
    _ga4_last_run_date = today
    errors = result.get("errors") or []
    print(
        f"[scheduler] GA4 sync for {today}: "
        f"{result.get('connections', 0)} connections, "
        f"{result.get('rows_written', 0)} signal rows"
        + (f", {len(errors)} errors" if errors else "")
    )


# --------------------------------------------------------------------------- #
# 4) Daily gtm_schedules
# --------------------------------------------------------------------------- #
def tick_schedules() -> None:
    """Check every enabled schedule and launch the ones that are due."""
    try:
        rows = db.get_enabled_schedules()
    except Exception as exc:  # noqa: BLE001
        print(f"[scheduler] could not read gtm_schedules: {exc}")
        return
    for row in rows:
        try:
            _maybe_run_schedule(row)
        except Exception as exc:  # noqa: BLE001 - one bad row must not stop the rest
            print(f"[scheduler] schedule {row.get('id')} dispatch failed: {exc}")


def _schedule_tz(row: dict) -> ZoneInfo:
    name = str(row.get("timezone") or "UTC")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return ZoneInfo("UTC")


def _is_due(row: dict, now_local: datetime) -> bool:
    """True when local time has passed run_hour:run_minute and not yet run today."""
    run_hour = int(row.get("run_hour") or 0)
    run_minute = int(row.get("run_minute") or 0)
    if (now_local.hour, now_local.minute) < (run_hour, run_minute):
        return False
    return str(row.get("last_run_date") or "") != now_local.date().isoformat()


def _maybe_run_schedule(row: dict) -> None:
    now_local = datetime.now(_schedule_tz(row))
    if not _is_due(row, now_local):
        return
    today = now_local.date().isoformat()
    if not db.claim_schedule(row["id"], today):
        return  # another tick/instance claimed it first
    print(f"[scheduler] schedule {row['id']} due (local {now_local:%H:%M %Z}) — running")
    threading.Thread(
        target=_run_schedule,
        args=(row,),
        daemon=True,
        name=f"gtm-schedule-{row['id']}",
    ).start()


def _run_schedule(row: dict) -> None:
    """Execute the daily pipeline for one claimed schedule row (in a thread)."""
    schedule_id = row["id"]
    icp_id = row.get("icp_id")
    leads_per_day = int(row.get("leads_per_day") or 25)
    sender = str(row.get("sender") or "gmail")
    auto_send = bool(row.get("auto_send"))
    org = row.get("organization_id") or None

    combined = ""
    status = "succeeded"
    try:
        commands = runner.build_schedule_commands(icp_id, leads_per_day, sender, auto_send)
        for phase in ("phase1", "phase3"):
            params = {
                "icp_id": icp_id,
                "limit": leads_per_day,
                "max": leads_per_day,
                "sender": sender,
                "dry_run": not auto_send,
                "schedule_id": str(schedule_id),
            }
            run_id = db.create_phase_run(
                phase=phase,
                command=runner.commands_label(commands[phase]),
                organization_id=org,
                icp_id=icp_id,
                params=params,
                triggered_by=None,
            )
            phase_status, logs = runner.run_commands(run_id, commands[phase], org)
            combined += f"\n=== {phase} ({phase_status}) — run {run_id} ===\n{logs}"
            if phase_status != "succeeded":
                status = "failed"
                break
    except Exception as exc:  # noqa: BLE001 - record, never raise out of the thread
        status = "failed"
        combined += f"\n[scheduler] error: {exc}"

    try:
        db.update_schedule(
            schedule_id,
            last_run_status=status,
            last_run_log=combined[-LOG_TAIL_CHARS:],
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[scheduler] could not record result for schedule {schedule_id}: {exc}")
    print(f"[scheduler] schedule {schedule_id} finished: {status}")


# --------------------------------------------------------------------------- #
# 5) Reply/meeting pipelines — per-org, every ~10 minutes (Task #50)
# --------------------------------------------------------------------------- #
def tick_reply_and_meeting_pipelines() -> None:
    """Run the reply-pipeline (poll-inbox → detect-objections →
    draft-replies) and meeting-pipeline (propose-meetings →
    sync-meeting-confirmations → generate-meeting-briefs → detect-no-shows)
    for every org that has a connected Gmail mailbox.

    Replaces the old EC2 crontab entries, which hardcoded GTM_ORG_ID to a
    single org (Jobraux) — fine for one client, but meant a second org's
    inbox/meetings would never be touched by anything automatic. This reuses
    the exact same org-context mechanism the daily gtm_schedules jobs above
    already use (runner.run_commands sets GTM_ORG_ID + per-org BYO API keys
    in the subprocess env), just triggered by "has a mailbox" instead of "has
    a gtm_schedules row" — a schedule config controls *lead generation*
    cadence (opt-in, since it costs SerpAPI/LLM spend to find NEW leads), but
    reply-handling and meeting-booking are working EXISTING pipeline output
    and cost far less per tick, so every connected org gets it automatically,
    no separate opt-in table needed.
    """
    global _reply_meeting_last_run_at
    now_ts = datetime.now(ZoneInfo("UTC")).timestamp()
    if now_ts - _reply_meeting_last_run_at < _REPLY_MEETING_INTERVAL_SECONDS:
        return
    _reply_meeting_last_run_at = now_ts

    try:
        org_ids = db.get_orgs_with_connected_mailbox()
    except Exception as exc:  # noqa: BLE001
        print(f"[scheduler] could not read connected mailboxes: {exc}")
        return
    if not org_ids:
        return
    print(f"[scheduler] reply/meeting pipelines due for {len(org_ids)} org(s)")
    for org_id in org_ids:
        threading.Thread(
            target=_run_reply_and_meeting_pipelines_for_org,
            args=(org_id,),
            daemon=True,
            name=f"gtm-reply-meeting-{org_id}",
        ).start()


def _run_reply_and_meeting_pipelines_for_org(org_id: str) -> None:
    for phase_label, commands in (
        ("reply-pipeline", runner.build_reply_pipeline_commands()),
        ("meeting-pipeline", runner.build_meeting_pipeline_commands()),
    ):
        run_id = db.create_phase_run(
            phase=phase_label,
            command=runner.commands_label(commands),
            organization_id=org_id,
            icp_id=None,
            params={},
            triggered_by=None,
        )
        try:
            status, _logs = runner.run_commands(run_id, commands, org_id)
        except Exception as exc:  # noqa: BLE001 - one org's failure must not affect others
            print(f"[scheduler] {phase_label} for org {org_id} crashed: {exc}")
            continue
        if status != "succeeded":
            print(f"[scheduler] {phase_label} for org {org_id} finished: {status}")


# --------------------------------------------------------------------------- #
# 6) Agent 37 — Data Refresh, per-org, once daily (Task #6)
# --------------------------------------------------------------------------- #
def tick_data_refresh() -> None:
    """Run Agent 37 (re-verify stale/bounced leads, compute data quality
    scores) for every org that has at least one lead with a contact_email.

    No separate opt-in table, same reasoning as the reply/meeting pipeline
    tick above: this works EXISTING lead data (a free disify.verify_email()
    check, no LLM/SerpAPI spend), not new lead generation, so every org with
    something to refresh gets it automatically.
    """
    global _data_refresh_last_run_at
    now_ts = datetime.now(ZoneInfo("UTC")).timestamp()
    if now_ts - _data_refresh_last_run_at < _DATA_REFRESH_INTERVAL_SECONDS:
        return
    _data_refresh_last_run_at = now_ts

    try:
        org_ids = db.get_orgs_with_leads()
    except Exception as exc:  # noqa: BLE001
        print(f"[scheduler] could not read orgs with leads: {exc}")
        return
    if not org_ids:
        return
    print(f"[scheduler] data refresh (Agent 37) due for {len(org_ids)} org(s)")
    for org_id in org_ids:
        threading.Thread(
            target=_run_data_refresh_for_org,
            args=(org_id,),
            daemon=True,
            name=f"gtm-data-refresh-{org_id}",
        ).start()


def _run_data_refresh_for_org(org_id: str) -> None:
    commands = runner.build_data_refresh_commands()
    run_id = db.create_phase_run(
        phase="data-refresh",
        command=runner.commands_label(commands),
        organization_id=org_id,
        icp_id=None,
        params={},
        triggered_by=None,
    )
    try:
        status, _logs = runner.run_commands(run_id, commands, org_id)
    except Exception as exc:  # noqa: BLE001 - one org's failure must not affect others
        print(f"[scheduler] data refresh for org {org_id} crashed: {exc}")
        return
    print(f"[scheduler] data refresh for org {org_id} finished: {status}")
