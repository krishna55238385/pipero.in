"""Cal.com connector (Agent 22 — Meeting Booking, PDF Phase 5 — CONVERT).

Cal.com sits in front of the org's actual Google Calendar (connected once,
in the Cal.com dashboard, outside this codebase) and does the scheduling
logic for us — available-slot computation, timezone conversion, double-
booking prevention — so Agent 22 doesn't have to reimplement any of that
against the raw Google Calendar API.

v1 scope (see phase4/agents/agent_22_meeting_booking.py for the full
business-rule mapping): get available slots for the configured event type,
and create a booking. Reminder emails (24h/1h) and no-show/reschedule
handling are configured as Cal.com Workflows in the dashboard for v1, NOT
built here — see the module docstring on agent_22 for why.

Uses Cal.com API v2 (https://cal.com/docs/api-reference/v2/introduction),
authenticated via a plain API key (Authorization: Bearer ...), which is the
simplest of the three auth methods Cal.com supports and sufficient for a
single shared account (no managed-user/OAuth-client complexity needed).
"""
from datetime import datetime, timedelta, timezone

import httpx

from gtm_backend.phase3.core.config import get_settings


_BASE_URL = "https://api.cal.com/v2"
_settings = get_settings()


class CalcomError(RuntimeError):
    """Raised when a Cal.com API call fails for a concrete reason (not just
    'not configured', which callers check separately via is_configured())."""


def is_configured() -> bool:
    return bool(_settings.calcom_api_key and _settings.calcom_event_type_id)


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_settings.calcom_api_key}",
        "Content-Type": "application/json",
        "cal-api-version": "2024-08-13",
    }


def get_available_slots(
    days_ahead: int = 7,
    min_slots: int = 3,
    timezone_name: str = "UTC",
) -> list[str]:
    """Available start times (ISO 8601, UTC) for the configured event type,
    over the next `days_ahead` days, in the given timezone.

    Returns at most `min_slots` slots spread across the window (not just the
    first `min_slots` chronologically) so a prospect proposed 3 options isn't
    just offered three back-to-back times tomorrow morning — PDF business
    rule: "must offer at least 3 time slot options in the prospect's
    timezone." Returns [] (never raises) when not configured or the API
    call fails, so the caller can fall back to a generic "reply to schedule"
    message instead of crashing the whole batch on one Cal.com outage.
    """
    if not is_configured():
        return []

    now = datetime.now(timezone.utc)
    start = now.isoformat()
    end = (now + timedelta(days=days_ahead)).isoformat()

    try:
        resp = httpx.get(
            f"{_BASE_URL}/slots/available",
            params={
                "eventTypeId": _settings.calcom_event_type_id,
                "startTime": start,
                "endTime": end,
                "timeZone": timezone_name,
            },
            headers=_headers(),
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    # Real v2 /slots/available shape, confirmed live 2026-08-07 against the
    # actual API (not the doc's abbreviated schema, which just says
    # "data: object" with no further detail):
    #   {"data": {"slots": {"<date>": [{"time": "..."}]}}}
    # An earlier version of this code assumed {"data": {"<date>":
    # [{"start": "..."}]}} — one level too shallow and the wrong key name —
    # which silently produced [] on every real call (each date's ISO string
    # got iterated as a bare dict value, or worse, iterating dict keys as if
    # they were entries). Kept defensive .get() fallbacks below in case Cal.com
    # changes this shape again; a shape mismatch should degrade to "no slots
    # found" via the outer try/except's callers, not crash.
    slots_by_date = ((data or {}).get("data") or {}).get("slots") or {}
    all_starts: list[str] = []
    for _date, entries in sorted(slots_by_date.items()):
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            start_time = entry.get("time") or entry.get("start")
            if start_time:
                all_starts.append(start_time)

    if len(all_starts) <= min_slots:
        return all_starts
    # Spread the picks evenly across the available window rather than
    # clustering on the earliest day, so the prospect sees real variety.
    step = len(all_starts) / min_slots
    return [all_starts[int(i * step)] for i in range(min_slots)]


def create_booking(
    start_iso: str,
    attendee_email: str,
    attendee_name: str,
    attendee_timezone: str,
    notes: str = "",
) -> dict:
    """Book the meeting at `start_iso` for the given attendee.

    Returns Cal.com's booking object (has 'uid', 'status', 'meetingUrl' among
    other fields) on success. Raises CalcomError on failure — booking is the
    one call in this connector that should NOT fail silently, since a
    swallowed failure here means the prospect thinks they have a meeting and
    they don't.
    """
    if not is_configured():
        raise CalcomError("Cal.com not configured — set CALCOM_API_KEY and CALCOM_EVENT_TYPE_ID")

    payload = {
        "start": start_iso,
        "eventTypeId": _settings.calcom_event_type_id,
        "attendee": {
            "name": attendee_name or attendee_email,
            "email": attendee_email,
            "timeZone": attendee_timezone or "UTC",
        },
        "metadata": {"source": "agent_22_meeting_booking"},
    }
    if notes:
        payload["bookingFieldsResponses"] = {"notes": notes}

    try:
        resp = httpx.post(f"{_BASE_URL}/bookings", json=payload, headers=_headers(), timeout=20)
    except httpx.HTTPError as exc:
        raise CalcomError(f"booking request failed: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise CalcomError(f"{resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return data.get("data", data)


def get_booking(uid: str) -> dict | None:
    """Look up a booking by its Cal.com uid — used to poll for status changes
    (confirmed/cancelled) since webhook receiving lives in the Next.js app,
    not here. Returns None on any failure (never raises) since this is a
    best-effort sync helper, not a critical write path."""
    if not is_configured():
        return None
    try:
        resp = httpx.get(f"{_BASE_URL}/bookings/{uid}", headers=_headers(), timeout=20)
        if resp.status_code != 200:
            return None
        data = resp.json()
        return data.get("data", data)
    except Exception:
        return None
