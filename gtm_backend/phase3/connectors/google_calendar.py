"""Google Calendar connector (Agent 22 — Meeting Booking, PDF Phase 5 — CONVERT).

Direct Google Calendar API integration, replacing the earlier Cal.com-based
v1 (kept in calcom.py, now unused by agent_22 — see its module docstring for
the "why"): Cal.com v1 was one shared account for the WHOLE platform, which
became a real cross-tenant bug the moment a second org needed its own
calendar — every org's meetings would land on the same calendar, offered to
different prospects, under one org's branding. This connector instead reuses
the SAME per-org OAuth mailbox connection Agent 14/16 already use for Gmail
(gmail_oauth._get_mailbox(), now itself org-scoped — see that file's
_get_mailbox() docstring). One Google OAuth grant now covers both sending
mail and managing calendar events; no separate calendar-specific connection
step for the org to go through, and each org's meetings land on THEIR OWN
real calendar automatically.

Requires the Calendar scope (https://www.googleapis.com/auth/calendar.events)
to have been granted at OAuth-connect time (see magnivo.ai's
getGoogleScopes()). Mailboxes connected BEFORE this scope was added to the
CRM's OAuth request need to reconnect once to pick it up — Google does not
retroactively grant new scopes to an existing refresh_token; a Calendar call
against an old token will fail with a 403 (degrades to "no slots"/raises
CalendarError same as any other failure, not a special-cased error path).

v1 scope: freebusy-based availability within a fixed Mon-Fri 9am-5pm window
(no per-org working-hours config yet — a real follow-up, same class of gap
as Cal.com v1's shared-account shortcut) and direct event creation with a
Google Meet link. Reminder overrides are set on the event (24h/1h before,
email) as a best-effort nod to the PDF's reminder rule, but — unlike Cal.com's
dashboard Workflows, which fired an explicit, brand-controlled email to the
attendee — these are Calendar's own native reminder mechanism and are not a
guaranteed substitute for every attendee/calendar-provider combination. Not
claimed as "solved," just an improvement over doing nothing.
"""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from gtm_backend.phase3.connectors import gmail_oauth

_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

_DEFAULT_DURATION_MINUTES = 30
_BUSINESS_START_HOUR = 9
_BUSINESS_END_HOUR = 17


class CalendarError(RuntimeError):
    """Raised when a Calendar API call fails for a concrete reason (not just
    'not configured', which callers check separately via is_configured())."""


def is_configured() -> bool:
    """True iff a mailbox is connected with OAuth creds — same check as
    gmail_oauth, since this rides the same connection. Does NOT verify the
    calendar scope was actually granted (only knowable by trying a real
    call); a scope-missing 403 degrades to 'no slots' / raises CalendarError
    same as any other failure, not a separate code path."""
    return gmail_oauth.is_configured()


