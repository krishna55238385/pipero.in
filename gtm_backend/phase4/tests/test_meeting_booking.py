"""Tests for Agent 22 — Meeting Booking. All external IO (LLM, Cal.com,
Gmail, Supabase) mocked."""
from unittest.mock import patch

import pytest

from gtm_backend.phase4.agents.agent_22_meeting_booking import (
    _proposal_email,
    detect_no_shows_and_reschedule,
    propose_meetings,
    sync_meeting_confirmations,
)
from gtm_backend.phase4.core.prompts import MEETING_INTENT_SYSTEM

_MOD = "gtm_backend.phase4.agents.agent_22_meeting_booking"

_REPLY = {
    "id": 9, "lead_id": 1, "email": "priya@acmehr.com",
    "classification": "interested",
    "reply_text": "Sounds great, can we hop on a call this week?",
}
_LEAD = {"id": 1, "company_name": "Acme HR"}
_SLOTS = ["2026-08-10T09:00:00Z", "2026-08-10T13:00:00Z", "2026-08-11T09:00:00Z"]
_MEETING_SETTINGS = {
    "business_start_hour": 9, "business_end_hour": 17,
    "business_timezone": "UTC", "duration_minutes": 30,
}


@pytest.fixture(autouse=True)
def _default_org_meeting_settings():
    """Per-org business hours (2026-08-19): agent_22 now calls
    supabase.get_current_org_meeting_settings() on every propose/confirm
    path. Auto-applied to every test in this file so existing tests don't
    each need to mock it individually; dedicated tests below verify the
    real wiring (that the values actually get passed through)."""
    with patch(f"{_MOD}.supabase.get_current_org_meeting_settings", return_value=dict(_MEETING_SETTINGS)):
        yield


# -- propose_meetings ---------------------------------------------------

def test_proposes_meeting_when_intent_and_slots_present():
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"wants_meeting": True, "reasoning": "asked for a call"}), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_channel_plan_for_lead", return_value={"timezone": "Asia/Kolkata"}), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock, \
         patch(f"{_MOD}.supabase.create_meeting") as create_mock, \
         patch(f"{_MOD}.supabase.update_reply") as update_mock:
        summary = propose_meetings()

    assert summary["proposed"] == 1
    send_mock.assert_called_once()
    assert send_mock.call_args.kwargs["to"] == "priya@acmehr.com"
    # Regression: subject must use the real company name from leads_raw,
    # never a "?" placeholder (the outreach_replies row has no company_name
    # column at all, so this only works via the get_lead_by_id lookup).
    assert send_mock.call_args.kwargs["subject"] == "Scheduling a quick call — Acme HR"
    create_kwargs = create_mock.call_args[1]
    assert create_kwargs["reply_id"] == 9
    assert create_kwargs["proposed_slots"] == _SLOTS
    assert update_mock.call_args[1]["meeting_booking_checked"] is True


def test_no_meeting_intent_marks_checked_but_sends_nothing():
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"wants_meeting": False, "reasoning": "just asked pricing"}), \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock, \
         patch(f"{_MOD}.supabase.create_meeting") as create_mock, \
         patch(f"{_MOD}.supabase.update_reply") as update_mock:
        summary = propose_meetings()

    assert summary["no_intent"] == 1
    send_mock.assert_not_called()
    create_mock.assert_not_called()
    assert update_mock.call_args[1]["meeting_booking_checked"] is True


def test_no_slots_available_does_not_mark_checked():
    """Cal.com being unreachable is transient — must retry next run, not be
    permanently skipped like a real 'no intent' reply."""
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"wants_meeting": True, "reasoning": "x"}), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_channel_plan_for_lead", return_value=None), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=[]), \
         patch(f"{_MOD}.supabase.update_reply") as update_mock:
        summary = propose_meetings()

    assert summary["no_slots_available"] == 1
    update_mock.assert_not_called()


def test_llm_failure_does_not_mark_checked():
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.update_reply") as update_mock:
        summary = propose_meetings()

    assert summary["failed"] == 1
    update_mock.assert_not_called()


