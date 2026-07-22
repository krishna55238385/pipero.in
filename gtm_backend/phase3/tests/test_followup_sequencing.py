"""Tests for Agent 19 — Follow-up Sequencing.

All external IO is mocked: smtplib never connects, supabase reads/writes are
patched. Mirrors the test style of test_gmail_outreach.py (Agent 14).
"""
from __future__ import annotations

import contextlib
import types
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_19_followup import run_followups

_MOD = "gtm_backend.phase3.agents.agent_19_followup"


def _settings(**over):
    base = dict(
        daily_send_cap=50, tracking_base_url=None, email_brand_name="AI Tech",
        send_throttle_min_seconds=0.0, send_throttle_max_seconds=0.0,
        gmail_address=None, gmail_app_password=None,
        enforce_send_window=False,
    )
    base.update(over)
    return types.SimpleNamespace(**base)


def _log_row(lead_id, step_number, status, created_at):
    return {
        "lead_id": lead_id,
        "step_number": step_number,
        "status": status,
        "created_at": created_at.isoformat(),
    }


@contextlib.contextmanager
def _patch_reads(seq_rows, chan_rows, leads, log_rows, unsub=None, replied=None):
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch(f"{_MOD}.supabase.get_sequences", return_value=seq_rows))
        stack.enter_context(patch(f"{_MOD}.supabase.get_channel_plans", return_value=chan_rows))
        stack.enter_context(patch(f"{_MOD}.supabase.get_leads_for_personalisation", return_value=leads))
        stack.enter_context(patch(f"{_MOD}.supabase.get_outreach_log", return_value=log_rows))
        stack.enter_context(patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=set(unsub or [])))
        stack.enter_context(patch(f"{_MOD}.supabase.get_replied_lead_ids", return_value=set(replied or [])))
        yield


def test_no_prior_send_is_skipped(sample_lead, sample_sequence_row, sample_channel_plan_row):
    """A lead Agent 14 hasn't touched yet is left alone (this agent never originates)."""
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead], []), patch(
        f"{_MOD}.supabase.insert_outreach_log",
    ) as log_mock, patch(f"{_MOD}.get_settings", return_value=_settings()):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    entries = log_mock.call_args[0][0]
    assert entries[0].error == "no_prior_send"


def test_advances_to_step_2_once_due(sample_lead, sample_sequence_row, sample_channel_plan_row):
    """Step 1 sent 3 days ago (delay_days=3 for step 2) → step 2 fires now."""
    step1_sent = datetime.now(timezone.utc) - timedelta(days=3, hours=1)
    log_rows = [_log_row(1, 1, "sent", step1_sent)]
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows), patch(
        f"{_MOD}.supabase.insert_outreach_log",
    ) as log_mock, patch(f"{_MOD}.get_settings", return_value=_settings()), patch(
        f"{_MOD}.gmail_smtp.send_html_email", side_effect=AssertionError("must not send in dry-run"),
    ):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_dry_run"] == 1
    entries = log_mock.call_args[0][0]
    assert entries[0].status == "dry_run"
    assert entries[0].step_number == 2
    assert entries[0].variant_subject == "Quick thought on velocity"


def test_not_due_yet_is_skipped(sample_lead, sample_sequence_row, sample_channel_plan_row):
    """Step 1 sent only 1 day ago (< 3d delay for step 2) → not advanced yet."""
    step1_sent = datetime.now(timezone.utc) - timedelta(days=1)
    log_rows = [_log_row(1, 1, "sent", step1_sent)]
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows), patch(
        f"{_MOD}.supabase.insert_outreach_log",
    ) as log_mock, patch(f"{_MOD}.get_settings", return_value=_settings()):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    entries = log_mock.call_args[0][0]
    assert "not_due_yet" in entries[0].error


def test_sequence_complete_is_skipped(sample_lead, sample_sequence_row, sample_channel_plan_row):
    """Every step (1..5) already has a delivered row → nothing left to send."""
    base = datetime.now(timezone.utc) - timedelta(days=30)
    log_rows = [_log_row(1, n, "sent", base + timedelta(days=n)) for n in range(1, 6)]
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows), patch(
        f"{_MOD}.supabase.insert_outreach_log",
    ) as log_mock, patch(f"{_MOD}.get_settings", return_value=_settings()):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    entries = log_mock.call_args[0][0]
    assert entries[0].error == "sequence_complete"


def test_replied_lead_is_paused(sample_lead, sample_sequence_row, sample_channel_plan_row):
    step1_sent = datetime.now(timezone.utc) - timedelta(days=10)
    log_rows = [_log_row(1, 1, "sent", step1_sent)]
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows, replied={1},
    ), patch(f"{_MOD}.supabase.insert_outreach_log") as log_mock, patch(
        f"{_MOD}.get_settings", return_value=_settings(),
    ):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    entries = log_mock.call_args[0][0]
    assert entries[0].error == "replied"


def test_unsubscribed_lead_is_suppressed(sample_lead, sample_sequence_row, sample_channel_plan_row):
    step1_sent = datetime.now(timezone.utc) - timedelta(days=10)
    log_rows = [_log_row(1, 1, "sent", step1_sent)]
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows,
        unsub={sample_lead["contact_email"].lower()},
    ), patch(f"{_MOD}.supabase.insert_outreach_log") as log_mock, patch(
        f"{_MOD}.get_settings", return_value=_settings(),
    ):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    entries = log_mock.call_args[0][0]
    assert entries[0].error == "unsubscribed"


def test_skipped_and_failed_log_rows_do_not_count_as_delivered(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A stray 'skipped'/'failed' row for step 2 must not be mistaken for a
    delivered step 2 — the lead should still be considered on step 1 and
    advanced to step 2 for real once due."""
    step1_sent = datetime.now(timezone.utc) - timedelta(days=5)
    noise = datetime.now(timezone.utc) - timedelta(days=2)
    log_rows = [
        _log_row(1, 1, "sent", step1_sent),
        _log_row(1, 2, "failed", noise),
    ]
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead], log_rows), patch(
        f"{_MOD}.supabase.insert_outreach_log",
    ) as log_mock, patch(f"{_MOD}.get_settings", return_value=_settings()):
        summary = run_followups(icp_id=1, dry_run=True)

    assert summary["leads_dry_run"] == 1
    entries = log_mock.call_args[0][0]
    assert entries[0].step_number == 2
