"""Tests for Agent 16 — Inbox Management. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_16_inbox import classify_reply, classify_replies_batch

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
