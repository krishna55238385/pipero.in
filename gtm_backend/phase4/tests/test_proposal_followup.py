"""Tests for Agent 26 — Proposal Follow-up. All external IO mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_26_proposal_followup import (
    check_proposal_followups,
    evaluate_proposal,
)

_MOD = "gtm_backend.phase4.agents.agent_26_proposal_followup"

_NOW = datetime.now(timezone.utc)


def _sent(hours_ago: float) -> str:
    return (_NOW - timedelta(hours=hours_ago)).isoformat()


_BASE = {
    "id": 1, "company_name": "Acme HR", "proposal_text": "We propose a 3-month pilot...",
    "sent_at": _sent(72), "opened_at": None, "open_count": 0,
    "shared_with_others": False, "seller_alerted": False,
    "followup_count": 0, "last_followup_at": None,
}


def test_shared_with_others_triggers_seller_alert_not_llm_draft():
    proposal = {**_BASE, "shared_with_others": True, "seller_alerted": False}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "seller_alerted"
    chat.assert_not_called()
    assert updater.call_args[1]["seller_alerted"] is True


def test_already_alerted_does_not_alert_again():
    proposal = {**_BASE, "shared_with_others": True, "seller_alerted": True}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json", return_value={"followup_text": "hi"}):
        result = evaluate_proposal(proposal)

    assert result["status"] != "seller_alerted"


def test_max_followups_reached_stops_without_drafting():
    proposal = {**_BASE, "followup_count": 3}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "max_followups_reached"
    chat.assert_not_called()
    updater.assert_not_called()


def test_not_opened_past_48h_drafts_checkin():
    proposal = {**_BASE, "sent_at": _sent(72), "opened_at": None, "open_count": 0}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json", return_value={"followup_text": "Following up on the pilot proposal..."}) as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "drafted"
    assert result["signal"] == "not_opened"
    assert chat.call_args[1]["agent"] == "agent_26_proposal_followup"
    assert updater.call_args[1]["followup_status"] == "drafted"
    assert updater.call_args[1]["followup_count"] == 1


def test_not_opened_but_under_48h_takes_no_action():
    proposal = {**_BASE, "sent_at": _sent(10), "opened_at": None, "open_count": 0}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "no_action_needed"
    chat.assert_not_called()
    updater.assert_not_called()


def test_multiple_opens_drafts_high_intent_followup():
    proposal = {**_BASE, "sent_at": _sent(5), "opened_at": _sent(2), "open_count": 3}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json", return_value={"followup_text": "Saw you've been through the proposal a few times..."}) as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "drafted"
    assert result["signal"] == "high_intent"
    payload_arg = chat.call_args[0][1]
    assert "high_intent" in payload_arg


def test_opened_once_no_more_no_action():
    proposal = {**_BASE, "sent_at": _sent(72), "opened_at": _sent(60), "open_count": 1}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "no_action_needed"
    chat.assert_not_called()


def test_never_re_triggers_after_one_followup_already_drafted():
    """v1 conservative rule: only ever one automatic follow-up per proposal,
    even if the same signal (e.g. still not opened) remains true."""
    proposal = {**_BASE, "sent_at": _sent(200), "opened_at": None, "open_count": 0, "followup_count": 1}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = evaluate_proposal(proposal)

    assert result["status"] == "no_action_needed"
    chat.assert_not_called()


def test_llm_failure_does_not_update_row():
    proposal = {**_BASE, "sent_at": _sent(72)}
    with patch(f"{_MOD}.supabase.update_deal_proposal") as updater, \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")):
        result = evaluate_proposal(proposal)

    assert result["status"] == "failed"
    updater.assert_not_called()


def test_batch_counts_actions():
    proposals = [
        {**_BASE, "id": 1, "sent_at": _sent(72), "opened_at": None, "open_count": 0},
        {**_BASE, "id": 2, "shared_with_others": True, "seller_alerted": False},
        {**_BASE, "id": 3, "sent_at": _sent(10), "opened_at": None, "open_count": 0},
    ]
    with patch(f"{_MOD}.supabase.get_sent_proposals", return_value=proposals), \
         patch(f"{_MOD}.supabase.update_deal_proposal"), \
         patch(f"{_MOD}.llm.chat_json", return_value={"followup_text": "Quick note on the proposal..."}):
        summary = check_proposal_followups()

    assert summary["drafted"] == 1
    assert summary["seller_alerted"] == 1
    assert summary["no_action_needed"] == 1
