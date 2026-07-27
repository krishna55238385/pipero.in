"""Tests for Agent 37 — Data Refresh. All external IO mocked (including
disify, the deliverability API — no real HTTP call, no LLM)."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_37_data_refresh import run_data_refresh

_MOD = "gtm_backend.phase4.agents.agent_37_data_refresh"


def _days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _run(leads, verify_result=None):
    with patch(f"{_MOD}.supabase.get_leads_for_data_refresh", return_value=leads), \
         patch(f"{_MOD}.supabase.update_lead_raw") as updater, \
         patch(f"{_MOD}.supabase.create_data_quality_report", return_value={"id": 1}) as reporter, \
         patch(f"{_MOD}.disify.verify_email", return_value=verify_result or {"verified": True, "bounce_status": "valid"}) as verifier:
        result = run_data_refresh()
    return result, updater, reporter, verifier


def test_never_verified_lead_gets_reverified():
    leads = [{"id": 1, "company_name": "Acme", "contact_email": "a@acme.com", "last_verified_at": None, "bounce_status": None}]
    result, updater, _, verifier = _run(leads)
    assert result["reverified_count"] == 1
    verifier.assert_called_once_with("a@acme.com")
    assert updater.call_args.kwargs["verified"] is True


def test_recently_verified_valid_lead_is_skipped():
    leads = [{
        "id": 1, "company_name": "Acme", "contact_email": "a@acme.com",
        "last_verified_at": _days_ago(5), "bounce_status": "valid", "verified": True,
    }]
    result, _, _, verifier = _run(leads)
    assert result["reverified_count"] == 0
    verifier.assert_not_called()


def test_stale_beyond_90_days_gets_reverified():
    leads = [{
        "id": 1, "company_name": "Acme", "contact_email": "a@acme.com",
        "last_verified_at": _days_ago(120), "bounce_status": "valid", "verified": True,
    }]
    result, _, _, verifier = _run(leads)
    assert result["reverified_count"] == 1
    verifier.assert_called_once()


def test_bounced_status_triggers_immediate_reverification_regardless_of_age():
    leads = [{
        "id": 1, "company_name": "Acme", "contact_email": "a@acme.com",
        "last_verified_at": _days_ago(1), "bounce_status": "no_mx", "verified": False,
    }]
    result, _, _, verifier = _run(leads)
    assert result["reverified_count"] == 1
    verifier.assert_called_once()


def test_data_quality_score_full_marks_for_complete_fresh_valid_lead():
    leads = [{
        "id": 1, "company_name": "Acme", "contact_email": "a@acme.com",
        "contact_name": "Jane", "contact_title": "VP Sales", "company_domain": "acme.com",
        "last_verified_at": None, "bounce_status": None,
    }]
    _, updater, _, _ = _run(leads, verify_result={"verified": True, "bounce_status": "valid"})
    assert updater.call_args.kwargs["data_quality_score"] == 100


def test_data_quality_score_low_for_bare_minimum_lead():
    leads = [{"id": 1, "company_name": "Acme", "contact_email": "a@acme.com", "last_verified_at": None, "bounce_status": None}]
    _, updater, _, _ = _run(leads, verify_result={"verified": False, "bounce_status": "no_mx"})
    # email present (+20) + just-refreshed freshness (+10, earned regardless of
    # outcome since it WAS just checked) = 30. Not verified/valid, no name,
    # title, or domain, so nothing else scores.
    assert updater.call_args.kwargs["data_quality_score"] == 30


def test_bounce_rate_computed_correctly():
    leads = [
        {"id": 1, "company_name": "A", "contact_email": "a@a.com", "last_verified_at": None, "bounce_status": None},
        {"id": 2, "company_name": "B", "contact_email": "b@b.com", "last_verified_at": None, "bounce_status": None},
    ]
    with patch(f"{_MOD}.supabase.get_leads_for_data_refresh", return_value=leads), \
         patch(f"{_MOD}.supabase.update_lead_raw"), \
         patch(f"{_MOD}.supabase.create_data_quality_report", return_value={"id": 1}), \
         patch(f"{_MOD}.disify.verify_email", side_effect=[
             {"verified": True, "bounce_status": "valid"},
             {"verified": False, "bounce_status": "no_mx"},
         ]):
        result = run_data_refresh()
    assert result["bounce_rate"] == 50.0


def test_no_leads_does_not_crash():
    result, _, reporter, verifier = _run([])
    assert result["leads_examined"] == 0
    assert result["avg_quality_score"] is None
    assert result["bounce_rate"] is None
    verifier.assert_not_called()
    reporter.assert_called_once()
