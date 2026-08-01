"""Tests for db.get_org_api_keys: must fail closed (all-None, never raise)
whenever organization_id is missing, the encryption secret isn't configured,
or the DB call itself fails — every case falls through to the platform's own
default keys rather than breaking a pipeline run."""
import os
from unittest.mock import MagicMock, patch

from gtm_backend.gtm_service.db import get_org_api_keys

_MOD = "gtm_backend.gtm_service.db"


def test_no_organization_id_returns_all_none():
    result = get_org_api_keys(None)
    assert result == {"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}


def test_missing_encryption_secret_returns_all_none(monkeypatch):
    monkeypatch.delenv("API_KEY_ENCRYPTION_SECRET", raising=False)
    result = get_org_api_keys("org-1")
    assert result == {"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}


def test_decrypts_and_groups_rows_by_provider(monkeypatch):
    monkeypatch.setenv("API_KEY_ENCRYPTION_SECRET", "test-secret")
    fake_rows = [
        {"provider": "serpapi", "key": "decrypted-serp-key", "model": None},
        {"provider": "openrouter", "key": "decrypted-or-key", "model": "deepseek/deepseek-v4-flash"},
    ]
    mock_cursor = MagicMock()
    mock_cursor.__enter__.return_value = mock_cursor
    mock_cursor.fetchall.return_value = fake_rows
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value = mock_cursor

    with patch(f"{_MOD}._get_db_connection", return_value=mock_conn):
        result = get_org_api_keys("org-1")

    assert result == {
        "serpapi_key": "decrypted-serp-key",
        "openrouter_key": "decrypted-or-key",
        "openrouter_model": "deepseek/deepseek-v4-flash",
    }


def test_db_error_returns_all_none_not_raise(monkeypatch):
    monkeypatch.setenv("API_KEY_ENCRYPTION_SECRET", "test-secret")
    with patch(f"{_MOD}._get_db_connection", side_effect=RuntimeError("connection refused")):
        result = get_org_api_keys("org-1")
    assert result == {"serpapi_key": None, "openrouter_key": None, "openrouter_model": None}
