"""Tests for supabase.bulk_update_leads_raw — Task #6's discovery that this
function's previous INSERT ... ON CONFLICT (id) DO UPDATE implementation
silently fails to detect existing rows as conflicting on the current RDS
instance (reproduced independently via raw psql; unrelated to this
codebase), falling through to an INSERT that violates leads_raw's
company_name NOT NULL constraint. Rewritten as a plain UPDATE ... FROM
(VALUES ...) — the correct operation anyway, since every caller only ever
updates rows it already read, never a genuine upsert-a-new-row case."""
from unittest.mock import MagicMock, patch

from gtm_backend.phase3.connectors import supabase


def _mock_connection():
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor
    return mock_conn, mock_cursor


def test_empty_updates_is_a_no_op():
    with patch.object(supabase, "_get_connection") as conn_mock:
        supabase.bulk_update_leads_raw([])
    conn_mock.assert_not_called()


def test_generates_a_plain_update_not_an_insert_on_conflict():
    """The actual regression guard: this must never again be an
    INSERT ... ON CONFLICT statement, which is what silently broke in
    production despite looking correct in EXPLAIN output."""
    mock_conn, mock_cursor = _mock_connection()
    updates = [
        {"id": 1, "verified": True, "bounce_status": "valid", "last_verified_at": "2026-09-02T00:00:00+00:00", "data_quality_score": 90},
        {"id": 2, "verified": False, "bounce_status": "no_mx", "last_verified_at": "2026-09-02T00:00:00+00:00", "data_quality_score": 40},
    ]
    with patch.object(supabase, "_get_connection", return_value=mock_conn):
        supabase.bulk_update_leads_raw(updates)

    sql = mock_cursor.execute.call_args[0][0]
    assert sql.strip().upper().startswith("UPDATE LEADS_RAW")
    assert "ON CONFLICT" not in sql.upper()
    assert "FROM (VALUES" in sql.upper()
    assert "WHERE LEADS_RAW.ID = V.ID" in sql.upper()
    mock_conn.commit.assert_called_once()


def test_last_verified_at_gets_an_explicit_timestamptz_cast():
    """Regression guard for the second bug found alongside the ON CONFLICT
    one: Postgres inferred `text` for this column from the first row's plain
    ISO string, raising DatatypeMismatch against the real timestamptz
    column."""
    mock_conn, mock_cursor = _mock_connection()
    updates = [{"id": 1, "verified": True, "last_verified_at": "2026-09-02T00:00:00+00:00"}]
    with patch.object(supabase, "_get_connection", return_value=mock_conn):
        supabase.bulk_update_leads_raw(updates)

    sql = mock_cursor.execute.call_args[0][0]
    assert "::timestamptz" in sql


def test_binds_every_row_and_column_value_in_order():
    mock_conn, mock_cursor = _mock_connection()
    updates = [
        {"id": 1, "verified": True, "bounce_status": "valid"},
        {"id": 2, "verified": False, "bounce_status": "no_mx"},
    ]
    with patch.object(supabase, "_get_connection", return_value=mock_conn):
        supabase.bulk_update_leads_raw(updates)

    bound_values = mock_cursor.execute.call_args[0][1]
    assert bound_values == [1, True, "valid", 2, False, "no_mx"]


def test_only_id_column_is_a_no_op():
    """A row dict with nothing but "id" (no fields to update) must not
    attempt to build a SET clause with zero columns."""
    with patch.object(supabase, "_get_connection") as conn_mock:
        supabase.bulk_update_leads_raw([{"id": 1}])
    conn_mock.assert_not_called()


def test_degrades_gracefully_when_leads_raw_table_missing():
    exc = supabase.SupabaseError("PATCH", "/leads_raw", 404, "relation \"leads_raw\" does not exist")
    with patch.object(supabase, "_get_connection", side_effect=exc), \
         patch.object(supabase, "_missing_table", return_value=True):
        supabase.bulk_update_leads_raw([{"id": 1, "verified": True}])  # must not raise


def test_reraises_unrelated_supabase_errors():
    exc = supabase.SupabaseError("PATCH", "/leads_raw", 500, "connection reset")
    with patch.object(supabase, "_get_connection", side_effect=exc), \
         patch.object(supabase, "_missing_table", return_value=False):
        try:
            supabase.bulk_update_leads_raw([{"id": 1, "verified": True}])
            assert False, "expected SupabaseError to propagate"
        except supabase.SupabaseError:
            pass
