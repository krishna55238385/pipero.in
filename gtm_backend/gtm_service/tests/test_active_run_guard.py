"""Tests for db.get_active_run_for_icp: the duplicate-concurrent-run guard.

Must fail open (return None, never raise) on missing icp_id or any DB error,
so a guard-check outage never blocks a legitimate pipeline run — same
fail-safe direction as get_org_api_keys, just the opposite default (open vs.
closed) because this guard's failure mode is "block a real run", not "leak a
credential"."""
from unittest.mock import MagicMock, patch

from gtm_backend.gtm_service.db import get_active_run_for_icp

_MOD = "gtm_backend.gtm_service.db"


def test_none_icp_id_returns_none():
    assert get_active_run_for_icp(None) is None


def test_no_active_run_returns_none():
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_cursor.fetchone.return_value = None
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    with patch(f"{_MOD}._get_db_connection", return_value=mock_conn):
        result = get_active_run_for_icp(50)

    assert result is None


def test_active_run_returned(monkeypatch):
    fake_row = {"id": "run-1", "phase": "phase1", "status": "running", "started_at": "2026-08-23T00:00:00Z"}
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_cursor.fetchone.return_value = fake_row
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    with patch(f"{_MOD}._get_db_connection", return_value=mock_conn):
        result = get_active_run_for_icp(50)

    assert result == fake_row


def test_db_error_returns_none_not_raise():
    with patch(f"{_MOD}._get_db_connection", side_effect=RuntimeError("connection refused")):
        result = get_active_run_for_icp(50)
    assert result is None
