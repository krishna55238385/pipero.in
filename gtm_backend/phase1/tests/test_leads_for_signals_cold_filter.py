"""Tests for get_leads_for_signals()'s exclude_cold filtering (SerpAPI usage
reduction — Task from the 2026-08-19 quota audit). All external IO mocked.
"""
from unittest.mock import patch

from gtm_backend.phase1.connectors import supabase

_LEADS = [
    {"id": 1, "company_name": "Hot Co", "score_tier": "hot"},
    {"id": 2, "company_name": "Warm Co", "score_tier": "warm"},
    {"id": 3, "company_name": "Cold Co", "score_tier": "cold"},
    {"id": 4, "company_name": "New Co", "score_tier": None},
]


def test_exclude_cold_defaults_to_true_and_drops_cold_tier_leads():
    with patch.object(supabase, "_get", return_value=_LEADS):
        leads = supabase.get_leads_for_signals(limit=50, icp_id=1)

    names = {l["company_name"] for l in leads}
    assert names == {"Hot Co", "Warm Co", "New Co"}
    assert "Cold Co" not in names


def test_exclude_cold_never_drops_unscored_null_tier_leads():
    """Unscored (score_tier IS NULL) leads must always pass through — this is
    what keeps brand-new leads' first-ever signal detection unaffected, since
    signals run BEFORE scoring in the pipeline."""
    with patch.object(supabase, "_get", return_value=_LEADS):
        leads = supabase.get_leads_for_signals(limit=50, icp_id=1)

    assert any(l["company_name"] == "New Co" for l in leads)


def test_exclude_cold_false_returns_everything_including_cold():
    with patch.object(supabase, "_get", return_value=_LEADS):
        leads = supabase.get_leads_for_signals(limit=50, icp_id=1, exclude_cold=False)

    names = {l["company_name"] for l in leads}
    assert names == {"Hot Co", "Warm Co", "Cold Co", "New Co"}
