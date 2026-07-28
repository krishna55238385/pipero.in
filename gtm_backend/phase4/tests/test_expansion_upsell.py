"""Tests for Agent 43 — Expansion & Upsell. All external IO mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_43_expansion_upsell import run_expansion_upsell

_MOD = "gtm_backend.phase4.agents.agent_43_expansion_upsell"

_OLD_HANDOFF_DATE = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()

_DEAL = {
    "id": "deal-1",
    "title": "Acme HR — annual contract",
    "value": 50000,
    "contact_id": "contact-1",
    "organization_id": "org-1",
    "status": "won",
    "close_date": _OLD_HANDOFF_DATE,
}

_HANDOFF = {
    "deal_id": "deal-1",
    "company_name": "Acme HR",
    "status": "confirmed",
    "what_was_promised": "Faster hiring pipeline automation",
    "success_criteria": "Time-to-hire reduced by 30%",
    "created_at": _OLD_HANDOFF_DATE,
}

_LLM_DRAFT = {
    "content_text": "Since your hiring pipeline automation went live, a few teams have started asking about extending it to onboarding too — worth a quick chat?",
    "opportunity_type": "new_use_case",
    "held": False,
    "held_reason": None,
}


_UNSET = object()


def _run(deals=None, history=None, handoff=_UNSET, llm_result=None, llm_side_effect=None):
    kwargs = {}
    if llm_side_effect is not None:
        kwargs["side_effect"] = llm_side_effect
    else:
        kwargs["return_value"] = llm_result if llm_result is not None else _LLM_DRAFT
    effective_handoff = _HANDOFF if handoff is _UNSET else handoff
    with patch(f"{_MOD}.supabase.get_won_deals_with_contacts", return_value=deals if deals is not None else [_DEAL]), \
         patch(f"{_MOD}.supabase.get_expansion_history", return_value=history or []), \
         patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=effective_handoff), \
         patch(f"{_MOD}.supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.supabase.create_expansion_opportunity", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = run_expansion_upsell()
    return result, creator, chat


def test_already_checked_deal_is_skipped_entirely():
    result, creator, chat = _run(history=[{"status": "held"}])
    assert result["already_checked"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_no_handoff_means_not_onboarded_yet():
    result, creator, chat = _run(handoff=None)
    assert result["not_onboarded_yet"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_draft_handoff_status_means_not_onboarded_yet():
    result, creator, chat = _run(handoff=dict(_HANDOFF, status="draft"))
    assert result["not_onboarded_yet"] == 1
    chat.assert_not_called()


def test_within_60_day_cooldown_is_not_yet_eligible():
    recent_handoff = dict(_HANDOFF, created_at=(datetime.now(timezone.utc) - timedelta(days=10)).isoformat())
    result, creator, chat = _run(handoff=recent_handoff)
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_onboarded_and_past_cooldown_drafts_opportunity():
    result, creator, chat = _run()
    assert result["drafted"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["status"] == "draft"
    assert kwargs["opportunity_type"] == "new_use_case"
    assert kwargs["contact_id"] == "contact-1"


def test_held_when_evidence_is_thin():
    thin = {"content_text": "", "opportunity_type": "unclear", "held": True, "held_reason": "no real evidence of value delivered yet"}
    result, creator, chat = _run(llm_result=thin)
    assert result["held"] == 1
    assert creator.call_args.kwargs["held_reason"] == "no real evidence of value delivered yet"


def test_llm_failure_does_not_create_a_row():
    result, creator, chat = _run(llm_side_effect=RuntimeError("groq down"))
    assert result["failed"] == 1
    creator.assert_not_called()


def test_delivered_status_also_counts_as_onboarded():
    result, creator, chat = _run(handoff=dict(_HANDOFF, status="delivered"))
    assert result["drafted"] == 1