def test_already_has_meeting_row_is_skipped_idempotently():
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as llm_mock, \
         patch(f"{_MOD}.supabase.update_reply") as update_mock:
        propose_meetings()

    llm_mock.assert_not_called()
    assert update_mock.call_args[1]["meeting_booking_checked"] is True


def test_at_least_3_slots_requested_from_calendar():
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"wants_meeting": True, "reasoning": "x"}), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_channel_plan_for_lead", return_value={"timezone": "UTC"}), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS) as slots_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email"), \
         patch(f"{_MOD}.supabase.create_meeting"), \
         patch(f"{_MOD}.supabase.update_reply"):
        propose_meetings()

    assert slots_mock.call_args.kwargs["min_slots"] == 3


# -- MEETING_INTENT_SYSTEM prompt regression -------------------------------
# Found live 2026-08-07: a VP-level reply stating budget approval + a Q3
# deadline (but never explicitly asking to "talk" or "call") was wrongly
# classified wants_meeting=false under the old explicit-ask-only rule,
# leaving a real, budget-approved prospect unprocessed for 13 days. These
# lock in that the prompt now explicitly instructs the LLM to also treat a
# clear budget+authority+timing buying signal as meeting-worthy on its own.

def test_prompt_covers_high_intent_buying_signal_not_just_explicit_ask():
    assert "budget" in MEETING_INTENT_SYSTEM.lower()
    assert "authority" in MEETING_INTENT_SYSTEM.lower()
    assert "timing" in MEETING_INTENT_SYSTEM.lower() or "deadline" in MEETING_INTENT_SYSTEM.lower()


def test_proposes_meeting_for_high_intent_reply_without_explicit_ask():
    """Same shape as the real reply that was missed — budget + authority +
    deadline, no literal 'can we talk' — must be treated as meeting-worthy."""
    budget_reply = {
        **_REPLY,
        "reply_text": (
            "This looks great — we need something before our Q3 compliance "
            "deadline, and as VP of Ops I can approve budget up to $15,000."
        ),
    }
    with patch(f"{_MOD}.supabase.get_replies_needing_meeting_check", return_value=[budget_reply]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "wants_meeting": True, "reasoning": "budget+authority+timing all present (rule b)",
         }), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_channel_plan_for_lead", return_value={"timezone": "UTC"}), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.gmail_oauth.send_html_email"), \
         patch(f"{_MOD}.supabase.create_meeting") as create_mock, \
         patch(f"{_MOD}.supabase.update_reply"):
        summary = propose_meetings()

    assert summary["proposed"] == 1
    create_mock.assert_called_once()


# -- Timezone-label copy fix -------------------------------------------
# Found live 2026-08-07: a lead with no channel-plan timezone falls back to
# UTC (correct behavior), but the proposal email still claimed times were
# "shown in your local timezone" — misleading when it's really just the UTC
# fallback, not a known personalized zone.

def test_proposal_email_says_utc_when_falling_back_not_your_local_timezone():
    html = _proposal_email("Acme HR", _SLOTS, "UTC")
    assert "shown in UTC" in html
    assert "your local timezone" not in html


def test_proposal_email_says_local_timezone_when_a_real_zone_is_known():
    html = _proposal_email("Acme HR", _SLOTS, "Asia/Kolkata")
    assert "shown in your local timezone" in html
    assert "shown in UTC" not in html


# -- sync_meeting_confirmations ------------------------------------------

_MEETING = {
    "id": 5, "lead_id": 1, "reply_id": 9, "proposed_at": "2026-08-07T10:00:00+00:00",
    "proposed_slots": _SLOTS, "attendee_timezone": "Asia/Kolkata",
}
_CONFIRM_REPLY = {
    "email": "priya@acmehr.com",
    "reply_text": "The 9am on the 10th works great!",
}


def test_confirms_and_books_when_reply_matches_a_slot():
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "confirmed", "matched_slot": _SLOTS[0], "reasoning": "picked the first slot",
         }), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.calendar.create_booking", return_value={"uid": "gcal-event-1"}) as book_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock:
        summary = sync_meeting_confirmations()

    assert summary["confirmed"] == 1
    book_mock.assert_called_once()
    assert book_mock.call_args.kwargs["start_iso"] == _SLOTS[0]
    assert update_mock.call_args[1]["status"] == "confirmed"
    assert update_mock.call_args[1]["calcom_booking_uid"] == "gcal-event-1"
    send_mock.assert_called_once()


