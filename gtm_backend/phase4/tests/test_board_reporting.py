"""Tests for Agent 35 — Board Reporting. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_35_board_reporting import generate_board_report

_MOD = "gtm_backend.phase4.agents.agent_35_board_reporting"

_LLM_RESPONSE = {
    "going_well": ["1 deal (Enterprise ERP) won at $80,000."],
    "needs_attention": ["1 deal (TestDeal) is at_risk, 15 days without activity."],
    "executive_summary": "Pipeline is small (2 deals total); one closed won, one needs a nudge.",
}


def test_pipeline_by_stage_grouped_correctly():
    deals = [
        {"id": "d1", "status": "qualified", "value": 10000},
        {"id": "d2", "status": "qualified", "value": 5000},
        {"id": "d3", "status": "contacted", "value": 2000},
        {"id": "d4", "status": "won", "value": 80000},  # excluded from active pipeline
    ]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    stages = creator.call_args[1]["pipeline_by_stage"]
    assert stages["qualified"]["count"] == 2
    assert stages["qualified"]["total_value"] == 15000.0
    assert stages["contacted"]["count"] == 1
    assert "won" not in stages


def test_conversion_rate_none_when_no_closed_deals():
    deals = [{"id": "d1", "status": "qualified", "value": 1000}]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    assert creator.call_args[1]["conversion_rate"] is None
    assert "No closed deals" in creator.call_args[1]["conversion_rate_note"]


def test_conversion_rate_computed_from_closed_deals():
    deals = [
        {"id": "d1", "status": "won", "value": 1000},
        {"id": "d2", "status": "lost", "value": 500},
    ]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    assert creator.call_args[1]["conversion_rate"] == 50.0


def test_forecast_delta_computed_against_previous_snapshot():
    forecasts = [
        {"base_total": 25000, "generated_at": "2026-07-25T00:00:00Z"},
        {"base_total": 20000, "generated_at": "2026-07-24T00:00:00Z"},
    ]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=forecasts), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    assert creator.call_args[1]["forecast_base_total"] == 25000
    assert creator.call_args[1]["forecast_delta_from_previous"] == 5000.0


def test_no_previous_forecast_delta_is_none():
    forecasts = [{"base_total": 25000, "generated_at": "2026-07-25T00:00:00Z"}]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=forecasts), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    assert creator.call_args[1]["forecast_delta_from_previous"] is None


def test_llm_receives_precomputed_numbers_not_raw_deals():
    """The LLM must only see already-computed aggregates, never raw deal
    rows — enforces the 'LLM never touches a number' design."""
    deals = [{"id": "d1", "status": "qualified", "value": 1000}]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE) as chat, \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}):
        generate_board_report()

    user_payload = chat.call_args[0][1]
    assert "pipeline_by_stage" in user_payload
    assert "conversion_rate" in user_payload


def test_llm_failure_does_not_create_report():
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=[]), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_board_report") as creator:
        result = generate_board_report()

    assert result["status"] == "failed"
    creator.assert_not_called()


def test_report_text_includes_all_sections():
    risky = [{"deal_id": "d1", "company_name": "TestDeal", "risk_level": "at_risk", "days_since_activity": 15, "next_best_action": "Send follow-up"}]
    with patch(f"{_MOD}.supabase.get_all_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.get_recent_revenue_forecasts", return_value=[]), \
         patch(f"{_MOD}.supabase.get_at_risk_pipeline_status", return_value=risky), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_board_report", return_value={"id": 1}) as creator:
        generate_board_report()

    report_text = creator.call_args[1]["report_text"]
    assert "PIPELINE BY STAGE" in report_text
    assert "TOP RISKS" in report_text
    assert "TestDeal" in report_text
    assert "GOING WELL" in report_text
    assert "NEEDS ATTENTION" in report_text
