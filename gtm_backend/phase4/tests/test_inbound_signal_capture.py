"""Tests for Agent 38 — Inbound Signal Capture. All external IO mocked. No
LLM involved — this agent is set-comparison/keyword-matching, not judgment."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_38_inbound_signal_capture import run_inbound_signal_capture

_MOD = "gtm_backend.phase4.agents.agent_38_inbound_signal_capture"


def _signal(**overrides) -> dict:
    base = {
        "company_name": "Acme Corp",
        "company_domain": "acme.com",
        "sessions": 3,
        "page_views": 5,
        "signal_strength": "medium",
        "top_pages": ["/blog/hiring-tips"],
    }
    base.update(overrides)
    return base


def _run(signals, existing_lead=None):
    with patch(f"{_MOD}.supabase.get_website_visitor_signals", return_value=signals), \
         patch(f"{_MOD}.supabase.get_lead_by_company_domain", return_value=existing_lead), \
         patch(f"{_MOD}.supabase.create_inbound_lead", return_value={"id": 99}) as creator, \
         patch(f"{_MOD}.supabase.upsert_inbound_signal_capture", return_value={"id": 1}) as upserter:
        result = run_inbound_signal_capture()
    return result, creator, upserter


def test_single_session_is_held_not_promoted():
    result, creator, upserter = _run([_signal(sessions=1)])
    assert result["held_single_session"] == 1
    assert result["new_leads_created"] == 0
    creator.assert_not_called()
    assert upserter.call_args.kwargs["status"] == "held"


def test_two_plus_sessions_with_no_existing_lead_creates_new_lead():
    result, creator, upserter = _run([_signal(sessions=2)])
    assert result["new_leads_created"] == 1
    creator.assert_called_once()
    kwargs = creator.call_args.kwargs
    assert kwargs["lead_channel"] == "inbound_signal"
    assert upserter.call_args.kwargs["status"] == "promoted"


def test_existing_lead_gets_linked_not_duplicated():
    result, creator, upserter = _run([_signal()], existing_lead={"id": 5, "score_tier": "warm"})
    assert result["linked_to_existing"] == 1
    assert result["new_leads_created"] == 0
    creator.assert_not_called()
    assert upserter.call_args.kwargs["promoted_lead_id"] == 5


def test_existing_lead_already_cold_is_held_not_promoted():
    result, creator, upserter = _run([_signal()], existing_lead={"id": 5, "score_tier": "cold"})
    assert result["held_known_cold"] == 1
    creator.assert_not_called()
    assert upserter.call_args.kwargs["status"] == "held"


def test_existing_lead_already_disqualified_is_held():
    result, _, _ = _run([_signal()], existing_lead={"id": 5, "score_tier": "disqualified"})
    assert result["held_known_cold"] == 1


def test_pricing_page_flagged_high_intent():
    result, creator, upserter = _run([_signal(top_pages=["/pricing", "/home"])])
    assert upserter.call_args.kwargs["high_intent_pages_hit"] is True


def test_case_study_page_flagged_high_intent():
    _run([_signal(top_pages=["/customers/case-study-acme"])])


def test_blog_only_pages_not_flagged_high_intent():
    result, creator, upserter = _run([_signal(top_pages=["/blog/some-post"])])
    assert upserter.call_args.kwargs["high_intent_pages_hit"] is False


def test_no_signals_does_not_crash():
    result, creator, upserter = _run([])
    assert result["signals_examined"] == 0
    assert result["new_leads_created"] == 0
    creator.assert_not_called()
