"""Tests for Agent 27 — Executive Engagement. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_27_executive_engagement import (
    generate_executive_brief,
    generate_pending_executive_briefs,
)

_MOD = "gtm_backend.phase4.agents.agent_27_executive_engagement"

_DEAL_WITH_CHAMPION = {
    "id": "deal-1", "lead_id": "crm-uuid-1", "title": "Acme HR — inbound interest",
    "status": "qualified", "value": 12000.0,
    "notes": "States a Q3 renewal deadline and personal sign-off authority. BANT: budget=yes, authority=yes, need=yes, timing=yes",
}

_DEAL_NO_CHAMPION = {
    **_DEAL_WITH_CHAMPION, "id": "deal-2",
    "notes": "Sounds interesting. BANT: budget=unknown, authority=unknown, need=yes, timing=unknown",
}

_LLM_DRAFT = {
    "brief_text": "Acme HR faces a Q3 renewal deadline that puts hiring velocity at risk...",
    "business_outcome_summary": "Avoids a Q3 compliance gap by locking in the renewal early.",
    "peer_reference": None,
    "held": False,
    "held_reason": None,
}

_LLM_HELD = {
    "brief_text": "",
    "business_outcome_summary": "",
    "peer_reference": None,
    "held": True,
    "held_reason": "No credible business case evidence beyond a bare positive reply.",
}


def test_skips_deal_with_no_champion_authority_signal():
    with patch(f"{_MOD}.supabase.get_brief_for_deal") as getter, \
         patch(f"{_MOD}.llm.chat_json") as chat, \
         patch(f"{_MOD}.supabase.create_executive_brief") as creator:
        result = generate_executive_brief(_DEAL_NO_CHAMPION)

    assert result["status"] == "skipped_no_champion_signal"
    getter.assert_not_called()
    chat.assert_not_called()
    creator.assert_not_called()


def test_skips_deal_that_already_has_a_brief():
    with patch(f"{_MOD}.supabase.get_brief_for_deal", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as chat, \
         patch(f"{_MOD}.supabase.create_executive_brief") as creator:
        result = generate_executive_brief(_DEAL_WITH_CHAMPION)

    assert result["status"] == "already_exists"
    chat.assert_not_called()
    creator.assert_not_called()


def test_drafts_brief_grounded_in_evidence():
    with patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT), \
         patch(f"{_MOD}.supabase.create_executive_brief", return_value={"id": 9}) as creator:
        result = generate_executive_brief(_DEAL_WITH_CHAMPION)

    assert result["status"] == "drafted"
    kwargs = creator.call_args[1]
    assert kwargs["status"] == "draft"
    assert kwargs["brief_text"].startswith("Acme HR faces")
    assert kwargs["peer_reference"] is None


def test_holds_when_no_credible_business_case():
    with patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_HELD), \
         patch(f"{_MOD}.supabase.create_executive_brief", return_value={"id": 10}) as creator:
        result = generate_executive_brief(_DEAL_WITH_CHAMPION)

    assert result["status"] == "held"
    assert creator.call_args[1]["status"] == "held"
    assert creator.call_args[1]["brief_text"] == ""
    assert creator.call_args[1]["peer_reference"] is None


def test_never_fabricates_peer_reference_when_llm_omits_it():
    malformed = {"brief_text": "Some brief.", "business_outcome_summary": "x", "held": False, "held_reason": None}
    with patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=malformed), \
         patch(f"{_MOD}.supabase.create_executive_brief", return_value={"id": 11}) as creator:
        generate_executive_brief(_DEAL_WITH_CHAMPION)

    assert creator.call_args[1]["peer_reference"] is None


def test_llm_failure_does_not_create_a_row():
    with patch(f"{_MOD}.supabase.get_brief_for_deal", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_executive_brief") as creator:
        result = generate_executive_brief(_DEAL_WITH_CHAMPION)

    assert result["status"] == "failed"
    creator.assert_not_called()


def test_batch_counts_all_outcomes():
    deals = [_DEAL_WITH_CHAMPION, {**_DEAL_WITH_CHAMPION, "id": "deal-3"}, _DEAL_NO_CHAMPION]
    with patch(f"{_MOD}.supabase.get_qualified_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_brief_for_deal", side_effect=[None, {"id": 1}]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT), \
         patch(f"{_MOD}.supabase.create_executive_brief", return_value={"id": 1}):
        summary = generate_pending_executive_briefs()

    assert summary["drafted"] == 1
    assert summary["already_exists"] == 1
    assert summary["skipped_no_champion_signal"] == 1
