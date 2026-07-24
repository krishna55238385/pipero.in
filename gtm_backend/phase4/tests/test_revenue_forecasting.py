"""Tests for Agent 34 — Revenue Forecasting. All external IO mocked. No LLM
involved — this agent is pure arithmetic, so tests check the math directly."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_34_revenue_forecasting import generate_revenue_forecast

_MOD = "gtm_backend.phase4.agents.agent_34_revenue_forecasting"


def test_excludes_deals_below_30_percent_probability():
    deals = [
        {"id": "d1", "title": "A", "value": 10000, "probability": 50},
        {"id": "d2", "title": "B", "value": 5000, "probability": 20},  # excluded
    ]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}) as creator:
        result = generate_revenue_forecast()

    assert result["committed_deal_count"] == 1
    assert result["excluded_deal_count"] == 1
    kwargs = creator.call_args[1]
    assert len(kwargs["deal_breakdown"]) == 1
    assert kwargs["deal_breakdown"][0]["deal_id"] == "d1"


def test_excludes_deals_with_no_value_or_no_probability():
    deals = [
        {"id": "d1", "title": "A", "value": None, "probability": 80},
        {"id": "d2", "title": "B", "value": 5000, "probability": None},
    ]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}):
        result = generate_revenue_forecast()

    assert result["committed_deal_count"] == 0
    assert result["excluded_deal_count"] == 2


def test_forecast_math_is_correct():
    # value=10000, probability=50 -> weighted = 5000
    # conservative = 5000 * 0.8 = 4000
    # base = 5000
    # optimistic = 10000 * min(50*1.25, 100)/100 = 10000 * 0.625 = 6250
    deals = [{"id": "d1", "title": "A", "value": 10000, "probability": 50}]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}) as creator:
        result = generate_revenue_forecast()

    assert result["conservative_total"] == 4000.0
    assert result["base_total"] == 5000.0
    assert result["optimistic_total"] == 6250.0
    kwargs = creator.call_args[1]
    assert kwargs["deal_breakdown"][0]["weighted_value"] == 5000.0


def test_optimistic_never_exceeds_full_value_even_at_high_probability():
    # probability=90 -> 90*1.25=112.5, clamped to 100 -> optimistic = full value
    deals = [{"id": "d1", "title": "A", "value": 20000, "probability": 90}]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}):
        result = generate_revenue_forecast()

    assert result["optimistic_total"] == 20000.0


def test_no_active_deals_returns_zeroed_forecast():
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}) as creator:
        result = generate_revenue_forecast()

    assert result["conservative_total"] == 0.0
    assert result["base_total"] == 0.0
    assert result["optimistic_total"] == 0.0
    assert result["total_deal_count"] == 0
    assert creator.call_args[1]["deal_breakdown"] == []


def test_persists_snapshot_row_every_run_append_only():
    """No idempotency check here on purpose — every run should insert a new
    snapshot row (unlike pipeline_status's upsert), so history accumulates."""
    deals = [{"id": "d1", "title": "A", "value": 1000, "probability": 40}]
    with patch(f"{_MOD}.supabase.get_active_deals", return_value=deals), \
         patch(f"{_MOD}.supabase.create_revenue_forecast", return_value={"id": 1}) as creator:
        generate_revenue_forecast()
        generate_revenue_forecast()

    assert creator.call_count == 2