def _auth_headers() -> dict:
    mailbox = gmail_oauth._get_mailbox()
    if not mailbox or not mailbox.get("refresh_token"):
        raise CalendarError("no connected mailbox — connect Gmail in the CRM first")
    token = gmail_oauth._access_token(mailbox)
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def get_available_slots(
    days_ahead: int = 7,
    min_slots: int = 3,
    business_timezone: str = "UTC",
    business_start_hour: int = _BUSINESS_START_HOUR,
    business_end_hour: int = _BUSINESS_END_HOUR,
    duration_minutes: int = _DEFAULT_DURATION_MINUTES,
) -> list[str]:
    """Available start times (ISO 8601, UTC) over the next `days_ahead` days,
    computed from the connected calendar's real free/busy data, restricted
    to weekday business hours [business_start_hour, business_end_hour) in
    `business_timezone`.

    business_timezone/business_start_hour/business_end_hour are the ORG's
    own working hours (per-org configurable via
    supabase.get_current_org_meeting_settings() — see agent_22), NOT the
    prospect's timezone. That distinction matters: constraining availability
    by the prospect's local time instead of the seller's would happily offer
    a 3am-for-the-seller slot just because it looked like 9am to the
    prospect. Display formatting for the prospect (what the proposal email
    actually shows) is a separate concern, handled by the caller.

    Returns at most `min_slots`, spread across the window rather than
    clustered on the earliest day (same spreading behavior as the Cal.com
    version this replaced). Returns [] (never raises) when not configured or
    the API call fails, so the caller can fall back to a generic "reply to
    schedule" message instead of crashing the whole batch on one Calendar
    outage.
    """
    if not is_configured():
        return []

    try:
        tz = ZoneInfo(business_timezone)
    except (ZoneInfoNotFoundError, ValueError):
        tz = ZoneInfo("UTC")

    now_local = datetime.now(tz)

    try:
        headers = _auth_headers()
        resp = httpx.post(
            _FREEBUSY_URL,
            headers=headers,
            json={
                "timeMin": now_local.astimezone(timezone.utc).isoformat(),
                "timeMax": (now_local + timedelta(days=days_ahead)).astimezone(timezone.utc).isoformat(),
                "timeZone": "UTC",
                "items": [{"id": "primary"}],
            },
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    busy_raw = ((data.get("calendars") or {}).get("primary") or {}).get("busy") or []
    busy: list[tuple[datetime, datetime]] = []
    for b in busy_raw:
        try:
            b_start = datetime.fromisoformat(str(b["start"]).replace("Z", "+00:00"))
            b_end = datetime.fromisoformat(str(b["end"]).replace("Z", "+00:00"))
            busy.append((b_start, b_end))
        except (KeyError, ValueError):
            continue

    duration = timedelta(minutes=duration_minutes)
    candidates: list[datetime] = []
    day_cursor = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    for day_offset in range(days_ahead + 1):
        day = day_cursor + timedelta(days=day_offset)
        if day.weekday() >= 5:  # skip Saturday/Sunday
            continue
        slot_start = day.replace(hour=business_start_hour)
        day_end = day.replace(hour=business_end_hour)
        while slot_start + duration <= day_end:
            if slot_start > now_local:
                slot_start_utc = slot_start.astimezone(timezone.utc)
                slot_end_utc = (slot_start + duration).astimezone(timezone.utc)
                overlaps = any(
                    slot_start_utc < b_end and slot_end_utc > b_start
                    for b_start, b_end in busy
                )
                if not overlaps:
                    candidates.append(slot_start)
            slot_start += duration

    all_starts = [c.astimezone(timezone.utc).isoformat() for c in candidates]
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
    duration_minutes: int = _DEFAULT_DURATION_MINUTES,
) -> dict:
    """Book the meeting at `start_iso` for the given attendee — creates a
    real Google Calendar event with a Google Meet link, and (via
    sendUpdates='all') Google itself emails the invite/.ics to the attendee.
    Returns {'uid': event_id, 'status': ..., 'meetingUrl': ...} — same shape
    the Cal.com version returned, so agent_22 didn't need to change how it
    reads the result. Raises CalendarError on failure — booking is the one
    call in this connector that should NOT fail silently, since a swallowed
    failure here means the prospect thinks they have a meeting and they
    don't.
    """
    if not is_configured():
        raise CalendarError("Google Calendar not configured — connect Gmail in the CRM first")

    try:
        start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except ValueError as exc:
        raise CalendarError(f"invalid start_iso: {start_iso}") from exc
    end_dt = start_dt + timedelta(minutes=duration_minutes)
    tz_name = attendee_timezone or "UTC"

    payload = {
        "summary": f"Call with {attendee_name or attendee_email}",
        "description": notes or "",
        "start": {"dateTime": start_dt.isoformat(), "timeZone": tz_name},
        "end": {"dateTime": end_dt.isoformat(), "timeZone": tz_name},
        "attendees": [{"email": attendee_email}],
        "conferenceData": {
            "createRequest": {
                "requestId": f"agent22-{int(start_dt.timestamp())}-{attendee_email}",
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
        # Best-effort nod to the PDF's "24h and 1h before" reminder rule —
        # see module docstring for why this isn't a guaranteed substitute
        # for Cal.com's explicit Workflow emails.
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email", "minutes": 24 * 60},
                {"method": "email", "minutes": 60},
            ],
        },
    }

    try:
        headers = _auth_headers()
    except CalendarError:
        raise
    try:
        resp = httpx.post(
            _EVENTS_URL,
            headers=headers,
            params={"sendUpdates": "all", "conferenceDataVersion": 1},
            json=payload,
            timeout=20,
        )
    except httpx.HTTPError as exc:
        raise CalendarError(f"booking request failed: {exc}") from exc
    if resp.status_code not in (200, 201):
        raise CalendarError(f"{resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return {
        "uid": data.get("id"),
        "status": data.get("status"),
        "meetingUrl": data.get("hangoutLink"),
    }


def get_booking(uid: str) -> dict | None:
    """Look up a booked event by its Calendar event id. Returns None on any
    failure (never raises) since this is a best-effort sync helper, not a
    critical write path."""
    if not is_configured() or not uid:
        return None
    try:
        headers = _auth_headers()
        resp = httpx.get(f"{_EVENTS_URL}/{uid}", headers=headers, timeout=20)
        if resp.status_code != 200:
            return None
        return resp.json()
    except Exception:
        return None


def cancel_booking(uid: str) -> bool:
    """Cancel/delete a previously-booked event by its Calendar event id —
    used when a meeting is rescheduled after a no-show (see
    agent_22_meeting_booking._handle_no_show), so the old event doesn't sit
    on the org's real calendar forever after the meeting row itself has
    moved back to 'proposed' with a new set of slots.

    Best-effort, like get_booking(): returns True/False rather than raising,
    since a failed cancel here shouldn't block the reschedule flow that
    calls it — worst case is a stale/duplicate calendar event, an
    annoyance, not a broken booking (the NEW booking, if the prospect picks
    a new slot, is created separately via create_booking() and is
    unaffected by this call's outcome). Deleting an already-deleted or
    never-existed event returns True (204/404 both treated as "not on the
    calendar anymore," which is the desired end state either way) — sending
    cancellation notices to the attendee via sendUpdates='all', same as
    create_booking(), so they're told the original invite is off.
    """
    if not is_configured() or not uid:
        return False
    try:
        headers = _auth_headers()
        resp = httpx.delete(
            f"{_EVENTS_URL}/{uid}",
            headers=headers,
            params={"sendUpdates": "all"},
            timeout=20,
        )
    except Exception:
        return False
    return resp.status_code in (200, 204, 404)
