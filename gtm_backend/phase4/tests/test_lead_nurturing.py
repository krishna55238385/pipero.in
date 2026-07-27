"""Tests for Agent 40 — Lead Nurturing. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_40_lead_nurturing import run_lead_nurturing

_MOD = "gtm_backend.phase4.agents.agent_40_lead_nurturing"

_REPLY = {"id": 1, "lead_id": 10, "email": "vp@acme.com", "company_name": "Acme", "replied_at": "2026-01-01T00:00:00+00:00"}

_LLM_DRAFT = {
    "content_text": "Saw HR-tech budgets are shifting toward automation this quarter — worth a look at how peers are prioritizing.",
    "content_topic": "HR-tech budget trends",
    "held": False,
    "held_reason": None,
}


def _run(replies=None, unsubscribed=None, history=None, signals=None, lead_row=None, account_intel=None, llm_result=None, llm_side_effect=None):
    kwargs = {}
    if llm_side_effect is not None:
        kwargs["side_effect"] = llm_side_effect
    else:
        kwargs["return_value"] = llm_result or _LLM_DRAFT
    with patch(f"{_MOD}.supabase.get_not_now_replies", return_value=replies if replies is not None else [_REPLY]), \
         patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=unsubscribed or set()), \
         patch(f"{_MOD}.supabase.get_nurture_touch_history", return_value=history or []), \
         patch(f"{_MOD}.supabase.get_signals_since", return_value=signals or []), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=account_intel or {}), \
         patch(f"{_MOD}.supabase.get_lead_raw_by_id", return_value=lead_row or {"score_tier": "warm"}), \
         patch(f"{_MOD}.supabase.create_nurture_touch", return_value={"id": 1}) as creator, \
         patch(f"{_MOD}.llm.chat_json", **kwargs) as chat:
        result = run_lead_nurturing()
    return result, creator, chat


def test_opted_out_lead_is_skipped_entirely():
    result, creator, chat = _run(unsubscribed={"vp@acme.com"})
    assert result["opted_out"] == 1
    creator.assert_not_called()
    chat.assert_not_called()


def test_fresh_buying_signal_converts_lead_out_of_nurture_without_drafting():
    result, creator, chat = _run(signals=[{"signal_type": "funding"}])
    assert result["converted_by_signal"] == 1
    chat.assert_not_called()
    assert creator.call_args.kwargs["status"] == "converted"


def test_no_longer_valid_icp_pauses_nurture():
    result, creator, chat = _run(lead_row={"score_tier": "disqualified"})
    assert result["paused_invalid_icp"] == 1
    chat.assert_not_called()
    assert creator.call_args.kwargs["status"] == "paused"


def test_first_touch_drafts_content():
    result, creator, chat = _run()
    assert result["drafted"] == 1
    kwargs = creator.call_args.kwargs
    assert kwargs["content_topic"] == "HR-tech budget trends"
    assert kwargs["touch_number"] == 1
    assert kwargs["next_eligible_at"] is not None


def test_previous_topics_are_passed_to_prevent_repeats():
    history = [{"content_topic": "Q3 hiring trends", "created_at": "2026-01-01T00:00:00+00:00",
                "status": "draft", "next_eligible_at": "2025-01-01T00:00:00+00:00"}]
    _run(history=history)
    sent_payload = None
    with patch(f"{_MOD}.supabase.get_not_now_replies", return_value=[_REPLY]), \
         patch(f"{_MOD}.supabase.get_unsubscribed_emails", return_value=set()), \
         patch(f"{_MOD}.supabase.get_nurture_touch_history", return_value=history), \
         patch(f"{_MOD}.supabase.get_signals_since", return_value=[]), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value={}), \
         patch(f"{_MOD}.supabase.get_lead_raw_by_id", return_value={"score_tier": "warm"}), \
         patch(f"{_MOD}.supabase.create_nurture_touch", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_DRAFT) as chat:
        run_lead_nurturing()
    call_args = chat.call_args[0]
    assert "Q3 hiring trends" in call_args[1]


def test_not_yet_eligible_when_within_30_day_cadence():
    from datetime import datetime, timedelta, timezone
    future = (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()
    history = [{"content_topic": "X", "created_at": "2026-01-01T00:00:00+00:00", "status": "draft", "next_eligible_at": future}]
    result, creator, chat = _run(history=history)
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()
    creator.assert_not_called()


def test_eligible_once_cadence_window_has_passed():
    from datetime import datetime, timedelta, timezone
    past = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    history = [{"content_topic": "X", "created_at": "2025-01-01T00:00:00+00:00", "status": "draft", "next_eligible_at": past}]
    result, creator, chat = _run(history=history)
    assert result["drafted"] == 1
    assert creator.call_args.kwargs["touch_number"] == 2


def test_already_converted_lead_is_not_reprocessed():
    history = [{"content_topic": None, "created_at": "2026-01-01T00:00:00+00:00", "status": "converted", "next_eligible_at": None}]
    result, creator, chat = _run(history=history)
    assert result["not_yet_eligible"] == 1
    chat.assert_not_called()


def test_held_when_llm_finds_no_genuine_value():
    held = {"content_text": "", "content_topic": None, "held": True, "held_reason": "nothing new to say yet"}
    result, creator, chat = _run(llm_result=held)
    assert result["held"] == 1
    assert creator.call_args.kwargs["status"] == "draft"
    assert creator.call_args.kwargs["held_reason"] == "nothing new to say yet"


def test_llm_failure_does_not_create_a_row():
    result, creator, chat = _run(llm_side_effect=RuntimeError("groq down"))
    assert result["failed"] == 1
    creator.assert_not_called()
