"""Tests for phase3/connectors/gmail_oauth.py's inbox-reading additions
(Task #35 — real inbox-polling reply ingestion). All external IO mocked.
"""
import base64
from unittest.mock import patch

from gtm_backend.phase3.connectors import gmail_oauth

_MAILBOX = {
    "id": "mb-1",
    "email": "eibel@trymagnivo.in",
    "provider": "gmail",
    "refresh_token": "rt-123",
    "access_token": "at-valid",
    "expires_at": "2099-01-01T00:00:00+00:00",
}


def _fake_settings():
    return type("S", (), {"google_client_id": "id", "google_client_secret": "secret"})()


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode()


def test_list_inbox_replies_returns_empty_when_not_configured():
    with patch.object(gmail_oauth, "_settings", type("S", (), {"google_client_id": None, "google_client_secret": None})()):
        assert gmail_oauth.list_inbox_replies() == []


def test_list_inbox_replies_returns_empty_when_no_mailbox():
    with patch.object(gmail_oauth, "_settings", _fake_settings()), \
         patch.object(gmail_oauth, "_get_mailbox", return_value=None):
        assert gmail_oauth.list_inbox_replies() == []


def test_list_inbox_replies_excludes_own_sent_address_and_parses_body():
    list_resp = type("R", (), {
        "status_code": 200,
        "json": lambda self: {"messages": [{"id": "m1"}, {"id": "m2"}]},
    })()
    msg1 = {
        "id": "m1",
        "threadId": "t1",
        "internalDate": "1723000000000",
        "payload": {
            "headers": [
                {"name": "From", "value": "Priya <priya@acmehr.com>"},
                {"name": "Subject", "value": "Re: quick question"},
            ],
            "mimeType": "text/plain",
            "body": {"data": _b64("Sounds great, let's talk.")},
        },
    }
    # m2 is from OUR OWN mailbox (e.g. a self-sent draft/copy) — must be excluded.
    msg2 = {
        "id": "m2",
        "threadId": "t2",
        "internalDate": "1723000001000",
        "payload": {
            "headers": [{"name": "From", "value": "eibel@trymagnivo.in"}],
            "mimeType": "text/plain",
            "body": {"data": _b64("self note")},
        },
    }

    def fake_get(url, headers=None, params=None, timeout=None):
        if url == gmail_oauth._GMAIL_MESSAGES_URL:
            return list_resp
        if url.endswith("/m1"):
            return type("R", (), {"status_code": 200, "json": lambda self: msg1})()
        if url.endswith("/m2"):
            return type("R", (), {"status_code": 200, "json": lambda self: msg2})()
        raise AssertionError(f"unexpected URL {url}")

    with patch.object(gmail_oauth, "_settings", _fake_settings()), \
         patch.object(gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gmail_oauth.httpx, "get", side_effect=fake_get):
        results = gmail_oauth.list_inbox_replies(days_back=3, max_results=25)

    assert len(results) == 1
    assert results[0]["message_id"] == "m1"
    assert results[0]["thread_id"] == "t1"
    assert results[0]["from_email"] == "priya@acmehr.com"
    assert results[0]["body_text"] == "Sounds great, let's talk."


def test_list_inbox_replies_returns_empty_on_list_failure():
    fail_resp = type("R", (), {"status_code": 500, "text": "server error"})()
    with patch.object(gmail_oauth, "_settings", _fake_settings()), \
         patch.object(gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gmail_oauth.httpx, "get", return_value=fail_resp):
        assert gmail_oauth.list_inbox_replies() == []


def test_extract_email_pulls_address_out_of_display_name_header():
    assert gmail_oauth._extract_email("Priya Sharma <priya@acmehr.com>") == "priya@acmehr.com"
    assert gmail_oauth._extract_email("priya@acmehr.com") == "priya@acmehr.com"
    assert gmail_oauth._extract_email("") == ""
    assert gmail_oauth._extract_email("not an email") == ""


def test_extract_body_text_prefers_plain_over_html():
    payload = {
        "mimeType": "multipart/alternative",
        "parts": [
            {"mimeType": "text/html", "body": {"data": _b64("<p>HTML body</p>")}},
            {"mimeType": "text/plain", "body": {"data": _b64("Plain body")}},
        ],
    }
    assert gmail_oauth._extract_body_text(payload) == "Plain body"


def test_extract_body_text_falls_back_to_html_when_no_plain_part():
    payload = {
        "mimeType": "text/html",
        "body": {"data": _b64("<p>Only HTML here</p>")},
    }
    assert gmail_oauth._extract_body_text(payload) == "Only HTML here"


def test_extract_body_text_returns_empty_for_unparseable_payload():
    assert gmail_oauth._extract_body_text({}) == ""


def test_internal_date_to_iso_parses_gmail_epoch_millis():
    iso = gmail_oauth._internal_date_to_iso("1723000000000")
    assert iso is not None
    assert iso.startswith("2024-")


def test_internal_date_to_iso_returns_none_for_missing_or_bad_input():
    assert gmail_oauth._internal_date_to_iso(None) is None
    assert gmail_oauth._internal_date_to_iso("not-a-number") is None
