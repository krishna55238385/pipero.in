"""Tests for Agent 25 — Proposal Generation. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_25_proposal_generation import (
    generate_pending_proposals,
    generate_proposal,
)

_MOD = "gtm_backend.phase4.agents.agent_25_proposal_generation"

_DEAL = {
    "id": "deal-1", "lead_id": "crm-uuid-1", "title": "Acme HR — inbound interest",
    "status": "qualified", "value": 12000.0,
    "notes": "States a Q3 renewal deadline and personal sign-off authority. BANT: budget=yes, authority=yes, need=yes, timing=yes",
}

_LLM_DRAFT = {
    "proposal_text": "Given your Q3 renewal deadline, here's how we help you hit it...",
    "pain_points_referenced": ["Q3 renewal deadline"],
    "held": False,
    "held_reason": None,
}

_LLM_HELD = {
    "proposal_text": "",
    "pain_points_referenced": [],
    "held": True,
    "held_reason": "No specific stated pain point in the deal notes.",
}


def test_skips_deal_that_already_has_a_proposal():
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as chat, \
         patch(f"{_MOD}.supabase.create_deal_proposal") as creator:
        result = generate_proposal(_DEAL)

    assert result["status"] == "already_exists"
    chat.assert_not_called()
    creator.assert_not_called()


def test_drafts_proposal_with_expiry_and_pain_points():
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT), \
         patch(f"{_MOD}.supabase.create_deal_proposal", return_value={"id": 5}) as creator:
        result = generate_proposal(_DEAL)

    assert result["status"] == "drafted"
    kwargs = creator.call_args[1]
    assert kwargs["deal_id"] == "deal-1"
    assert kwargs["status"] == "draft"
    assert kwargs["proposal_text"].startswith("Given your Q3")
    assert kwargs["pain_points_referenced"] == ["Q3 renewal deadline"]
    assert kwargs["expires_at"] is not None


def test_holds_when_llm_finds_no_real_pain_point():
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_HELD), \
         patch(f"{_MOD}.supabase.create_deal_proposal", return_value={"id": 6}) as creator:
        result = generate_proposal(_DEAL)

    assert result["status"] == "held"
    kwargs = creator.call_args[1]
    assert kwargs["status"] == "held"
    assert kwargs["proposal_text"] == ""
    assert kwargs["expires_at"] is None


def test_empty_proposal_text_treated_as_held_even_if_held_flag_false():
    """Defense in depth: even if the LLM forgets to set held=True, an empty
    proposal_text must never be persisted as a sendable draft."""
    sloppy = {"proposal_text": "", "pain_points_referenced": [], "held": False, "held_reason": None}
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=sloppy), \
         patch(f"{_MOD}.supabase.create_deal_proposal", return_value={"id": 7}) as creator:
        result = generate_proposal(_DEAL)

    assert result["status"] == "held"
    assert creator.call_args[1]["status"] == "held"


def test_llm_failure_does_not_create_a_row_and_can_retry_later():
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_deal_proposal") as creator:
        result = generate_proposal(_DEAL)

    assert result["status"] == "failed"
    creator.assert_not_called()


def test_never_fabricates_pain_points_list_if_llm_omits_it():
    malformed = {"proposal_text": "Some text", "held": False, "held_reason": None}  # no pain_points_referenced key
    with patch(f"{_MOD}.supabase.get_proposal_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=malformed), \
         patch(f"{_MOD}.supabase.create_deal_proposal", return_value={"id": 8}) as creator:
        generate_proposal(_DEAL)

    assert creator.call_args[1]["pain_points_referenced"] == []


def test_batch_counts_drafted_vs_held_vs_existing():
    deals = [
        _DEAL,
        {**_DEAL, "id": "deal-2"},
        {**_DEAL, "id": "deal-3"},
    ]
    with patch(f"{_MOD}.supabase.get_qualified_deals", return_value=deals), \
         patch(
             f"{_MOD}.supabase.get_proposal_for_deal",
             side_effect=[None, None, {"id": 99}],
         ), \
         patch(f"{_MOD}.llm.chat_json", side_effect=[_LLM_DRAFT, _LLM_HELD]), \
         patch(f"{_MOD}.supabase.create_deal_proposal", return_value={"id": 1}):
        summary = generate_pending_proposals()

    assert summary["drafted"] == 1
    assert summary["held"] == 1
    assert summary["already_exists"] == 1
