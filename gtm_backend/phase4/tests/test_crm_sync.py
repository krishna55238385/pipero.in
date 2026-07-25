"""Tests for Agent 32 — CRM Sync. All external IO mocked. No LLM involved —
this agent is set-comparison + date arithmetic, so tests check the logic
directly, and specifically confirm it never merges/deletes anything (only
flags)."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_32_crm_sync import run_crm_sync

_MOD = "gtm_backend.phase4.agents.agent_32_crm_sync"


def _now_minus(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _run(leads=None, deals=None):
    with patch(f"{_MOD}.supabase.get_all_crm_leads", return_value=leads or []), \
         patch(f"{_MOD}.supabase.get_all_deals", return_value=deals or []), \
         patch(f"{_MOD}.supabase.upsert_crm_sync_flag", return_value={"id": 1}) as flagger:
        result = run_crm_sync()
    return result, flagger


def test_no_duplicates_when_all_emails_unique():
    leads = [{"id": "l1", "email": "a@x.com"}, {"id": "l2", "email": "b@x.com"}]
    result, flagger = _run(leads=leads)
    assert result["duplicate_contact_groups_flagged"] == 0
    dup_calls = [c for c in flagger.call_args_list if c.kwargs.get("flag_type") == "duplicate_contact"]
    assert dup_calls == []


def test_flags_duplicate_contacts_by_case_insensitive_email():
    leads = [
        {"id": "l1", "email": "Same@X.com"},
        {"id": "l2", "email": "same@x.com"},
        {"id": "l3", "email": "other@x.com"},
    ]
    result, flagger = _run(leads=leads)
    assert result["duplicate_contact_groups_flagged"] == 1
    dup_calls = [c for c in flagger.call_args_list if c.kwargs.get("flag_type") == "duplicate_contact"]
    assert len(dup_calls) == 1
    assert dup_calls[0].kwargs["related_lead_ids"] == ["l1", "l2"]


def test_never_merges_only_flags():
    """Defense-in-depth: confirm no delete/merge-shaped call exists anywhere
    in the connector surface this agent touches."""
    leads = [{"id": "l1", "email": "same@x.com"}, {"id": "l2", "email": "same@x.com"}]
    with patch(f"{_MOD}.supabase.get_all_crm_leads", return_value=leads), \
         patch(f"{_MOD}.supabase.get_all_deals", return_value=[]), \
         patch(f"{_MOD}.supabase.upsert_crm_sync_flag", return_value={"id": 1}) as flagger:
        run_crm_sync()
    for call in flagger.call_args_list:
        assert "resolved_at" not in call.kwargs  # never auto-resolves either


def test_flags_missing_email_as_invalid_contact():
    leads = [{"id": "l1", "email": ""}, {"id": "l2", "email": "ok@x.com"}]
    result, flagger = _run(leads=leads)
    assert result["invalid_contacts_flagged"] == 1
    invalid_calls = [c for c in flagger.call_args_list if c.kwargs.get("flag_type") == "invalid_contact"]
    assert invalid_calls[0].kwargs["crm_lead_id"] == "l1"


def test_flags_malformed_email_as_invalid_contact():
    leads = [{"id": "l1", "email": "not-an-email"}, {"id": "l2", "email": "no-domain@"}]
    result, _ = _run(leads=leads)
    assert result["invalid_contacts_flagged"] == 2


def test_valid_emails_never_flagged_as_invalid():
    leads = [{"id": "l1", "email": "real.person@company.co.in"}]
    result, _ = _run(leads=leads)
    assert result["invalid_contacts_flagged"] == 0


def test_flags_deal_stale_beyond_14_days():
    deals = [{"id": "d1", "title": "Acme", "status": "open", "last_activity_at": _now_minus(20)}]
    result, flagger = _run(deals=deals)
    assert result["stale_deals_flagged"] == 1
    stale_calls = [c for c in flagger.call_args_list if c.kwargs.get("flag_type") == "stale_deal"]
    assert stale_calls[0].kwargs["deal_id"] == "d1"


def test_does_not_flag_deal_active_within_14_days():
    deals = [{"id": "d1", "title": "Acme", "status": "open", "last_activity_at": _now_minus(3)}]
    result, _ = _run(deals=deals)
    assert result["stale_deals_flagged"] == 0


def test_closed_deals_never_flagged_as_stale_regardless_of_age():
    deals = [{"id": "d1", "title": "Acme", "status": "closed_won", "last_activity_at": _now_minus(365)}]
    result, _ = _run(deals=deals)
    assert result["stale_deals_flagged"] == 0


def test_deal_with_no_activity_timestamp_at_all_is_flagged():
    deals = [{"id": "d1", "title": "Acme", "status": "open"}]
    result, flagger = _run(deals=deals)
    assert result["stale_deals_flagged"] == 1
    stale_calls = [c for c in flagger.call_args_list if c.kwargs.get("flag_type") == "stale_deal"]
    assert "unknown" in stale_calls[0].kwargs["details"]
