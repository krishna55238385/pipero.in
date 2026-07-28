"""Tests for Agent 44 — Referral. All external IO mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_44_referral import run_referral

_MOD = "gtm_backend.phase4.agents.agent_44_referral"

_OLD_HANDOFF_DATE = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()

_DEAL = {
    "id": "deal-1",
    "title": "Acme HR — annual contract",
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
    "content_text": "Glad the 30% time-to-hire improvement landed — know any other fast-growing HR-tech companies with a distributed hiring team who'd benefit the same way?",
    "forwardable_intro_text": "Hi [name], wanted to introduce you to the team at [seller] — they helped us cut time-to-hire by 30%. Thought it might be useful for you too.",
    "target_description": "another fast-growing HR-tech company with a distributed hiring team",
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
         patch(f"{_MOD}.supabase.get_referral_history", return_value=history or []), \
         patch(f"{_MOD}.supabase.get_handoff_for_deal", return_value=effective_handoff), \
         patch(f"{_MOD}.supabase.get_org_product_description", return_value="AI GTM automation"), \
         patch(f"{_MOD}.supabase.create_referral_request", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = run_referral()
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


def test_within_60_day_cooldown_is_not_yet_eligible():
    recent_handoff = dict(_HANDOFF, created_at=(datetime.now(timezone.utc) - timedelta(days=10)).isoformat())
    result, creator, chat = _run(handoff=recent_handoff)
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_onboarded_and_past_cooldown_drafts_referral():
    result, creator, chat = _run()
    assert result["drafted"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["status"] == "draft"
    assert kwargs["target_description"] == "another fast-growing HR-tech company with a distributed hiring team"
    assert kwargs["forwardable_intro_text"]
    assert kwargs["contact_id"] == "contact-1"


def test_held_when_success_not_proven():
    thin = {"content_text": "", "forwardable_intro_text": "", "target_description": None, "held": True, "held_reason": "too early to claim success"}
    result, creator, chat = _run(llm_result=thin)
    assert result["held"] == 1
    assert creator.call_args.kwargs["held_reason"] == "too early to claim success"


def test_missing_forwardable_intro_still_counts_as_held():
    partial = {"content_text": "some ask", "forwardable_intro_text": "", "target_description": "x", "held": False, "held_reason": None}
    result, creator, chat = _run(llm_result=partial)
    assert result["held"] == 1


def test_llm_failure_does_not_create_a_row():
    result, creator, chat = _run(llm_side_effect=RuntimeError("groq down"))
    assert result["failed"] == 1
    creator.assert_not_called()
