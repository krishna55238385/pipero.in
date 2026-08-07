"""Tests for phase3/connectors/calcom.py — the Cal.com API client backing
Agent 22 (Meeting Booking). All HTTP calls are mocked; no real network access.
"""
import types
from unittest.mock import patch

import pytest

from gtm_backend.phase3.connectors import calcom


def _settings(**over):
    base = dict(calcom_api_key="cal_live_x", calcom_event_type_id=123)
    base.update(over)
    return types.SimpleNamespace(**base)


def test_not_configured_without_api_key():
    with patch.object(calcom, "_settings", _settings(calcom_api_key=None)):
        assert calcom.is_configured() is False


def test_not_configured_without_event_type_id():
    with patch.object(calcom, "_settings", _settings(calcom_event_type_id=None)):
        assert calcom.is_configured() is False


def test_configured_with_both_set():
    with patch.object(calcom, "_settings", _settings()):
        assert calcom.is_configured() is True


def test_get_available_slots_returns_empty_when_not_configured():
    with patch.object(calcom, "_settings", _settings(calcom_api_key=None)):
        assert calcom.get_available_slots() == []


def test_get_available_slots_returns_empty_on_http_error():
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.get", side_effect=RuntimeError("network down")):
        assert calcom.get_available_slots() == []


def test_get_available_slots_picks_at_least_min_slots_spread_out():
    fake_data = {
        "data": {
            "2026-08-10": [{"start": f"2026-08-10T{h:02d}:00:00Z"} for h in range(9, 17)],
            "2026-08-11": [{"start": f"2026-08-11T{h:02d}:00:00Z"} for h in range(9, 17)],
        }
    }
    fake_resp = types.SimpleNamespace(
        raise_for_status=lambda: None, json=lambda: fake_data,
    )
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.get", return_value=fake_resp):
        slots = calcom.get_available_slots(min_slots=3, timezone_name="Asia/Kolkata")

    assert len(slots) == 3
    # Spread, not just the first 3 chronologically off one day.
    assert len(set(slots)) == 3


def test_get_available_slots_returns_all_when_fewer_than_min():
    fake_data = {"data": {"2026-08-10": [{"start": "2026-08-10T09:00:00Z"}]}}
    fake_resp = types.SimpleNamespace(raise_for_status=lambda: None, json=lambda: fake_data)
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.get", return_value=fake_resp):
        slots = calcom.get_available_slots(min_slots=3)

    assert slots == ["2026-08-10T09:00:00Z"]


def test_create_booking_raises_when_not_configured():
    with patch.object(calcom, "_settings", _settings(calcom_api_key=None)):
        with pytest.raises(calcom.CalcomError):
            calcom.create_booking("2026-08-10T09:00:00Z", "a@b.com", "A Co", "UTC")


def test_create_booking_success():
    fake_resp = types.SimpleNamespace(
        status_code=201,
        json=lambda: {"data": {"uid": "abc123", "status": "accepted"}},
    )
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.post", return_value=fake_resp) as post_mock:
        booking = calcom.create_booking("2026-08-10T09:00:00Z", "a@b.com", "A Co", "UTC", notes="context")

    assert booking["uid"] == "abc123"
    kwargs = post_mock.call_args.kwargs
    assert kwargs["json"]["attendee"]["email"] == "a@b.com"
    assert kwargs["json"]["eventTypeId"] == 123


def test_create_booking_raises_on_non_2xx():
    fake_resp = types.SimpleNamespace(status_code=400, text="bad request")
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.post", return_value=fake_resp):
        with pytest.raises(calcom.CalcomError):
            calcom.create_booking("2026-08-10T09:00:00Z", "a@b.com", "A Co", "UTC")


def test_get_booking_returns_none_when_not_configured():
    with patch.object(calcom, "_settings", _settings(calcom_api_key=None)):
        assert calcom.get_booking("abc123") is None


def test_get_booking_returns_none_on_404():
    fake_resp = types.SimpleNamespace(status_code=404)
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.get", return_value=fake_resp):
        assert calcom.get_booking("missing") is None


def test_get_booking_success():
    fake_resp = types.SimpleNamespace(status_code=200, json=lambda: {"data": {"uid": "abc123"}})
    with patch.object(calcom, "_settings", _settings()), \
         patch("httpx.get", return_value=fake_resp):
        booking = calcom.get_booking("abc123")
    assert booking["uid"] == "abc123"
