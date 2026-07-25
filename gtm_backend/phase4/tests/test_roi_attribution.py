"""Tests for Agent 36 — ROI Attribution. All external IO mocked. No LLM
involved — this agent is pure arithmetic, so tests check the math directly."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_36_roi_attribution import generate_roi_attribution

_MOD = "gtm_backend.phase4.agents.agent_36_roi_attribution"


def _run(
    cost_by_phase=None,
    lead_count=0,
    qualified_deals=None,
    all_deals=None,
    previous_snapshots=None,
):
    with patch(f"{_MOD}.supabase.get_llm_cost_by_phase", return_value=cost_by_phase or {}), \
         patch(f"{_MOD}.supabase.get_lead_count", return_value=lead_count), \
         patch(f"{_MOD}.supabase.get_qualified_deals", return_value=qualified_deals or []), \
         patch(f"{_MOD}.supabase.get_all_deals", return_value=all_deals or []), \
         patch(f"{_MOD}.supabase.get_recent_roi_attribution_snapshots", return_value=previous_snapshots or []), \
         patch(f"{_MOD}.supabase.create_roi_attribution_snapshot", return_value={"id": 1}) as creator:
        result = generate_roi_attribution()
    return result, creator


def test_cost_per_lead_and_per_qualified_deal_math():
    result, creator = _run(
        cost_by_phase={"phase1": 6.0, "phase2": 4.0},
        lead_count=5,
        qualified_deals=[{"id": "d1"}, {"id": "d2"}],
    )
    assert result["total_llm_cost_usd"] == 10.0
    assert result["cost_per_lead"] == 2.0
    assert result["cost_per_qualified_deal"] == 5.0
    kwargs = creator.call_args[1]
    assert kwargs["cost_by_phase"] == {"phase1": 6.0, "phase2": 4.0}


def test_zero_denominator_never_divides_by_zero():
    result, _ = _run(cost_by_phase={"phase1": 10.0}, lead_count=0, qualified_deals=[])
    assert result["cost_per_lead"] is None
    assert result["cost_per_qualified_deal"] is None
    assert result["cost_per_closed_deal"] is None


def test_closed_won_revenue_and_roi_ratio():
    deals = [
        {"id": "d1", "status": "won", "value": 20000},
        {"id": "d2", "status": "closed_won", "value": 5000},
        {"id": "d3", "status": "lost", "value": 9999},   # excluded
        {"id": "d4", "status": "open", "value": 9999},   # excluded
    ]
    result, creator = _run(cost_by_phase={"phase1": 5000.0}, lead_count=10, all_deals=deals)
    kwargs = creator.call_args[1]
    assert kwargs["closed_won_count"] == 2
    assert kwargs["closed_won_revenue"] == 25000.0
    # roi_ratio = (25000 - 5000) / 5000 = 4.0
    assert result["roi_ratio"] == 4.0
    assert result["flagged_negative_roi"] is False


def test_flags_negative_roi_when_cost_exceeds_revenue():
    deals = [{"id": "d1", "status": "won", "value": 100}]
    result, creator = _run(cost_by_phase={"phase1": 5000.0}, lead_count=10, all_deals=deals)
    assert result["roi_ratio"] < 0
    assert result["flagged_negative_roi"] is True
    kwargs = creator.call_args[1]
    assert "Negative ROI this snapshot" in kwargs["limitations_note"]


def test_notes_consistent_negative_roi_across_snapshots():
    deals = [{"id": "d1", "status": "won", "value": 100}]
    result, creator = _run(
        cost_by_phase={"phase1": 5000.0},
        lead_count=10,
        all_deals=deals,
        previous_snapshots=[{"flagged_negative_roi": True}],
    )
    kwargs = creator.call_args[1]
    assert "consistent, not a one-off" in kwargs["limitations_note"]


def test_no_cost_yields_no_roi_ratio_not_a_crash():
    result, creator = _run(cost_by_phase={}, lead_count=5, all_deals=[])
    assert result["total_llm_cost_usd"] == 0.0
    assert result["roi_ratio"] is None
    assert result["flagged_negative_roi"] is False


def test_channel_breakdown_is_single_honest_email_row():
    result, creator = _run(cost_by_phase={"phase1": 10.0}, lead_count=2)
    kwargs = creator.call_args[1]
    assert len(kwargs["channel_breakdown"]) == 1
    assert kwargs["channel_breakdown"][0]["channel"] == "email"


def test_influenced_pipeline_is_none_not_fabricated_zero_with_meaning():
    result, creator = _run(cost_by_phase={"phase1": 10.0}, lead_count=2)
    kwargs = creator.call_args[1]
    assert kwargs["influenced_pipeline_value"] is None
    assert "influenced_pipeline_value is None" in kwargs["limitations_note"]