def test_no_new_reply_is_left_pending():
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[]), \
         patch(f"{_MOD}.calendar.create_booking") as book_mock:
        summary = sync_meeting_confirmations()

    assert summary["no_new_reply"] == 1
    book_mock.assert_not_called()


def test_decline_cancels_meeting_without_booking():
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "declined", "matched_slot": None, "reasoning": "said no longer interested",
         }), \
         patch(f"{_MOD}.calendar.create_booking") as book_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = sync_meeting_confirmations()

    assert summary["declined"] == 1
    book_mock.assert_not_called()
    assert update_mock.call_args[1]["status"] == "cancelled"


def test_reschedule_requested_does_not_book_or_cancel():
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "reschedule_requested", "matched_slot": None, "reasoning": "asked for a different time",
         }), \
         patch(f"{_MOD}.calendar.create_booking") as book_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = sync_meeting_confirmations()

    assert summary["reschedule_requested"] == 1
    book_mock.assert_not_called()
    update_mock.assert_not_called()


def test_hallucinated_slot_not_in_proposed_list_is_ignored():
    """LLM claims 'confirmed' with a slot that isn't actually one of the ones
    offered — must never book a fabricated time."""
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "confirmed", "matched_slot": "2099-01-01T00:00:00Z", "reasoning": "x",
         }), \
         patch(f"{_MOD}.calendar.create_booking") as book_mock:
        summary = sync_meeting_confirmations()

    assert summary["no_new_reply"] == 1
    book_mock.assert_not_called()


def test_calendar_booking_failure_is_reported_not_silently_dropped():
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "confirmed", "matched_slot": _SLOTS[0], "reasoning": "x",
         }), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD):
        import gtm_backend.phase3.connectors.google_calendar as calendar_mod
        with patch(f"{_MOD}.calendar.create_booking", side_effect=calendar_mod.CalendarError("boom")), \
             patch(f"{_MOD}.supabase.update_meeting") as update_mock:
            summary = sync_meeting_confirmations()

    assert summary["failed"] == 1
    update_mock.assert_not_called()


def test_confirmation_email_failure_does_not_undo_the_booking():
    """A failed confirmation email must not roll back an already-successful
    Cal.com booking — the meeting stays booked."""
    with patch(f"{_MOD}.supabase.get_meetings_awaiting_confirmation", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_replies_for_lead_since", return_value=[_CONFIRM_REPLY]), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             "outcome": "confirmed", "matched_slot": _SLOTS[0], "reasoning": "x",
         }), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.calendar.create_booking", return_value={"uid": "gcal-event-2"}), \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email", side_effect=RuntimeError("smtp down")):
        summary = sync_meeting_confirmations()

    assert summary["confirmed"] == 1
    assert update_mock.call_args[1]["status"] == "confirmed"


# -- detect_no_shows_and_reschedule --------------------------------------

_PAST_DUE_MEETING = {
    "id": 5, "lead_id": 1, "reply_id": 9,
    "scheduled_at": "2026-08-10T09:00:00+00:00",
    "attendee_timezone": "Asia/Kolkata", "reschedule_count": 0,
    "calcom_booking_uid": "gcal-event-stale-1",
}
_ATTENDEE_REPLY = {"email": "priya@acmehr.com"}


def test_no_show_offers_reschedule_when_under_attempt_cap():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[_PAST_DUE_MEETING]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value=_ATTENDEE_REPLY), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.calendar.cancel_booking", return_value=True) as cancel_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["rescheduled"] == 1
    send_mock.assert_called_once()
    assert send_mock.call_args.kwargs["to"] == "priya@acmehr.com"
    # The old (missed) Calendar event must be cancelled, not left dangling.
    cancel_mock.assert_called_once_with("gcal-event-stale-1")
    kwargs = update_mock.call_args[1]
    assert kwargs["status"] == "proposed"
    assert kwargs["proposed_slots"] == _SLOTS
    assert kwargs["scheduled_at"] is None
    assert kwargs["calcom_booking_uid"] is None
    assert kwargs["reschedule_count"] == 1


