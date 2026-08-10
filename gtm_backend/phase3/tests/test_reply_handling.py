"""Tests for Agent 17 — Reply Handling. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_17_reply_handling import (
    _route_interested_reply,
    draft_pending_responses,
    draft_response,
    send_approved_response,
)

_MOD = "gtm_backend.phase3.agents.agent_17_reply_handling"

_REPLY = {
    "id": 5, "lead_id": 1, "company_name": "Acme HR", "email": "priya@acmehr.com",
    "classification": "interested", "reply_text": "Sounds great, when can we chat?",
    "response_status": "pending_draft",
    # Already checked by Agent 22, no meeting intent found -> drafting should
    # proceed normally. See the dedicated routing tests below for the
    # defer/skip cases this field controls.
    "meeting_booking_checked": True,
}


def test_draft_response_writes_draft_and_pending_review():
    llm_response = {"draft_response": "Thanks Priya! Does Tuesday or Wednesday afternoon work for a quick call?"}
    with patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = draft_response(_REPLY)

    assert result["status"] == "drafted"
    assert "Tuesday" in result["draft_response"]
    kwargs = updater.call_args
    assert kwargs[0][0] == 5  # reply_id positional
    assert kwargs[1]["response_status"] == "pending_review"
    assert "Tuesday" in kwargs[1]["draft_response"]


def test_draft_response_never_auto_approves_on_llm_failure():
    with patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = draft_response(_REPLY)

    assert result["status"] == "failed"
    assert updater.call_args[1]["response_status"] == "pending_review"
    assert updater.call_args[1]["draft_response"] is None


def test_draft_response_handles_empty_llm_output():
    with patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value={"draft_response": ""}), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = draft_response(_REPLY)

    assert result["status"] == "failed"
    assert updater.call_args[1]["response_status"] == "pending_review"


def test_draft_pending_responses_batch():
    llm_response = {"draft_response": "Thanks for the reply!"}
    with patch(f"{_MOD}.supabase.get_replies_needing_draft", return_value=[_REPLY, {**_REPLY, "id": 6}]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply"):
        summary = draft_pending_responses()

    assert summary["replies_examined"] == 2
    assert summary["drafted"] == 2
    assert summary["skipped_meeting_proposed"] == 0
    assert summary["deferred_meeting_check_pending"] == 0


# -- Agent 17 / Agent 22 overlap routing (found live 2026-08-08) -----------

def test_non_interested_reply_is_never_routed_specially():
    reply = {**_REPLY, "classification": "has_question", "meeting_booking_checked": False}
    assert _route_interested_reply(reply) is None


def test_interested_reply_defers_until_meeting_intent_checked():
    reply = {**_REPLY, "meeting_booking_checked": False}
    with patch(f"{_MOD}.supabase.get_meeting_for_reply") as meeting_lookup, \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        route = _route_interested_reply(reply)

    assert route == "defer"
    meeting_lookup.assert_not_called()
    updater.assert_not_called()


def test_interested_reply_with_proposed_meeting_is_skipped_and_marked_no_response_needed():
    reply = {**_REPLY, "meeting_booking_checked": True}
    with patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value={"id": 1, "status": "proposed"}), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        route = _route_interested_reply(reply)

    assert route == "skip_has_meeting"
    updater.assert_called_once_with(5, response_status="no_response_needed")


def test_interested_reply_checked_with_no_meeting_drafts_normally():
    reply = {**_REPLY, "meeting_booking_checked": True}
    with patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value=None), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        route = _route_interested_reply(reply)

    assert route is None
    updater.assert_not_called()


def test_batch_skips_meeting_proposed_reply_without_drafting():
    reply_with_meeting = {**_REPLY, "id": 7}
    llm_mock_response = {"draft_response": "should not be used"}
    with patch(f"{_MOD}.supabase.get_replies_needing_draft", return_value=[reply_with_meeting]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply", return_value={"id": 9}), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_mock_response) as llm_mock, \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        summary = draft_pending_responses()

    assert summary["drafted"] == 0
    assert summary["skipped_meeting_proposed"] == 1
    llm_mock.assert_not_called()
    updater.assert_called_once_with(7, response_status="no_response_needed")


def test_batch_defers_reply_still_awaiting_meeting_intent_check():
    reply_not_checked = {**_REPLY, "id": 8, "meeting_booking_checked": False}
    with patch(f"{_MOD}.supabase.get_replies_needing_draft", return_value=[reply_not_checked]), \
         patch(f"{_MOD}.supabase.get_meeting_for_reply") as meeting_lookup, \
         patch(f"{_MOD}.llm.chat_json") as llm_mock:
        summary = draft_pending_responses()

    assert summary["drafted"] == 0
    assert summary["deferred_meeting_check_pending"] == 1
    llm_mock.assert_not_called()
    meeting_lookup.assert_not_called()


def test_send_approved_response_refuses_unapproved_draft():
    """The one hard gate: a reply not explicitly 'approved' must never send."""
    with patch(f"{_MOD}.supabase.get_reply_by_id", return_value={**_REPLY, "response_status": "pending_review"}), \
         patch(f"{_MOD}.gmail_smtp.send_html_email") as sender:
        result = send_approved_response(5)

    assert result["status"] == "not_approved"
    sender.assert_not_called()


def test_send_approved_response_sends_when_approved():
    approved_reply = {**_REPLY, "response_status": "approved", "draft_response": "Sounds great, Tuesday works!"}
    with patch(f"{_MOD}.supabase.get_reply_by_id", return_value=approved_reply), \
         patch(f"{_MOD}.gmail_smtp.is_configured", return_value=True), \
         patch(f"{_MOD}.gmail_smtp.send_html_email", return_value={"message_id": "m1", "thread_id": "t1"}) as sender, \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = send_approved_response(5)

    assert result["status"] == "sent"
    sender.assert_called_once()
    assert sender.call_args[1]["to"] == "priya@acmehr.com"
    assert updater.call_args[1]["response_status"] == "sent"
    assert updater.call_args[1]["response_message_id"] == "m1"


def test_send_approved_response_missing_reply():
    with patch(f"{_MOD}.supabase.get_reply_by_id", return_value=None):
        result = send_approved_response(999)
    assert result["status"] == "not_found"
