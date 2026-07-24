"""Tests for Agent 33 — Pipeline Management. All external IO mocked."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_33_pipeline_management import (
    review_deal,
    run_pipeline_review,
)

_MOD = "gtm_backend.phase4.agents.agent_33_pipeline_management"
_NOW = datetime.now(timezone.utc)


def _ago(days: float) -> str:
    return (_NOW - timedelta(days=days)).isoformat()


_LLM_RESPONSE = {
    "next_best_action": "Send the Q3-renewal-anchored proposal follow-up — it was never opened.",
    "risk_reasoning": "No activity logged in 10 days.",
}


def test_healthy_deal_recent_activity():
    deal = {"id": "deal-1", "title": "Acme HR", "last_activity_at": _ago(1), "notes": "x", "status": "qualified"}
    with patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "healthy"
    assert upserter.call_args[1]["risk_level"] == "healthy"


def test_at_risk_after_7_days_no_activity():
    deal = {"id": "deal-2", "title": "Acme HR", "last_activity_at": _ago(9), "notes": "x", "status": "qualified"}
    with patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "at_risk"
    assert upserter.call_args[1]["risk_level"] == "at_risk"
    assert upserter.call_args[1]["days_since_activity"] == 9


def test_stuck_after_21_days_no_activity():
    deal = {"id": "deal-3", "title": "Acme HR", "last_activity_at": _ago(25), "notes": "x", "status": "qualified"}
    with patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "stuck"
    assert upserter.call_args[1]["risk_level"] == "stuck"


def test_falls_back_to_created_at_when_no_last_activity():
    deal = {"id": "deal-4", "title": "Acme HR", "last_activity_at": None, "created_at": _ago(30), "notes": "x"}
    with patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "stuck"
    assert upserter.call_args[1]["days_since_activity"] == 30


def test_no_timestamps_at_all_defaults_healthy_not_crash():
    deal = {"id": "deal-5", "title": "Acme HR", "notes": "x"}
    with patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "healthy"
    assert upserter.call_args[1]["days_since_activity"] is None


def test_next_best_action_never_empty_even_if_llm_returns_blank():
    deal = {"id": "deal-6", "title": "Acme HR", "last_activity_at": _ago(1), "notes": "x"}
    blank = {"next_best_action": "", "risk_reasoning": ""}
    with patch(f"{_MOD}.llm.chat_json", return_value=blank), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        review_deal(deal)

    assert upserter.call_args[1]["next_best_action"] != ""


def test_llm_failure_does_not_upsert():
    deal = {"id": "deal-7", "title": "Acme HR", "last_activity_at": _ago(1), "notes": "x"}
    with patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status") as upserter:
        result = review_deal(deal)

    assert result["status"] == "failed"
    upserter.assert_not_called()


def test_batch_counts_risk_levels():
    deals = [
        {"id": "deal-1", "title": "A", "last_activity_at": _ago(1), "notes": ""},
        {"id": "deal-2", "title": "B", "last_activity_at": _ago(9), "notes": ""},
        {"id": "deal-3", "title": "C", "last_activity_at": _ago(30), "notes": ""},
    ]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.upsert_pipeline_status"):
        summary = run_pipeline_review()

    assert summary["healthy"] == 1
    assert summary["at_risk"] == 1
    assert summary["stuck"] == 1
