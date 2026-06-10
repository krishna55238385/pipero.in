"""Tests for the n8n-derived Gmail direct-send path (Agent 14 --sender gmail),
the email renderer, the SMTP sender, and the tracking server.

All external IO is mocked: smtplib never connects, supabase reads/writes are
patched, and the tracking server uses FastAPI's TestClient.
"""
from __future__ import annotations

import contextlib
import types
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from phase3.agents.agent_14_orchestrator import run_gmail_orchestration
from phase3.connectors import gmail_smtp
from phase3.core import email_render


# -- Email renderer ---------------------------------------------------------

def test_render_injects_pixel_and_unsubscribe():
    html = email_render.render_email_html(
        "Hi Priya, congrats on the round.",
        lead_id=7,
        email="priya@acme.com",
        subject="Post-Series A hiring",
        campaign_id="gmail-icp-1-2026-06-01",
        tracking_base_url="https://track.example.com",
        brand_name="AI Tech",
    )
    assert 'src="https://track.example.com/open?id=7' in html
    assert "campaign=gmail-icp-1-2026-06-01" in html
    assert "/unsubscribe?id=7" in html
    assert "AI Tech" in html  # brand in footer
    assert "Hi Priya, congrats on the round." in html  # body verbatim — no fabrication


def test_render_without_tracking_is_safe():
    """No public tracking server → no pixel, no broken links, still a full email."""
    html = email_render.render_email_html(
        "Hello there", lead_id=1, email="a@b.com", tracking_base_url=None,
    )
    assert "<img" not in html
    assert "/open?" not in html
    assert "Hello there" in html


def test_render_escapes_subject():
    html = email_render.render_email_html(
        "body", lead_id=1, email="a@b.com",
        subject='<script>alert(1)</script>', tracking_base_url=None,
    )
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


# -- SMTP sender ------------------------------------------------------------

def test_gmail_not_configured_by_default():
    assert gmail_smtp.is_configured() is False


def test_send_raises_when_unconfigured():
    with pytest.raises(RuntimeError, match="GMAIL_ADDRESS"):
        gmail_smtp.send_html_email("x@y.com", "subj", "<p>hi</p>")


def test_send_html_email_builds_and_sends(monkeypatch):
    """When configured, send_html_email logs in and sends one message over SSL."""
    sent = {}

    class _FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def login(self, user, pwd):
            sent["login"] = (user, pwd)

        def send_message(self, msg):
            sent["to"] = msg["To"]
            sent["subject"] = msg["Subject"]
            sent["unsub_header"] = msg.get("List-Unsubscribe")
            payloads = [p.get_content_type() for p in msg.iter_parts()]
            sent["types"] = payloads

    fake_settings = types.SimpleNamespace(
        gmail_address="bot@gmail.com", gmail_app_password="apppw16chars0000",
    )
    monkeypatch.setattr(gmail_smtp, "_settings", fake_settings)
    monkeypatch.setattr(gmail_smtp.smtplib, "SMTP_SSL", _FakeSMTP)

    result = gmail_smtp.send_html_email(
        "lead@corp.com", "A subject", "<p>Hello</p>",
        from_name="AI Tech", list_unsubscribe_url="https://t.example.com/unsubscribe?id=1",
    )
    assert result["status"] == "sent"
    assert sent["login"] == ("bot@gmail.com", "apppw16chars0000")
    assert sent["to"] == "lead@corp.com"
    assert sent["subject"] == "A subject"
    assert sent["unsub_header"] == "<https://t.example.com/unsubscribe?id=1>"
    assert "text/plain" in sent["types"] and "text/html" in sent["types"]


def test_send_wraps_smtp_failure(monkeypatch):
    class _BoomSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def login(self, *a):
            import smtplib
            raise smtplib.SMTPAuthenticationError(535, b"bad creds")

        def send_message(self, msg):
            pass

    monkeypatch.setattr(
        gmail_smtp, "_settings",
        types.SimpleNamespace(gmail_address="b@gmail.com", gmail_app_password="pw"),
    )
    monkeypatch.setattr(gmail_smtp.smtplib, "SMTP_SSL", _BoomSMTP)
    with pytest.raises(gmail_smtp.SmtpSendError):
        gmail_smtp.send_html_email("x@y.com", "s", "<p>h</p>")


# -- Agent 14 gmail orchestration -------------------------------------------

def _settings(**over):
    base = dict(
        daily_send_cap=50, tracking_base_url=None, email_brand_name="AI Tech",
        send_throttle_min_seconds=0.0, send_throttle_max_seconds=0.0,
        gmail_address=None, gmail_app_password=None,
        # Off by default so behavioural tests don't depend on the wall clock.
        # The dedicated send-window tests below flip this on and inject now_utc.
        enforce_send_window=False,
    )
    base.update(over)
    return types.SimpleNamespace(**base)


