"""Tests for get_confirmed_meetings_past_due() — backs Agent 22's no-show
detector (Task #45, 2026-08-19). All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.connectors import supabase


def test_queries_confirmed_meetings_before_cutoff():
    with patch.object(supabase, "_get", return_value=[{"id": 5, "status": "confirmed"}]) as get_mock:
        rows = supabase.get_confirmed_meetings_past_due("2026-08-19T00:00:00+00:00")

    assert rows == [{"id": 5, "status": "confirmed"}]
    args, kwargs = get_mock.call_args
    assert args[0] == "/meetings"
    assert kwargs["params"]["status"] == "eq.confirmed"
    assert kwargs["params"]["scheduled_at"] == "lt.2026-08-19T00:00:00+00:00"


def test_respects_limit():
    with patch.object(supabase, "_get", return_value=[]) as get_mock:
        supabase.get_confirmed_meetings_past_due("2026-08-19T00:00:00+00:00", limit=10)

    assert get_mock.call_args[1]["params"]["limit"] == 10


def test_returns_empty_when_no_matches():
    with patch.object(supabase, "_get", return_value=[]):
        assert supabase.get_confirmed_meetings_past_due("2026-08-19T00:00:00+00:00") == []


def test_degrades_gracefully_when_table_missing():
    exc = supabase.SupabaseError("GET", "/meetings", 404, "relation \"meetings\" does not exist")
    with patch.object(supabase, "_get", side_effect=exc), \
         patch.object(supabase, "_missing_table", return_value=True):
        assert supabase.get_confirmed_meetings_past_due("2026-08-19T00:00:00+00:00") == []