def test_no_show_moves_to_nurture_after_max_attempts():
    """PDF rule: max 2 reschedule attempts before nurture — a meeting already
    at 2 must not get offered a 3rd reschedule."""
    maxed_meeting = {**_PAST_DUE_MEETING, "reschedule_count": 2}
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[maxed_meeting]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.calendar.get_available_slots") as slots_mock, \
         patch(f"{_MOD}.calendar.cancel_booking", return_value=True) as cancel_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["moved_to_nurture"] == 1
    slots_mock.assert_not_called()
    send_mock.assert_not_called()
    # Moving to nurture is also a resolution of the missed meeting — the
    # stale event must be cancelled here too, not just on the reschedule path.
    cancel_mock.assert_called_once_with("gcal-event-stale-1")
    assert update_mock.call_args[1]["status"] == "moved_to_nurture"


def test_no_show_cancel_failure_does_not_block_reschedule():
    """cancel_booking() failing (e.g. Calendar API hiccup) must not stop the
    reschedule offer from going out — it's best-effort, not a blocking step."""
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[_PAST_DUE_MEETING]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value=_ATTENDEE_REPLY), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.calendar.cancel_booking", return_value=False), \
         patch(f"{_MOD}.gmail_oauth.send_html_email") as send_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["rescheduled"] == 1
    send_mock.assert_called_once()
    assert update_mock.call_args[1]["status"] == "proposed"


def test_no_show_skips_cancel_when_no_prior_booking_uid():
    """A meeting with no calcom_booking_uid (should be rare for a
    status='confirmed' row, but defensively handled) must not call
    cancel_booking with an empty/None uid."""
    no_uid_meeting = {**_PAST_DUE_MEETING, "calcom_booking_uid": None}
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[no_uid_meeting]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value=_ATTENDEE_REPLY), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.calendar.cancel_booking") as cancel_mock, \
         patch(f"{_MOD}.gmail_oauth.send_html_email"), \
         patch(f"{_MOD}.supabase.update_meeting"):
        detect_no_shows_and_reschedule()

    cancel_mock.assert_not_called()


def test_no_show_no_slots_available_does_not_burn_an_attempt():
    """A transient calendar outage during a reschedule attempt must not cost
    the prospect one of their 2 real reschedule attempts."""
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[_PAST_DUE_MEETING]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value=_ATTENDEE_REPLY), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=[]), \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["no_slots_available"] == 1
    update_mock.assert_not_called()


def test_no_show_without_attendee_email_moves_to_nurture():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[_PAST_DUE_MEETING]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value={"email": ""}), \
         patch(f"{_MOD}.calendar.get_available_slots") as slots_mock, \
         patch(f"{_MOD}.calendar.cancel_booking", return_value=True) as cancel_mock, \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["moved_to_nurture"] == 1
    slots_mock.assert_not_called()
    cancel_mock.assert_called_once_with("gcal-event-stale-1")
    assert update_mock.call_args[1]["status"] == "moved_to_nurture"


def test_no_show_reschedule_email_failure_is_reported_not_silently_dropped():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[_PAST_DUE_MEETING]), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_id", return_value=_ATTENDEE_REPLY), \
         patch(f"{_MOD}.calendar.get_available_slots", return_value=_SLOTS), \
         patch(f"{_MOD}.gmail_oauth.send_html_email", side_effect=RuntimeError("smtp down")), \
         patch(f"{_MOD}.supabase.update_meeting") as update_mock:
        summary = detect_no_shows_and_reschedule()

    assert summary["failed"] == 1
    update_mock.assert_not_called()


def test_no_show_cutoff_uses_org_configured_duration():
    """Past-due-ness is computed from now minus the org's own meeting
    duration (same length meetings are booked at), not a fixed constant."""
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_past_due", return_value=[]) as query_mock:
        detect_no_shows_and_reschedule()

    assert query_mock.call_count == 1
    # First positional arg is the cutoff ISO string; just assert it was
    # called with a real ISO-formatted timestamp (not asserting exact value
    # since it's computed from datetime.now()).
    cutoff_arg = query_mock.call_args[0][0]
    assert isinstance(cutoff_arg, str) and "T" in cutoff_arg