@contextlib.contextmanager
def _patch_reads(seq_rows, chan_rows, leads, unsub=None, sent=None, replied=None, opened=None):
    """Enter every supabase read the gmail orchestrator performs, with the given
    canned return values. New gates (replied, recently-opened) default to empty.
    """
    mod = "phase3.agents.agent_14_orchestrator.supabase"
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch(f"{mod}.get_sequences", return_value=seq_rows))
        stack.enter_context(patch(f"{mod}.get_channel_plans", return_value=chan_rows))
        stack.enter_context(patch(f"{mod}.get_leads_for_personalisation", return_value=leads))
        stack.enter_context(patch(f"{mod}.get_unsubscribed_emails", return_value=set(unsub or [])))
        stack.enter_context(patch(f"{mod}.get_sent_lead_ids", return_value=set(sent or [])))
        stack.enter_context(patch(f"{mod}.get_replied_lead_ids", return_value=set(replied or [])))
        stack.enter_context(
            patch(f"{mod}.get_recently_opened_lead_ids", return_value=set(opened or []))
        )
        yield


def test_gmail_dry_run_writes_dry_run_entries(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """dry_run=True renders + logs dry_run, never calls smtplib."""
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ), patch(
        "phase3.agents.agent_14_orchestrator.gmail_smtp.send_html_email",
        side_effect=AssertionError("must not send in dry-run"),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_dry_run"] == 1
    assert summary["leads_sent"] == 0
    entries = log_mock.call_args[0][0]
    assert all(e.status == "dry_run" for e in entries)
    assert entries[0].campaign_id.startswith("gmail-icp-1-")


def test_gmail_suppresses_unsubscribed(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A lead whose email is in outreach_unsubscribes is skipped, not sent."""
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead],
        unsub={sample_lead["contact_email"].lower()},
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    assert log_mock.call_args[0][0][0].error == "unsubscribed"


def test_gmail_dedupes_already_sent(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A lead already marked 'sent' is not emailed again."""
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead],
        sent={sample_lead["id"]},
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert log_mock.call_args[0][0][0].error == "already_sent"


def test_gmail_pauses_on_reply(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A lead that has replied (outreach_replies) is paused — skipped, not sent."""
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead],
        replied={sample_lead["id"]},
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    assert log_mock.call_args[0][0][0].error == "replied"


def test_gmail_skips_recently_opened(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A lead that opened a message in the last 24h is skipped (no-nag rule)."""
    with _patch_reads(
        [sample_sequence_row], [sample_channel_plan_row], [sample_lead],
        opened={sample_lead["id"]},
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    assert log_mock.call_args[0][0][0].error == "opened_recently"


def test_gmail_skips_outside_send_window(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """With enforcement on and a clock outside the recipient's local window
    (channel plan: Asia/Kolkata 09:00–17:00), the lead is skipped.

    20:00 UTC == 01:30 IST → hour 1 → outside the 9–17 window.
    """
    outside = datetime(2026, 6, 2, 20, 0, tzinfo=timezone.utc)
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings",
        return_value=_settings(enforce_send_window=True),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True, now_utc=outside)

    assert summary["leads_skipped"] == 1
    assert summary["leads_dry_run"] == 0
    assert "outside_send_window" in log_mock.call_args[0][0][0].error


def test_gmail_sends_inside_send_window(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """With enforcement on and a clock INSIDE the local window, the send proceeds.

    06:00 UTC == 11:30 IST → hour 11 → inside the 9–17 window.
    """
    inside = datetime(2026, 6, 2, 6, 0, tzinfo=timezone.utc)
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings",
        return_value=_settings(enforce_send_window=True),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True, now_utc=inside)

    assert summary["leads_dry_run"] == 1
    assert summary["leads_skipped"] == 0
    assert log_mock.call_args[0][0][0].status == "dry_run"


def test_gmail_enforces_daily_cap(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """With cap=1 and two eligible leads, only one is processed; the rest skip."""
    lead2 = dict(sample_lead, id=2, contact_email="second@acme.com")
    seq2 = dict(sample_sequence_row, lead_id=2)
    chan2 = dict(sample_channel_plan_row, lead_id=2)
    with _patch_reads(
        [sample_sequence_row, seq2], [sample_channel_plan_row, chan2], [sample_lead, lead2],
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(daily_send_cap=1),
    ):
        summary = run_gmail_orchestration(icp_id=1, dry_run=True)

    assert summary["leads_dry_run"] == 1
    assert summary["leads_skipped"] == 1
    cap_errors = [e.error for e in log_mock.call_args[0][0] if e.error and "cap" in e.error]
    assert cap_errors


def test_gmail_even_ab_split_alternates_variants(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """Two eligible leads get the two different intro subject variants (even split)."""
    lead2 = dict(sample_lead, id=2, contact_email="second@acme.com")
    seq2 = dict(sample_sequence_row, lead_id=2)
    chan2 = dict(sample_channel_plan_row, lead_id=2)
    with _patch_reads(
        [sample_sequence_row, seq2], [sample_channel_plan_row, chan2], [sample_lead, lead2],
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        run_gmail_orchestration(icp_id=1, dry_run=True)

    subjects = [e.variant_subject for e in log_mock.call_args[0][0] if e.status == "dry_run"]
    assert len(subjects) == 2
    assert subjects[0] != subjects[1], "the two leads must get different A/B variants"
    assert set(subjects) == {"Post-Series A hiring", "India-first onboarding"}


def test_gmail_campaign_id_override_stamps_every_row(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """A CRM-supplied campaign_id is stamped on the sent/dry_run rows (overriding
    the generated 'gmail-icp-...' value) AND on the skip rows for the same run.
    """
    # Two leads: one eligible (gets a dry_run row), one unsubscribed (skip row).
    lead2 = dict(sample_lead, id=2, contact_email="optout@acme.com")
    seq2 = dict(sample_sequence_row, lead_id=2)
    chan2 = dict(sample_channel_plan_row, lead_id=2)
    with _patch_reads(
        [sample_sequence_row, seq2], [sample_channel_plan_row, chan2], [sample_lead, lead2],
        unsub={"optout@acme.com"},
    ), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        run_gmail_orchestration(icp_id=1, dry_run=True, campaign_id="crm-camp-42")

    entries = log_mock.call_args[0][0]
    assert len(entries) == 2
    # EVERY row (the dry_run AND the skipped) carries the CRM campaign_id.
    assert all(e.campaign_id == "crm-camp-42" for e in entries)
    assert not any(
        (e.campaign_id or "").startswith("gmail-icp-") for e in entries
    )


def test_gmail_campaign_id_threads_into_tracking_links(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """The CRM campaign_id is used in the rendered tracking pixel + unsub link."""
    captured = {}

    def _fake_render(*args, **kwargs):
        captured["campaign_id"] = kwargs.get("campaign_id")
        return "<html>body</html>"

    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ), patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ), patch(
        "phase3.agents.agent_14_orchestrator.email_render.render_email_html",
        side_effect=_fake_render,
    ):
        run_gmail_orchestration(icp_id=1, dry_run=True, campaign_id="crm-camp-77")

    assert captured["campaign_id"] == "crm-camp-77"


def test_gmail_without_campaign_id_keeps_generated_value(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """No CRM campaign_id → unchanged legacy 'gmail-icp-...' value on the row."""
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings", return_value=_settings(),
    ):
        run_gmail_orchestration(icp_id=1, dry_run=True)

    assert log_mock.call_args[0][0][0].campaign_id.startswith("gmail-icp-1-")


def test_gmail_sends_when_configured(
    sample_lead, sample_sequence_row, sample_channel_plan_row,
):
    """dry_run=False + gmail configured → send_html_email called, status 'sent'."""
    with _patch_reads([sample_sequence_row], [sample_channel_plan_row], [sample_lead]), patch(
        "phase3.agents.agent_14_orchestrator.supabase.insert_outreach_log",
    ) as log_mock, patch(
        "phase3.agents.agent_14_orchestrator.get_settings",
        return_value=_settings(tracking_base_url="https://t.example.com"),
    ), patch(
        "phase3.agents.agent_14_orchestrator.gmail_smtp.is_configured", return_value=True,
    ), patch(
        "phase3.agents.agent_14_orchestrator.gmail_smtp.send_html_email",
        return_value={"message_id": "<abc@gmail>", "status": "sent"},
    ) as send_mock:
        summary = run_gmail_orchestration(icp_id=1, dry_run=False)

    assert summary["leads_sent"] == 1
    send_mock.assert_called_once()
    kwargs = send_mock.call_args.kwargs
    assert kwargs["to"] == sample_lead["contact_email"]
    assert "/unsubscribe?id=" in kwargs["list_unsubscribe_url"]
    assert log_mock.call_args[0][0][0].status == "sent"


# -- Tracking server --------------------------------------------------------
# The handlers are unit-tested directly (the autouse _block_real_http fixture
# refuses the httpx-based FastAPI TestClient, which is fine — we don't need the
# HTTP layer to verify handler behaviour).

def test_tracking_open_returns_pixel_and_records():
    import phase3.tracking_server as ts

    with patch.object(ts.supabase, "record_open") as rec:
        resp = ts.track_open(id=9, email="a@b.com", campaign="c1")

    assert resp.media_type == "image/gif"
    assert resp.body[:3] == b"GIF"  # 1x1 transparent gif
    rec.assert_called_once_with(lead_id=9, email="a@b.com", campaign_id="c1")


def test_tracking_open_swallows_db_errors():
    """A failing record_open must still return the pixel (never break render)."""
    import phase3.tracking_server as ts

    with patch.object(ts.supabase, "record_open", side_effect=RuntimeError("db down")):
        resp = ts.track_open(id=1, email="a@b.com", campaign="")
    assert resp.body[:3] == b"GIF"


def test_tracking_unsubscribe_records_and_confirms():
    import phase3.tracking_server as ts

    with patch.object(ts.supabase, "record_unsubscribe") as rec:
        resp = ts.unsubscribe(id=9, email="a@b.com", campaign="")

    assert "unsubscribed" in resp.body.decode().lower()
    rec.assert_called_once_with(email="a@b.com", lead_id=9, campaign_id=None)
