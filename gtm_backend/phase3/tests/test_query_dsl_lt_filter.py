"""Regression test for the 'lt.'/'lte.' filter operators in _parse_filter
(phase3/connectors/supabase.py) — same class of bug as 'gt.' (see
test_query_dsl_gt_filter.py, found live 2026-08-07): the mini PostgREST-style
query DSL never implemented 'lt.' at all. get_confirmed_meetings_past_due()
(Task #45's no-show detector) has always built a "lt.<iso>" filter, so every
real call to detect-no-shows raised ValueError — caught live 2026-08-19
running it manually, not by Task #45's own test suite, since
test_meetings_past_due.py mocks _get() directly and never exercises
_parse_filter.
"""
from gtm_backend.phase3.connectors.supabase import _parse_filter


def test_lt_filter_builds_correct_sql_and_appends_value():
    values: list = []
    clause = _parse_filter("scheduled_at", "lt.2026-08-19 09:05:55.345718+00:00", values)

    assert clause == "scheduled_at < %s"
    assert values == ["2026-08-19 09:05:55.345718+00:00"]


def test_lte_filter_builds_correct_sql_and_appends_value():
    values: list = []
    clause = _parse_filter("scheduled_at", "lte.2026-08-19", values)

    assert clause == "scheduled_at <= %s"
    assert values == ["2026-08-19"]


def test_lt_filter_does_not_collide_with_lte():
    """'lt.' and 'lte.' must resolve to different operators, not one
    accidentally matching as a prefix of the other."""
    lt_values: list = []
    lte_values: list = []

    lt_clause = _parse_filter("created_at", "lt.2026-01-01", lt_values)
    lte_clause = _parse_filter("created_at", "lte.2026-01-01", lte_values)

    assert lt_clause == "created_at < %s"
    assert lte_clause == "created_at <= %s"
