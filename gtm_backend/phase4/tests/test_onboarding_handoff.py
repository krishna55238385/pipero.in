"""Tests for Agent 39 — Onboarding Handoff. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_39_onboarding_handoff import (
    generate_handoff,
    generate_pending_handoffs,
)

_MOD = "gtm_backend.phase4.agents.agent_39_onboarding_handoff"

_DEAL = {
    "id": "deal-1", "lead_id": "crm-uuid-1", "title": "Acme HR — inbound interest",
    "status": "won", "value": 15000.0,
    "notes": "States a Q3 renewal deadline and personal sign-off authority.",
}

_LLM_DRAFT = {
    "handoff_brief": "Full brief text here covering everything the delivery team needs...",
    "what_was_promised": "Onboarding support and Q3-ready rollout per the proposal.",
    "success_criteria": "Live before Q3 renewal deadline.",
    "key_stakeholders": ["VP Ops (economic buyer)"],
    "communication_preference": "prefers email",
}


def test_skips_deal_that_already_has_a_handoff():
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as chat, \
         patch(f"{_MOD}.supabase.create_onboarding_handoff") as creator:
        result = generate_handoff(_DEAL)

    assert result["status"] == "already_exists"
    chat.assert_not_called()
    creator.assert_not_called()


def test_drafts_handoff_grounded_in_notes_proposal_and_brief():
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"proposal_text": "Our platform..."}), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value={"brief_text": "Executive case..."}), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value={"email": "vp@acme.com", "name": "Jane Doe"}), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT), \
         patch(f"{_MOD}.supabase.create_onboarding_handoff", return_value={"id": 5}) as creator:
        result = generate_handoff(_DEAL)

    assert result["status"] == "drafted"
    kwargs = creator.call_args.kwargs
    assert kwargs["deal_id"] == "deal-1"
    assert kwargs["status"] == "draft"
    assert kwargs["primary_contact_email"] == "vp@acme.com"
    assert kwargs["primary_contact_name"] == "Jane Doe"
    assert kwargs["key_stakeholders"] == ["VP Ops (economic buyer)"]


def test_held_when_no_notes_proposal_or_brief_exist():
    no_evidence_deal = {**_DEAL, "notes": ""}
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json") as chat, \
         patch(f"{_MOD}.supabase.create_onboarding_handoff", return_value={"id": 6}) as creator:
        result = generate_handoff(no_evidence_deal)

    assert result["status"] == "held"
    chat.assert_not_called()
    assert creator.call_args.kwargs["held_reason"] == "no deal notes, proposal, or executive brief to build a handoff from"


def test_held_when_llm_returns_empty_brief():
    empty = {**_LLM_DRAFT, "handoff_brief": ""}
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"proposal_text": "x"}), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=empty), \
         patch(f"{_MOD}.supabase.create_onboarding_handoff", return_value={"id": 7}) as creator:
        result = generate_handoff(_DEAL)

    assert result["status"] == "held"
    assert creator.call_args.kwargs["status"] == "held"


def test_llm_failure_does_not_create_a_row_and_can_retry_later():
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"proposal_text": "x"}), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_onboarding_handoff") as creator:
        result = generate_handoff(_DEAL)

    assert result["status"] == "failed"
    creator.assert_not_called()


def test_never_fabricates_stakeholders_list_if_llm_omits_it():
    malformed = {**_LLM_DRAFT}
    del malformed["key_stakeholders"]
    with patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"proposal_text": "x"}), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=malformed), \
         patch(f"{_MOD}.supabase.create_onboarding_handoff", return_value={"id": 8}) as creator:
        generate_handoff(_DEAL)

    assert creator.call_args.kwargs["key_stakeholders"] == []


def test_only_won_and_closed_won_deals_are_examined_not_open_ones():
    deals = [
        {**_DEAL, "id": "d1", "status": "won"},
        {**_DEAL, "id": "d2", "status": "closed_won"},
        {**_DEAL, "id": "d3", "status": "open"},
        {**_DEAL, "id": "d4", "status": "lost"},
    ]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as chat:
        summary = generate_pending_handoffs()

    assert summary["won_deals_examined"] == 2
    chat.assert_not_called()  # both already had handoffs in this mock


def test_batch_counts_drafted_vs_held_vs_existing():
    deals = [
        {**_DEAL, "id": "deal-1"},
        {**_DEAL, "id": "deal-2"},
        {**_DEAL, "id": "deal-3"},
    ]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(
             f"{_MOD}.supabase.get_handoff_for_deal",
             side_effect=[None, None, {"id": 99}],
         ), \
         patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"proposal_text": "x"}), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.supabase.get_crm_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=[_LLM_DRAFT, {**_LLM_DRAFT, "handoff_brief": ""}]), \
         patch(f"{_MOD}.supabase.create_onboarding_handoff", return_value={"id": 1}):
        summary = generate_pending_handoffs()

    assert summary["drafted"] == 1
    assert summary["held"] == 1
    assert summary["already_exists"] == 1
