"""Tests for phase3/connectors/google_calendar.py (Agent 22's booking
backend, replacing calcom.py — see that module's docstring for why). All
external IO mocked.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from gtm_backend.phase3.connectors import google_calendar as gcal

_MAILBOX = {"id": "mb-1", "email": "eibel@trymagnivo.in", "refresh_token": "rt-1"}


def test_is_configured_delegates_to_gmail_oauth():
    with patch.object(gcal.gmail_oauth, "is_configured", return_value=True):
        assert gcal.is_configured() is True
    with patch.object(gcal.gmail_oauth, "is_configured", return_value=False):
        assert gcal.is_configured() is False


def test_get_available_slots_returns_empty_when_not_configured():
    with patch.object(gcal, "is_configured", return_value=False):
        assert gcal.get_available_slots() == []


def test_get_available_slots_excludes_busy_periods():
    """A freebusy response covering the whole first business day should push
    the first available slot to the next weekday."""
    now = datetime.now(timezone.utc)
    busy_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    freebusy_resp = type("R", (), {
        "status_code": 200,
        "raise_for_status": lambda self: None,
        "json": lambda self: {
            "calendars": {
                "primary": {
                    "busy": [
                        {
                            "start": busy_start.isoformat(),
                            "end": (busy_start + timedelta(days=3)).isoformat(),
                        }
                    ]
                }
            }
        },
    })()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=freebusy_resp):
        slots = gcal.get_available_slots(days_ahead=7, min_slots=3, business_timezone="UTC")

    for slot in slots:
        dt = datetime.fromisoformat(slot.replace("Z", "+00:00"))
        assert dt >= busy_start + timedelta(days=3)


def test_get_available_slots_returns_at_most_min_slots():
    empty_freebusy = type("R", (), {
        "status_code": 200,
        "raise_for_status": lambda self: None,
        "json": lambda self: {"calendars": {"primary": {"busy": []}}},
    })()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=empty_freebusy):
        slots = gcal.get_available_slots(days_ahead=7, min_slots=3)

    assert len(slots) <= 3
    assert len(slots) > 0


def test_get_available_slots_respects_custom_business_hours():
    """Per-org business hours (2026-08-19): a narrower window than the
    9am-5pm default must actually constrain which hours slots come from."""
    empty_freebusy = type("R", (), {
        "status_code": 200,
        "raise_for_status": lambda self: None,
        "json": lambda self: {"calendars": {"primary": {"busy": []}}},
    })()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=empty_freebusy):
        slots = gcal.get_available_slots(
            days_ahead=7, min_slots=50,
            business_timezone="UTC", business_start_hour=13, business_end_hour=15,
        )

    for slot in slots:
        dt = datetime.fromisoformat(slot.replace("Z", "+00:00"))
        assert 13 <= dt.hour < 15


def test_get_available_slots_skips_weekends():
    empty_freebusy = type("R", (), {
        "status_code": 200,
        "raise_for_status": lambda self: None,
        "json": lambda self: {"calendars": {"primary": {"busy": []}}},
    })()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=empty_freebusy):
        slots = gcal.get_available_slots(days_ahead=14, min_slots=50)

    for slot in slots:
        dt = datetime.fromisoformat(slot.replace("Z", "+00:00"))
        assert dt.weekday() < 5


def test_get_available_slots_returns_empty_on_api_failure():
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", side_effect=RuntimeError("network down")):
        assert gcal.get_available_slots() == []


def test_create_booking_raises_when_not_configured():
    with patch.object(gcal, "is_configured", return_value=False):
        try:
            gcal.create_booking("2026-08-10T09:00:00+00:00", "a@b.com", "Acme", "UTC")
            assert False, "expected CalendarError"
        except gcal.CalendarError:
            pass


def test_create_booking_success_returns_uid_status_meeting_url():
    ok_resp = type("R", (), {
        "status_code": 200,
        "json": lambda self: {"id": "evt-1", "status": "confirmed", "hangoutLink": "https://meet.google.com/xyz"},
    })()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=ok_resp) as post_mock:
        result = gcal.create_booking(
            "2026-08-10T09:00:00+00:00", "prospect@acme.com", "Acme HR", "America/New_York",
        )

    assert result == {"uid": "evt-1", "status": "confirmed", "meetingUrl": "https://meet.google.com/xyz"}
    _, kwargs = post_mock.call_args
    assert kwargs["params"]["sendUpdates"] == "all"
    assert kwargs["json"]["attendees"] == [{"email": "prospect@acme.com"}]
    assert kwargs["json"]["reminders"]["overrides"][0]["minutes"] == 1440
    assert kwargs["json"]["reminders"]["overrides"][1]["minutes"] == 60


def test_create_booking_raises_calendar_error_on_bad_status():
    fail_resp = type("R", (), {"status_code": 403, "text": "insufficient scope"})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "post", return_value=fail_resp):
        try:
            gcal.create_booking("2026-08-10T09:00:00+00:00", "a@b.com", "Acme", "UTC")
            assert False, "expected CalendarError"
        except gcal.CalendarError as exc:
            assert "403" in str(exc)


def test_create_booking_raises_on_invalid_start_iso():
    with patch.object(gcal, "is_configured", return_value=True):
        try:
            gcal.create_booking("not-a-date", "a@b.com", "Acme", "UTC")
            assert False, "expected CalendarError"
        except gcal.CalendarError:
            pass


def test_get_booking_returns_none_when_not_configured():
    with patch.object(gcal, "is_configured", return_value=False):
        assert gcal.get_booking("evt-1") is None


def test_get_booking_returns_none_without_uid():
    with patch.object(gcal, "is_configured", return_value=True):
        assert gcal.get_booking("") is None


def test_get_booking_returns_event_on_success():
    ok_resp = type("R", (), {"status_code": 200, "json": lambda self: {"id": "evt-1"}})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "get", return_value=ok_resp):
        result = gcal.get_booking("evt-1")

    assert result == {"id": "evt-1"}


def test_get_booking_returns_none_on_failure_status():
    fail_resp = type("R", (), {"status_code": 404})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "get", return_value=fail_resp):
        assert gcal.get_booking("evt-1") is None


def test_cancel_booking_returns_false_when_not_configured():
    with patch.object(gcal, "is_configured", return_value=False):
        assert gcal.cancel_booking("evt-1") is False


def test_cancel_booking_returns_false_without_uid():
    with patch.object(gcal, "is_configured", return_value=True):
        assert gcal.cancel_booking("") is False
        assert gcal.cancel_booking(None) is False


def test_cancel_booking_returns_true_on_success():
    ok_resp = type("R", (), {"status_code": 204})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "delete", return_value=ok_resp) as delete_mock:
        assert gcal.cancel_booking("evt-1") is True

    args, kwargs = delete_mock.call_args
    assert args[0].endswith("/evt-1")
    assert kwargs["params"]["sendUpdates"] == "all"


def test_cancel_booking_returns_true_when_already_gone():
    """A 404 (already deleted / never existed) is treated as success — the
    desired end state (not on the calendar) is already true either way."""
    gone_resp = type("R", (), {"status_code": 404})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "delete", return_value=gone_resp):
        assert gcal.cancel_booking("evt-1") is True


def test_cancel_booking_returns_false_on_real_failure():
    fail_resp = type("R", (), {"status_code": 500})()
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "delete", return_value=fail_resp):
        assert gcal.cancel_booking("evt-1") is False


def test_cancel_booking_returns_false_on_network_error():
    with patch.object(gcal, "is_configured", return_value=True), \
         patch.object(gcal.gmail_oauth, "_get_mailbox", return_value=_MAILBOX), \
         patch.object(gcal.gmail_oauth, "_access_token", return_value="tok"), \
         patch.object(gcal.httpx, "delete", side_effect=RuntimeError("network down")):
        assert gcal.cancel_booking("evt-1") is False
