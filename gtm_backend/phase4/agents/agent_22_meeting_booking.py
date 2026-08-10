"""Agent 22 — Meeting Booking Agent (PDF Phase 5 — CONVERT).

"Books the meeting the moment a prospect expresses interest."

PDF business rules and how this agent maps to each:
- "Meeting link must be sent within 15 minutes of an interested reply" ->
  this agent is meant to run frequently (every few minutes) against
  get_replies_needing_meeting_check(), same cadence model as every other
  reply-driven agent (16/17/18/24) in this pipeline — the 15-minute bound is
  an operational/scheduling concern (how often the caller runs this), not
  something enforced inside the function itself.
- "Must offer at least 3 time slot options in the prospect's timezone" ->
  calendar.get_available_slots(min_slots=3, timezone_name=<prospect tz>).
- "Confirmation email must include a clear agenda and what the prospect
  should expect" -> _confirmation_email() always includes an agenda section.
- "Reminder must be sent 24 hours before and 1 hour before" -> the connector
  sets 24h/1h email reminder overrides directly on the created Calendar
  event as a best-effort nod to this rule (see google_calendar.py's
  docstring for why that isn't a guaranteed substitute for a real branded
  reminder system across every attendee/calendar-provider combination).
- "If prospect no-shows, rescheduling attempt must happen within 2 hours" /
  "Maximum 2 rescheduling attempts before moving to nurture" -> NOT built in
  this pass. No-show detection needs either a Calendar webhook/push
  notification or a polling check against meeting end-time + no post-meeting
  activity, which is real additional scope; meetings.reschedule_count and the
  'no_show' / 'moved_to_nurture' status values are already in the schema so
  this can be added without another migration. Flagged as a follow-up, not
  silently skipped.
- "All meeting details must be auto-logged in the CRM" -> every proposal and
  confirmation writes to the `meetings` table (this pipeline's system of
  record, same as outreach_log/deals for every other agent).

Booking backend: direct Google Calendar API (phase3/connectors/
google_calendar.py), riding the same per-org OAuth mailbox connection Agent
14/16 use for Gmail — NOT Cal.com (calcom.py still exists but is unused by
this agent as of 2026-08-08). Cal.com v1 was one shared account for the
whole platform; that became a real cross-tenant bug the moment a second org
needed its own calendar (every org's meetings would land on the same
calendar). See google_calendar.py's module docstring for the full reasoning
and the OAuth-scope/reconnect caveat.

Two-phase design (no public prospect-facing booking-picker page in v1):
1. propose_meetings(): interested reply -> LLM checks meeting intent -> if
   yes, fetch >=3 slots from the connected calendar's real free/busy data,
   email them, write a `meetings` row (status='proposed', no event created
   yet — nothing is actually held on the calendar until the prospect picks
   one).
2. sync_meeting_confirmations(): for each still-proposed meeting, check for
   a NEW reply from that lead since it was proposed. If found, LLM-match it
   against the proposed slots; a clear match creates the real Calendar event
   (calendar.create_booking) and sends the confirmation+agenda email.
"""
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from gtm_backend.phase3.connectors import google_calendar as calendar
from gtm_backend.phase3.connectors import gmail_oauth
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import MEETING_INTENT_SYSTEM, MEETING_SLOT_MATCH_SYSTEM


