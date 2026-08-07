"""Tests for phase3/connectors/gmail_oauth.py's mailbox lookup + token refresh.

Regression coverage for a real bug found live 2026-08-07: this file used to
call Supabase's hosted REST API directly (httpx against
{SUPABASE_URL}/rest/v1/engage_mailboxes), which is the OLD convention from
before phase3 migrated to direct RDS access. Once SUPABASE_URL on the server
was repointed at a local PostgREST instance (part of the ongoing
Supabase->RDS migration), that hardcoded /rest/v1/ path 404'd on every call —
is_configured() silently returned False forever, so Agent 14 never sent a
single real email; every attempt fell back to dry-run/skip (confirmed via
outreach_log: 0 'sent' rows out of 16, all-time).

The fix routes _get_mailbox() and the token-refresh persist through
phase3/connectors/supabase.py's existing _get()/_patch() helpers — the same
direct-RDS path every other phase3 table read/write already uses — instead
of a raw httpx call. These tests lock in that both touchpoints go through
supabase._get/_patch, not raw HTTP, so this class of bug can't silently
reappear if SUPABASE_URL's meaning changes again.
"""
from unittest.mock import patch

from gtm_backend.phase3.connectors import gmail_oauth


_MAILBOX = {
    "id": "mb-1",
    "email": "eibel@trymagnivo.in",
    "provider": "gmail",
    "refresh_token": "rt-123",
    "access_token": "at-expired",
    "expires_at": "2020-01-01T00:00:00+00:00",  # already expired
}


def test_get_mailbox_goes_through_supabase_get_not_raw_http():
    """_get_mailbox must call supabase._get(...) — never httpx directly."""
    with patch.object(gmail_oauth._sb, "_get", return_value=[_MAILBOX]) as get_mock, \
         patch.object(gmail_oauth, "httpx") as httpx_mock:
        mailbox = gmail_oauth._get_mailbox()

    get_mock.assert_called_once()
    args, kwargs = get_mock.call_args
    assert args[0] == "engage_mailboxes"
    assert kwargs["params"]["provider"] == "eq.gmail"
    assert mailbox == _MAILBOX
    httpx_mock.get.assert_not_called()


def test_get_mailbox_returns_none_when_no_rows():
    with patch.object(gmail_oauth._sb, "_get", return_value=[]):
        assert gmail_oauth._get_mailbox() is None


def test_get_mailbox_returns_none_on_error_not_raises():
    """A DB error (e.g. still-missing table) must degrade to 'not configured',
    never crash the caller — mirrors is_configured()'s defensive contract."""
    with patch.object(gmail_oauth._sb, "_get", side_effect=RuntimeError("db down")):
        assert gmail_oauth._get_mailbox() is None


def test_is_configured_true_when_creds_and_mailbox_present():
    fake_settings = type("S", (), {
        "google_client_id": "id", "google_client_secret": "secret",
    })()
    with patch.object(gmail_oauth, "_settings", fake_settings), \
         patch.object(gmail_oauth, "_get_mailbox", return_value=_MAILBOX):
        assert gmail_oauth.is_configured() is True


def test_is_configured_false_when_mailbox_missing():
    fake_settings = type("S", (), {
        "google_client_id": "id", "google_client_secret": "secret",
    })()
    with patch.object(gmail_oauth, "_settings", fake_settings), \
         patch.object(gmail_oauth, "_get_mailbox", return_value=None):
        assert gmail_oauth.is_configured() is False


def test_refresh_access_token_persists_via_supabase_patch_not_raw_http():
    """Token refresh must persist the new token through supabase._patch(...),
    never a raw httpx.patch against /rest/v1/."""
    fake_resp = type("R", (), {
        "status_code": 200,
        "json": lambda self: {"access_token": "new-at", "expires_in": 3600},
    })()
    with patch.object(gmail_oauth.httpx, "post", return_value=fake_resp), \
         patch.object(gmail_oauth._sb, "_patch") as patch_mock:
        token = gmail_oauth._refresh_access_token(_MAILBOX)

    assert token == "new-at"
    patch_mock.assert_called_once()
    args, kwargs = patch_mock.call_args
    assert args[0] == "engage_mailboxes"
    assert kwargs["params"] == {"id": "eq.mb-1"}
    assert kwargs["json_body"]["access_token"] == "new-at"


def test_refresh_access_token_still_returns_token_if_persist_fails():
    """Persisting the refreshed token is best-effort — a DB error here must
    not prevent the send from proceeding with the freshly-obtained token."""
    fake_resp = type("R", (), {
        "status_code": 200,
        "json": lambda self: {"access_token": "new-at", "expires_in": 3600},
    })()
    with patch.object(gmail_oauth.httpx, "post", return_value=fake_resp), \
         patch.object(gmail_oauth._sb, "_patch", side_effect=RuntimeError("db down")):
        token = gmail_oauth._refresh_access_token(_MAILBOX)

    assert token == "new-at"
