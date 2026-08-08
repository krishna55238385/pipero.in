"""Tests for Agent 16 — Inbox Management. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_16_inbox import (
    classify_reply,
    classify_replies_batch,
    poll_and_classify_inbox,
)

_MOD = "gtm_backend.phase3.agents.agent_16_inbox"

_LEAD = {"id": 1, "company_name": "Acme HR", "contact_email": "priya@acmehr.com", "icp_id": 1}


def test_unmatched_email_is_never_guessed():
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=None), \
         patch(f"{_MOD}.supabase.insert_reply") as inserter:
        result = classify_reply("stranger@nowhere.com", "Not interested, thanks.")

    assert result["status"] == "unmatched"
    inserter.assert_not_called()


def test_classifies_and_persists(caplog=None):
    llm_response = {
        "classification": "interested",
        "confidence": "high",
        "suggested_action": "book a 15-minute call",
    }
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=101) as inserter:
        result = classify_reply("priya@acmehr.com", "Sounds great, let's set up a call.", campaign_id="camp-1")

    assert result["status"] == "classified"
    assert result["classification"] == "interested"
    assert result["confidence"] == "high"
    assert result["reply_id"] == 101
    inserted_record = inserter.call_args[0][0]
    assert inserted_record.lead_id == 1
    assert inserted_record.classification == "interested"
    assert inserted_record.reply_text == "Sounds great, let's set up a call."


def test_already_classified_is_idempotent():
    existing = {"classification": "interested", "confidence": "high"}
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_for_lead", return_value=existing), \
         patch(f"{_MOD}.llm.chat_json") as llm_mock, \
         patch(f"{_MOD}.supabase.insert_reply") as inserter:
        result = classify_reply("priya@acmehr.com", "Sounds great!")

    assert result["status"] == "already_classified"
    assert result["classification"] == "interested"
    llm_mock.assert_not_called()
    inserter.assert_not_called()


def test_llm_failure_falls_back_to_unknown_low_confidence():
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=102) as inserter:
        result = classify_reply("priya@acmehr.com", "some reply text")

    assert result["classification"] == "unknown"
    assert result["confidence"] == "low"
    assert "escalate" in result["suggested_action"].lower()
    inserted_record = inserter.call_args[0][0]
    assert inserted_record.classification == "unknown"


def test_invalid_llm_classification_value_is_coerced_to_unknown():
    """LLM returns something outside the allowed enum — must not be trusted verbatim."""
    llm_response = {"classification": "super_excited", "confidence": "extremely_high", "suggested_action": "party"}
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=103):
        result = classify_reply("priya@acmehr.com", "wow amazing")

    assert result["classification"] == "unknown"
    assert result["confidence"] == "low"


def test_batch_processes_multiple_replies_and_counts_statuses():
    replies = [
        {"from_email": "priya@acmehr.com", "reply_text": "Interested!", "campaign_id": "c1"},
        {"from_email": "unknown@nowhere.com", "reply_text": "hi", "campaign_id": "c1"},
    ]
    llm_response = {"classification": "interested", "confidence": "high", "suggested_action": "book a call"}

    def fake_lookup(email):
        return _LEAD if email == "priya@acmehr.com" else None

    with patch(f"{_MOD}.supabase.get_lead_by_email", side_effect=fake_lookup), \
         patch(f"{_MOD}.supabase.get_reply_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=200):
        summary = classify_replies_batch(replies)

    assert summary["counts"]["classified"] == 1
    assert summary["counts"]["unmatched"] == 1
    assert len(summary["results"]) == 2


# -- Task #34/#35: message_id dedup + inbox polling ------------------------

def test_message_id_is_the_dedupe_key_when_present():
    """When a message_id is supplied (the real inbox-poller path), idempotency
    is checked via get_reply_by_message_id, NOT the old lead+campaign check —
    that's what allows a second, genuinely different reply from the same
    lead/campaign to be recorded instead of silently dropped."""
    llm_response = {"classification": "interested", "confidence": "high", "suggested_action": "book a call"}
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=None) as by_msg, \
         patch(f"{_MOD}.supabase.get_reply_for_lead") as by_lead, \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=201) as inserter:
        result = classify_reply(
            "priya@acmehr.com", "Yes let's talk", campaign_id="c1",
            message_id="msg-abc", thread_id="thread-xyz",
        )

    assert result["status"] == "classified"
    by_msg.assert_called_once_with("msg-abc")
    by_lead.assert_not_called()
    inserted_record = inserter.call_args[0][0]
    assert inserted_record.message_id == "msg-abc"
    assert inserted_record.thread_id == "thread-xyz"


def test_same_message_id_polled_twice_is_not_double_classified():
    existing = {"classification": "interested"}
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=existing), \
         patch(f"{_MOD}.llm.chat_json") as llm_mock, \
         patch(f"{_MOD}.supabase.insert_reply") as inserter:
        result = classify_reply(
            "priya@acmehr.com", "Yes let's talk", message_id="msg-abc",
        )

    assert result["status"] == "already_classified"
    llm_mock.assert_not_called()
    inserter.assert_not_called()


def test_second_real_reply_same_lead_and_campaign_is_recorded_not_dropped():
    """The bug Task #34 exists to fix: a prospect who replies 'interested'
    and later sends a SECOND, different message (e.g. confirming a meeting
    time) in the same campaign must get a second row, not be swallowed by
    the old (lead_id, campaign_id) uniqueness ratchet."""
    llm_response = {"classification": "interested", "confidence": "high", "suggested_action": "confirm slot"}
    with patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=202) as inserter:
        result = classify_reply(
            "priya@acmehr.com", "Aug 10 9am works for me", campaign_id="c1",
            message_id="msg-second",
        )

    assert result["status"] == "classified"
    inserter.assert_called_once()


def test_poll_inbox_skips_when_gmail_not_configured():
    with patch(f"{_MOD}.gmail_oauth.is_configured", return_value=False), \
         patch(f"{_MOD}.gmail_oauth.list_inbox_replies") as list_mock:
        summary = poll_and_classify_inbox()

    assert summary["polled"] == 0
    list_mock.assert_not_called()


def test_poll_inbox_classifies_each_message_and_resolves_campaign_via_thread():
    messages = [
        {"message_id": "m1", "thread_id": "t1", "from_email": "priya@acmehr.com", "body_text": "Interested!"},
        {"message_id": "m2", "thread_id": None, "from_email": "priya@acmehr.com", "body_text": ""},
    ]
    llm_response = {"classification": "interested", "confidence": "high", "suggested_action": "book a call"}
    with patch(f"{_MOD}.gmail_oauth.is_configured", return_value=True), \
         patch(f"{_MOD}.gmail_oauth.list_inbox_replies", return_value=messages), \
         patch(f"{_MOD}.supabase.get_outreach_log_by_thread_id", return_value={"campaign_id": "camp-9"}) as log_lookup, \
         patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=301) as inserter:
        summary = poll_and_classify_inbox(days_back=3, max_results=25)

    assert summary["polled"] == 2
    assert summary["counts"]["classified"] == 1
    assert summary["counts"]["skipped_no_body"] == 1
    log_lookup.assert_called_once_with("t1")
    inserted_record = inserter.call_args[0][0]
    assert inserted_record.campaign_id == "camp-9"
    assert inserted_record.message_id == "m1"


def test_poll_inbox_defaults_to_empty_campaign_when_thread_unmatched():
    messages = [
        {"message_id": "m1", "thread_id": "t-unknown", "from_email": "priya@acmehr.com", "body_text": "Hi there"},
    ]
    llm_response = {"classification": "unknown", "confidence": "low", "suggested_action": "review"}
    with patch(f"{_MOD}.gmail_oauth.is_configured", return_value=True), \
         patch(f"{_MOD}.gmail_oauth.list_inbox_replies", return_value=messages), \
         patch(f"{_MOD}.supabase.get_outreach_log_by_thread_id", return_value=None), \
         patch(f"{_MOD}.supabase.get_lead_by_email", return_value=_LEAD), \
         patch(f"{_MOD}.supabase.get_reply_by_message_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.insert_reply", return_value=302) as inserter:
        poll_and_classify_inbox()

    inserted_record = inserter.call_args[0][0]
    assert inserted_record.campaign_id == ""
