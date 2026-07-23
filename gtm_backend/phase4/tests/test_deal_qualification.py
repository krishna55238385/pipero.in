"""Tests for Agent 24 — Deal Qualification. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_24_deal_qualification import (
    qualify_deal,
    qualify_pending_deals,
)

_MOD = "gtm_backend.phase4.agents.agent_24_deal_qualification"

_REPLY = {
    "id": 9, "lead_id": 1, "email": "priya@acmehr.com", "company_name": "Acme HR",
    "classification": "interested",
    "reply_text": "This looks great, we need something before our Q3 renewal and I can sign off on it.",
}

_CRM_LEAD = {"id": "crm-uuid-1", "email": "priya@acmehr.com"}
_LLM_RESPONSE = {
    "qualification_score": 82,
    "budget": "yes", "authority": "yes", "need": "yes", "timing": "yes",
    "estimated_deal_value": 12000,
    "reasoning": "States a Q3 renewal deadline and personal sign-off authority.",
}


def test_no_crm_lead_match_skips_deal_but_marks_qualified():
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=None), \
         patch(f"{_MOD}.supabase.update_reply") as updater, \
         patch(f"{_MOD}.supabase.create_deal") as creator:
        result = qualify_deal(_REPLY)

    assert result["status"] == "no_crm_lead"
    creator.assert_not_called()
    assert updater.call_args[1]["deal_qualified"] is True


def test_creates_new_deal_when_none_exists():
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=_CRM_LEAD), \
         patch(f"{_MOD}.supabase.get_deal_for_crm_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_deal", return_value={"id": "deal-1"}) as creator, \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = qualify_deal(_REPLY)

    assert result["status"] == "created"
    assert result["deal_id"] == "deal-1"
    kwargs = creator.call_args[1]
    assert kwargs["lead_id"] == "crm-uuid-1"
    assert kwargs["probability"] == 82
    assert kwargs["value"] == 12000.0
    assert kwargs["status"] == "qualified"
    assert updater.call_args[1]["deal_qualified"] is True


def test_updates_existing_deal_instead_of_duplicating():
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=_CRM_LEAD), \
         patch(f"{_MOD}.supabase.get_deal_for_crm_lead", return_value={"id": "deal-existing"}), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_deal") as creator, \
         patch(f"{_MOD}.supabase.update_deal") as updater_deal, \
         patch(f"{_MOD}.supabase.update_reply"):
        result = qualify_deal(_REPLY)

    assert result["status"] == "updated"
    creator.assert_not_called()
    assert updater_deal.call_args[0][0] == "deal-existing"
    assert updater_deal.call_args[1]["probability"] == 82


def test_low_score_maps_to_needs_info_status():
    low_score = {**_LLM_RESPONSE, "qualification_score": 10, "estimated_deal_value": None}
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=_CRM_LEAD), \
         patch(f"{_MOD}.supabase.get_deal_for_crm_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=low_score), \
         patch(f"{_MOD}.supabase.create_deal", return_value={"id": "deal-2"}) as creator, \
         patch(f"{_MOD}.supabase.update_reply"):
        qualify_deal(_REPLY)

    assert creator.call_args[1]["status"] == "needs_info"
    assert creator.call_args[1]["value"] is None


def test_never_fabricates_deal_value_when_llm_returns_none():
    no_value = {**_LLM_RESPONSE, "estimated_deal_value": None}
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=_CRM_LEAD), \
         patch(f"{_MOD}.supabase.get_deal_for_crm_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=no_value), \
         patch(f"{_MOD}.supabase.create_deal", return_value={"id": "deal-3"}) as creator, \
         patch(f"{_MOD}.supabase.update_reply"):
        qualify_deal(_REPLY)

    assert creator.call_args[1]["value"] is None


def test_llm_failure_still_marks_qualified_without_creating_deal():
    with patch(f"{_MOD}.supabase.get_crm_lead_by_email", return_value=_CRM_LEAD), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_deal") as creator, \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = qualify_deal(_REPLY)

    assert result["status"] == "failed"
    creator.assert_not_called()
    assert updater.call_args[1]["deal_qualified"] is True


def test_batch_counts_created_vs_no_match():
    replies = [_REPLY, {**_REPLY, "id": 10, "email": "nomatch@nowhere.com"}]
    with patch(f"{_MOD}.supabase.get_replies_needing_qualification", return_value=replies), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_email", side_effect=[_CRM_LEAD, None]), \
         patch(f"{_MOD}.supabase.get_deal_for_crm_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_deal", return_value={"id": "deal-4"}), \
         patch(f"{_MOD}.supabase.update_reply"):
        summary = qualify_pending_deals()

    assert summary["deals_created"] == 1
    assert summary["no_crm_lead_match"] == 1