def propose_meetings(limit: int | None = None) -> dict:
    """Check every interested reply awaiting a meeting-intent check; propose
    a meeting (>=3 Cal.com slots emailed) for every one that wants to talk."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 22 — Meeting Booking: propose (limit={limit or 'all'})")
    print(bar)

    replies = supabase.get_replies_needing_meeting_check(limit=limit)
    print(f"  → {len(replies)} interested reply(ies) awaiting meeting-intent check")

    proposed = no_intent = no_slots = failed = 0
    for reply in replies:
        result = _propose_for_reply(reply)
        if result["status"] == "proposed":
            proposed += 1
        elif result["status"] == "no_intent":
            no_intent += 1
        elif result["status"] == "no_slots_available":
            no_slots += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 22 (propose) complete: {proposed} meeting(s) proposed · "
        f"{no_intent} no meeting intent · {no_slots} no slots available · {failed} failed"
    )
    return {
        "replies_examined": len(replies),
        "proposed": proposed,
        "no_intent": no_intent,
        "no_slots_available": no_slots,
        "failed": failed,
    }


def _propose_for_reply(reply: dict) -> dict:
    reply_id = reply.get("id")
    lead_id = reply.get("lead_id")
    email = (reply.get("email") or "").strip()
    reply_text = reply.get("reply_text") or ""
    # outreach_replies has no company_name column, so logging before the
    # real lookup (below) just uses the id — cheap, and avoids a DB call for
    # every reply examined when most won't reach the point of actually
    # needing a company name (no-intent replies are the common case).
    log_label = f"reply {reply_id}"

    if supabase.get_meeting_for_reply(reply_id) is not None:
        # Defensive: already has a meeting row (e.g. a re-run before the
        # meeting_booking_checked flag got persisted). Mark checked, skip.
        supabase.update_reply(reply_id, meeting_booking_checked=True)
        return {"status": "no_intent", "reply_id": reply_id}

    try:
        intent = llm.chat_json(
            MEETING_INTENT_SYSTEM,
            json.dumps({"reply_text": reply_text}),
            agent="agent_22_meeting_booking",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 22] {log_label} → intent check failed: {exc}")
        # Deliberately do NOT mark checked on an LLM failure — a transient
        # failure shouldn't permanently skip a real meeting request. Retried
        # on the next run instead.
        return {"status": "failed", "reply_id": reply_id, "error": str(exc)}

    if not intent.get("wants_meeting"):
        supabase.update_reply(reply_id, meeting_booking_checked=True)
        print(f"  [Agent 22] {log_label} → no meeting intent, skipping")
        return {"status": "no_intent", "reply_id": reply_id}

    # outreach_replies has no company_name column — must look it up via the
    # lead itself. reply.get("company_name") always returns None; using it
    # directly was a real bug (see get_lead_by_id's docstring), caught live
    # 2026-08-07 via a literal "?" in a sent email's subject line. Fetched
    # here (only once intent is confirmed) rather than up front, so a
    # no-intent reply — the common case — doesn't cost an extra DB call.
    lead = supabase.get_lead_by_id(lead_id) if lead_id else None
    company = (lead or {}).get("company_name") or "there"
    log_label = f"reply {reply_id} ({company})"

    tz_name = _timezone_for_lead(lead_id)
    slots = calendar.get_available_slots(min_slots=3, timezone_name=tz_name)
    if not slots:
        # Do NOT mark checked — the calendar being unreachable/misconfigured
        # is a transient/config issue, not "this prospect doesn't want a meeting."
        print(f"  [Agent 22] {log_label} → no calendar slots available, will retry")
        return {"status": "no_slots_available", "reply_id": reply_id}

    if not email:
        supabase.update_reply(reply_id, meeting_booking_checked=True)
        print(f"  [Agent 22] {log_label} → no email on reply, cannot send proposal")
        return {"status": "failed", "reply_id": reply_id, "error": "no_email"}

    html = _proposal_email(company, slots, tz_name)
    try:
        gmail_oauth.send_html_email(
            to=email,
            subject=f"Scheduling a quick call — {company}",
            html_body=html,
        )
    except Exception as exc:
        print(f"  [Agent 22] reply {reply_id} ({company}) → send failed: {exc}")
        return {"status": "failed", "reply_id": reply_id, "error": str(exc)}

    supabase.create_meeting(
        reply_id=reply_id,
        lead_id=lead_id,
        attendee_timezone=tz_name,
        proposed_slots=slots,
    )
    supabase.update_reply(reply_id, meeting_booking_checked=True)
    print(f"  [Agent 22] reply {reply_id} ({company}) → proposed {len(slots)} slot(s), emailed {email}")
    return {"status": "proposed", "reply_id": reply_id}


def sync_meeting_confirmations(limit: int | None = None) -> dict:
    """For every meeting still awaiting confirmation, check for a fresh reply
    from that lead and, if it clearly confirms a slot, book it for real."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 22 — Meeting Booking: sync confirmations (limit={limit or 'all'})")
    print(bar)

    meetings = supabase.get_meetings_awaiting_confirmation(limit=limit)
    print(f"  → {len(meetings)} meeting(s) awaiting confirmation")

    confirmed = reschedule_requested = declined = no_new_reply = failed = 0
    for meeting in meetings:
        result = _sync_one_meeting(meeting)
        status = result["status"]
        if status == "confirmed":
            confirmed += 1
        elif status == "reschedule_requested":
            reschedule_requested += 1
        elif status == "declined":
            declined += 1
        elif status == "no_new_reply":
            no_new_reply += 1
        else:
            failed += 1

    print(
        f"  ✓ Agent 22 (sync) complete: {confirmed} confirmed · {reschedule_requested} reschedule requested · "
        f"{declined} declined · {no_new_reply} no new reply yet · {failed} failed"
    )
    return {
        "meetings_examined": len(meetings),
        "confirmed": confirmed,
        "reschedule_requested": reschedule_requested,
        "declined": declined,
        "no_new_reply": no_new_reply,
        "failed": failed,
    }


