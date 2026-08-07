"""Regression test for the 'gt.' filter operator in _parse_filter
(phase3/connectors/supabase.py) — found live 2026-08-07: get_replies_for_lead_since
has always built a "gt.<iso>" filter, but the mini PostgREST-style query DSL
only ever implemented is.null/not.is.null/eq./gte./in.(...), never "gt." —
every call raised ValueError, meaning sync_meeting_confirmations crashed on
every single meeting that had a proposed_at set, since the day it was
deployed. Confirmed via a real E2E test run.
"""
import pytest

from gtm_backend.phase3.connectors.supabase import _parse_filter


def test_gt_filter_builds_correct_sql_and_appends_value():
    values: list = []
    clause = _parse_filter("replied_at", "gt.2026-08-07 17:48:07.635591+00:00", values)

    assert clause == "replied_at > %s"
    assert values == ["2026-08-07 17:48:07.635591+00:00"]


def test_gt_filter_does_not_collide_with_gte():
    """'gt.' and 'gte.' must resolve to different operators, not one
    accidentally matching as a prefix of the other."""
    gt_values: list = []
    gte_values: list = []

    gt_clause = _parse_filter("created_at", "gt.2026-01-01", gt_values)
    gte_clause = _parse_filter("created_at", "gte.2026-01-01", gte_values)

    assert gt_clause == "created_at > %s"
    assert gte_clause == "created_at >= %s"


def test_unsupported_operator_still_raises_clean_error():
    """Guard against silently swallowing a genuinely unsupported operator —
    unsupported filters should still fail loudly, just not for 'gt.' anymore."""
    with pytest.raises(ValueError, match="Unsupported filter"):
        _parse_filter("some_col", "lt.2026-01-01", [])
