"""Tests for Agent 17 — Reply Handling. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_17_reply_handling import (
    draft_pending_responses,
    draft_response,
    send_approved_response,
)

_MOD = "gtm_backend.phase3.agents.agent_17_reply_handling"

_REPLY = {
    "id": 5, "lead_id": 1, "company_name": "Acme HR", "email": "priya@acmehr.com",
    "classification": "interested", "reply_text": "Sounds great, when can we chat?",
    "response_status": "pending_draft",
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
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply"):
        summary = draft_pending_responses()

    assert summary["replies_examined"] == 2
    assert summary["drafted"] == 2


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
