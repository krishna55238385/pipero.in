"""Tests for Task #5 (part 3) — bounce feedback loop.

A real hard bounce arrives asynchronously as a Delivery Status Notification
(DSN) via the inbox poller, not as a synchronous error from Agent 14's send
call (Gmail's API returns 200 even for a nonexistent mailbox). This tests the
DSN detector, the write-back that downgrades a lead's verification state,
and that the poller routes a detected bounce there instead of treating it as
an ordinary ambiguous reply.
"""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_16_inbox import (
    _extract_bounce_recipient,
    poll_and_classify_inbox,
    record_hard_bounce,
)

_MOD = "gtm_backend.phase3.agents.agent_16_inbox"

_LEAD = {"id": 1, "company_name": "Acme HR", "contact_email": "priya@acmehr.com", "icp_id": 1}


# -- _extract_bounce_recipient -----------------------------------------------

def test_detects_mailer_daemon_dsn_and_extracts_failed_recipient():
    body = (
        "Delivery to the following recipient failed permanently:\n\n"
        "     priya@acmehr.com\n\n"
        "Technical details of permanent failure: The email account that you tried to reach does not exist."
    )
    result = _extract_bounce_recipient(
        from_email="mailer-daemon@googlemail.com",
        subject="Delivery Status Notification (Failure)",
        body_text=body,
    )
    assert result == "priya@acmehr.com"


def test_detects_bounce_by_subject_even_with_different_sender_format():
    body = "Your message to raj@betaco.com couldn't be delivered."
    result = _extract_bounce_recipient(
        from_email="Mail Delivery Subsystem <mailer-daemon@mx.google.com>",
        subject="Undelivered Mail Returned to Sender",
        body_text=body,
    )
    assert result == "raj@betaco.com"


def test_ordinary_reply_is_never_treated_as_bounce():
    result = _extract_bounce_recipient(
        from_email="priya@acmehr.com",
        subject="Re: quick question",
        body_text="Thanks for reaching out, can you tell me more about pricing?",
    )
    assert result is None


def test_bounce_looking_sender_with_no_extractable_email_returns_none():
    result = _extract_bounce_recipient(
        from_email="mailer-daemon@googlemail.com",
        subject="Delivery Status Notification (Failure)",
        body_text="Your message could not be delivered.",  # no email address present
    )
    assert result is None


def test_system_address_in_body_is_excluded_from_extraction():
    """A DSN body often quotes the reporting system's OWN address (e.g. in
    forwarded headers) before the actual failed recipient — the system
    address must never be picked as the bounced email."""
    body = (
        "This message was created automatically by mail delivery software.\n"
        "A message that you sent could not be delivered.\n"
        "Reporting-MTA: dns; mailer-daemon@mx.google.com\n"
        "Final-Recipient: rfc822; sam@gammaco.com\n"
    )
    result = _extract_bounce_recipient(
        from_email="mailer-daemon@mx.google.com",
        subject="Delivery Status Notification (Failure)",
        body_text=body,
    )
    assert result == "sam@gammaco.com"


# -- record_hard_bounce ------------------------------------------------------

def test_hard_bounce_downgrades_lead_and_flags_reverification():
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.update_lead_raw") as updater:
        matched = record_hard_bounce("priya@acmehr.com")

    assert matched is True
    updater.assert_called_once_with(
        1,
        verified=False,
        bounce_status="bounced",
        email_verification_tier=None,
        needs_reverification=True,
    )


def test_hard_bounce_for_unmatched_email_is_never_guessed():
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=None), \
         patch(f"{_MOD}.supabase.update_lead_raw") as updater:
        matched = record_hard_bounce("stranger@nowhere.com")

    assert matched is False
    updater.assert_not_called()


# -- poll_and_classify_inbox routes bounces separately from replies ---------

def test_poller_routes_dsn_to_record_hard_bounce_not_classify_reply():
    messages = [{
        "from_email": "mailer-daemon@googlemail.com",
        "subject": "Delivery Status Notification (Failure)",
        "body_text": "Delivery to the following recipient failed permanently:\n\npriya@acmehr.com",
        "message_id": "m1",
        "thread_id": "t1",
    }]
    with patch(f"{_MOD}.gmail_oauth.is_configured", return_value=True), \
         patch(f"{_MOD}.gmail_oauth.list_inbox_replies", return_value=messages), \
         patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.update_lead_raw") as updater, \
         patch(f"{_MOD}.llm.chat_json") as llm_mock:
        summary = poll_and_classify_inbox()

    assert summary["counts"]["hard_bounces"] == 1
    assert summary["counts"]["classified"] == 0
    updater.assert_called_once()
    llm_mock.assert_not_called()  # never reaches the reply-classification LLM call


def test_poller_still_classifies_ordinary_replies_normally():
    messages = [{
        "from_email": "priya@acmehr.com",
        "subject": "Re: quick question",
        "body_text": "Sounds great, let's set up a call.",
        "message_id": "m2",
        "thread_id": "t2",
    }]
    with patch(f"{_MOD}.gmail_oauth.is_configured", return_value=True), \
         patch(f"{_MOD}.gmail_oauth.list_inbox_replies", return_value=messages), \
         patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=None), \
         patch(f"{_MOD}.supabase.get_outreach_log_by_thread_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"classification": "interested", "confidence": "high", "suggested_action": "book a call"}), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=101), \
         patch(f"{_MOD}.supabase.update_lead_raw") as updater:
        summary = poll_and_classify_inbox()

    assert summary["counts"]["classified"] == 1
    assert summary["counts"]["hard_bounces"] == 0
    updater.assert_not_called()