def _sync_one_meeting(meeting: dict) -> dict:
    meeting_id = meeting.get("id")
    lead_id = meeting.get("lead_id")
    since = meeting.get("proposed_at")
    proposed_slots = meeting.get("proposed_slots") or []

    new_replies = supabase.get_replies_for_lead_since(lead_id, since) if since else []
    if not new_replies:
        return {"status": "no_new_reply", "meeting_id": meeting_id}

    latest = new_replies[-1]
    reply_text = latest.get("reply_text") or ""

    try:
        match = llm.chat_json(
            MEETING_SLOT_MATCH_SYSTEM,
            json.dumps({"reply_text": reply_text, "proposed_slots": proposed_slots}),
            agent="agent_22_meeting_booking",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 22] meeting {meeting_id} → slot-match failed: {exc}")
        return {"status": "failed", "meeting_id": meeting_id, "error": str(exc)}

    outcome = match.get("outcome")
    if outcome == "declined":
        supabase.update_meeting(meeting_id, status="cancelled")
        print(f"  [Agent 22] meeting {meeting_id} → prospect declined")
        return {"status": "declined", "meeting_id": meeting_id}

    if outcome == "reschedule_requested":
        print(f"  [Agent 22] meeting {meeting_id} → prospect asked to reschedule (needs human/free-text handling)")
        return {"status": "reschedule_requested", "meeting_id": meeting_id}

    matched_slot = match.get("matched_slot")
    if outcome != "confirmed" or not matched_slot or matched_slot not in proposed_slots:
        # "unclear" or a hallucinated slot not actually in the list — do
        # nothing rather than book the wrong time.
        return {"status": "no_new_reply", "meeting_id": meeting_id}

    attendee_email = (latest.get("email") or "").strip()
    lead = supabase.get_lead_by_id(lead_id) if lead_id else None
    company = (lead or {}).get("company_name") or "there"
    tz_name = meeting.get("attendee_timezone") or "UTC"

    try:
        booking = calendar.create_booking(
            start_iso=matched_slot,
            attendee_email=attendee_email,
            attendee_name=company,
            attendee_timezone=tz_name,
        )
    except calendar.CalendarError as exc:
        print(f"  [Agent 22] meeting {meeting_id} → calendar booking failed: {exc}")
        return {"status": "failed", "meeting_id": meeting_id, "error": str(exc)}

    agenda = _default_agenda(company)
    # meetings.calcom_booking_uid keeps its Cal.com-era column name (not
    # worth a migration for a rename) but now stores the Google Calendar
    # event id — booking.get("uid") is google_calendar.create_booking()'s
    # 'uid' key, which is that event id, kept as the same field name so
    # nothing downstream (CRM reads, tests) needed to change.
    supabase.update_meeting(
        meeting_id,
        status="confirmed",
        calcom_booking_uid=booking.get("uid"),
        scheduled_at=matched_slot,
        agenda=agenda,
        confirmed_at=datetime.now(timezone.utc).isoformat(),
    )

    if attendee_email:
        try:
            gmail_oauth.send_html_email(
                to=attendee_email,
                subject=f"Confirmed: our call — {company}",
                html_body=_confirmation_email(company, matched_slot, tz_name, agenda),
            )
        except Exception as exc:
            # The booking itself succeeded — a failed confirmation email is
            # logged, not treated as the whole operation failing.
            print(f"  [Agent 22] meeting {meeting_id} → booked, but confirmation email failed: {exc}")

    print(f"  [Agent 22] meeting {meeting_id} → confirmed for {matched_slot}")
    return {"status": "confirmed", "meeting_id": meeting_id}


def _timezone_for_lead(lead_id: int | None) -> str:
    if lead_id is None:
        return "UTC"
    plan = supabase.get_channel_plan_for_lead(lead_id)
    tz_name = (plan or {}).get("timezone") or "UTC"
    try:
        ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        return "UTC"
    return tz_name


def _default_agenda(company: str) -> str:
    return (
        f"A short introductory call to understand {company}'s current setup, "
        "answer any questions, and see if there's a good fit — no prep needed "
        "on your end."
    )


def _format_slot(iso_str: str, tz_name: str) -> str:
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        local = dt.astimezone(ZoneInfo(tz_name))
        return local.strftime("%A, %B %-d at %-I:%M %p %Z")
    except Exception:
        return iso_str


def _tz_label(tz_name: str) -> str:
    """Copy for the proposal email's timezone note. Found live 2026-08-07: a
    lead with no channel-plan timezone on file falls back to UTC (correct
    behavior — there's no real data to personalize with), but the email
    still claimed 'shown in your local timezone', which is misleading when
    it's actually just the UTC fallback, not a known personalized zone."""
    return "shown in your local timezone" if tz_name != "UTC" else "shown in UTC"


def _proposal_email(company: str, slots: list[str], tz_name: str) -> str:
    items = "".join(f"<li>{_format_slot(s, tz_name)}</li>" for s in slots)
    return (
        f"<p>Hi there,</p>"
        f"<p>Happy to find time to talk. A few options that work on our end "
        f"(times {_tz_label(tz_name)}):</p>"
        f"<ul>{items}</ul>"
        f"<p>Reply with whichever works best and I'll lock it in — or let me "
        f"know if none of these fit and I'll find another time.</p>"
    )


def _confirmation_email(company: str, start_iso: str, tz_name: str, agenda: str) -> str:
    when = _format_slot(start_iso, tz_name)
    return (
        f"<p>Confirmed — {when}.</p>"
        f"<p><strong>What to expect:</strong> {agenda}</p>"
        f"<p>Looking forward to it. Reply here anytime if anything changes.</p>"
    )
