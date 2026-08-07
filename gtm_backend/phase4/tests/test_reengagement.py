"""Tests for Agent 41 — Re-engagement. All external IO mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_41_reengagement import run_reengagement

_MOD = "gtm_backend.phase4.agents.agent_41_reengagement"

_OLD_CLOSE_DATE = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()

_DEAL = {
    "id": "deal-1",
    "title": "Acme HR — annual contract",
    "value": 50000,
    "notes": "Lost to budget freeze in Q3.",
    "contact_id": "contact-1",
    "lead_id": "crm-lead-1",
    "close_date": _OLD_CLOSE_DATE,
    "status": "lost",
}

_CONTACT = {"id": "contact-1", "email": "vp@acmehr.com", "name": "Priya"}

_LLM_DRAFT = {
    "content_text": "It's been a while since we last spoke about Acme's HR tooling — wondering if priorities have shifted since the budget freeze lifted.",
    "trigger_reason": "6+ months since the deal stalled on budget — worth checking if that's changed",
    "held": False,
    "held_reason": None,
}


def _run(deals=None, unsubscribed=None, history=None, contact=None, llm_result=None, llm_side_effect=None):
    kwargs = {}
    if llm_side_effect is not None:
        kwargs["side_effect"] = llm_side_effect
    else:
        kwargs["return_value"] = llm_result or _LLM_DRAFT
    resolved_deals = deals if deals is not None else [_DEAL]
    resolved_contact = contact if contact is not None else _CONTACT
    contacts_map = {
        d["contact_id"]: resolved_contact for d in resolved_deals if d.get("contact_id")
    }
    with patch(f"{_MOD}.supabase.get_closed_lost_deals", return_value=resolved_deals), \
         patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=unsubscribed or set()), \
         patch(f"{_MOD}.supabase.get_reengagement_touch_history", return_value=history or []), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value=contacts_map), \
         patch(f"{_MOD}.supabase.create_reengagement_touch", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = run_reengagement()
    return result, creator, chat


def test_opted_out_contact_is_skipped_entirely():
    result, creator, chat = _run(unsubscribed={"vp@acmehr.com"})
    assert result["opted_out"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_first_attempt_past_cooldown_drafts_content():
    result, creator, chat = _run()
    assert result["drafted"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["trigger_reason"] == "6+ months since the deal stalled on budget — worth checking if that's changed"
    assert kwargs["touch_number"] == 1
    assert kwargs["next_eligible_at"] is not None
    assert kwargs["status"] == "draft"


def test_first_attempt_within_cooldown_is_not_yet_eligible():
    recent_deal = dict(_DEAL, close_date=(datetime.now(timezone.utc) - timedelta(days=10)).isoformat())
    result, creator, chat = _run(deals=[recent_deal])
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_not_yet_eligible_when_within_repeat_cooldown():
    future = (datetime.now(timezone.utc) + timedelta(days=60)).isoformat()
    history = [{"status": "draft", "created_at": "2026-01-01T00:00:00+00:00", "next_eligible_at": future}]
    result, creator, chat = _run(history=history)
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_eligible_once_repeat_cooldown_window_has_passed():
    past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    history = [{"status": "draft", "created_at": "2025-01-01T00:00:00+00:00", "next_eligible_at": past}]
    result, creator, chat = _run(history=history)
    assert result["drafted"] == 1
    assert creator.call_args.kwargs["touch_number"] == 2


def test_already_opted_out_via_history_is_not_reprocessed():
    history = [{"status": "opted_out", "created_at": "2026-01-01T00:00:00+00:00", "next_eligible_at": None}]
    result, creator, chat = _run(history=history)
    assert result["opted_out"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_held_when_llm_finds_no_genuine_grounds():
    held = {"content_text": "", "trigger_reason": None, "held": True, "held_reason": "notes give nothing to build on"}
    result, creator, chat = _run(llm_result=held)
    assert result["held"] == 1
    assert creator.call_args.kwargs["status"] == "held"
    assert creator.call_args.kwargs["held_reason"] == "notes give nothing to build on"


def test_llm_failure_does_not_create_a_row():
    result, creator, chat = _run(llm_side_effect=RuntimeError("groq down"))
    assert result["failed"] == 1
    creator.assert_not_called()


def test_deal_with_no_close_or_activity_date_is_held():
    deal_no_date = dict(_DEAL, close_date=None)
    with patch(f"{_MOD}.supabase.get_closed_lost_deals", return_value=[deal_no_date]), \
         patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=set()), \
         patch(f"{_MOD}.supabase.get_reengagement_touch_history", return_value=[]), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value={"contact-1": _CONTACT}), \
         patch(f"{_MOD}.supabase.create_reengagement_touch", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json") as chat:
        result = run_reengagement()
    assert result["held"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_contact_lookup_is_batched_into_one_call_regardless_of_deal_count():
    deal_2 = dict(_DEAL, id="deal-2", contact_id="contact-2")
    contact_2 = {"id": "contact-2", "email": "vp2@acmehr.com", "name": "Rahul"}
    with patch(f"{_MOD}.supabase.get_closed_lost_deals", return_value=[_DEAL, deal_2]), \
         patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=set()), \
         patch(f"{_MOD}.supabase.get_reengagement_touch_history", return_value=[]), \
         patch(f"{_MOD}.supabase.get_contacts_by_ids", return_value={"contact-1": _CONTACT, "contact-2": contact_2}) as contacts_batch, \
         patch(f"{_MOD}.supabase.create_reengagement_touch", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT):
        result = run_reengagement()
    contacts_batch.assert_called_once()
    assert result["drafted"] == 2
