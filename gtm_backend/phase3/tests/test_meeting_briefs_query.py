"""Tests for get_confirmed_meetings_needing_brief's Python-side exclusion
logic (phase3/connectors/supabase.py) — the _get() mini query-DSL doesn't
support subqueries, so this does the "no brief yet" filter as two flat
queries + a set difference instead of a single 'not.in.(select ...)' filter."""
from unittest.mock import patch

from gtm_backend.phase3.connectors import supabase


_MOD = "gtm_backend.phase3.connectors.supabase"


def test_excludes_meetings_that_already_have_a_brief():
    confirmed = [{"id": 1, "status": "confirmed"}, {"id": 2, "status": "confirmed"}]
    briefed = [{"meeting_id": 1}]
    with patch(f"{_MOD}._get", side_effect=[confirmed, briefed]):
        pending = supabase.get_confirmed_meetings_needing_brief()

    assert [m["id"] for m in pending] == [2]


def test_respects_limit_after_exclusion():
    confirmed = [{"id": 1}, {"id": 2}, {"id": 3}]
    briefed = []
    with patch(f"{_MOD}._get", side_effect=[confirmed, briefed]):
        pending = supabase.get_confirmed_meetings_needing_brief(limit=2)

    assert len(pending) == 2


def test_returns_empty_list_when_meetings_table_missing():
    err = supabase.SupabaseError("GET", "/meetings", 404, "Could not find the table 'meetings' in the schema cache")
    with patch(f"{_MOD}._get", side_effect=err):
        assert supabase.get_confirmed_meetings_needing_brief() == []
