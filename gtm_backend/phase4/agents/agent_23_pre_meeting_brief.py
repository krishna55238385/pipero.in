"""Agent 23 — Pre-Meeting Brief Agent (PDF Phase 5 — CONVERT).

"Prepares a complete business brief before every sales conversation."

Runs on meetings Agent 22 has already confirmed (status='confirmed') that
don't have a brief yet. Reuses account_intelligence (Agent 06) as the
grounding evidence — its recent_moves/likely_pain_points/instability_flags/
competitive_position fields map almost directly onto the PDF's brief
requirements, so this agent is mostly assembly + LLM synthesis, not new
research.

PDF business rules and how this agent maps to each:
- "Brief must be delivered at least 30 minutes before the meeting starts" ->
  operational/scheduling concern (how often this is run), same as Agent 22's
  15-minute bound — not enforced inside the function itself. Generating the
  brief immediately once a meeting is confirmed (rather than waiting until
  close to start time) gives this rule the most slack, since a meeting could
  be confirmed hours or days ahead of the actual call.
- "Must be specific to this prospect — no generic templates" -> enforced in
  PRE_MEETING_BRIEF_SYSTEM's hard rules (grounded only in real
  account_context, no invented facts).
- "Must include at least one recent, specific company development" ->
  recent_development field, required to cite something real from
  recent_moves/key_signals_for_outreach or say so honestly if none exists.
- "Must include predicted objections and suggested responses" ->
  expected_objections, grounded in likely_pain_points/competitive_position.
- "Must be under one page" -> enforced via the prompt's instruction, not
  independently measured here (same trust level as every other length
  instruction given to the LLM in this codebase).
- "Must flag if any unusual context exists" -> unusual_context field, null
  unless instability_flags/recent_moves actually contains something.

No account_intelligence for a lead (Agent 06 never ran, or the lead was
never researched) is NOT treated as a failure — the brief is still
generated, honestly noting the lack of research rather than blocking the
seller from getting anything at all before their call.
"""
import json

from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase4.core.prompts import PRE_MEETING_BRIEF_SYSTEM


def generate_pending_meeting_briefs(limit: int | None = None) -> dict:
    """Generate a pre-meeting brief for every confirmed meeting that
    doesn't have one yet."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 23 — Pre-Meeting Brief (limit={limit or 'all'})")
    print(bar)

    meetings = supabase.get_confirmed_meetings_needing_brief(limit=limit)
    print(f"  → {len(meetings)} confirmed meeting(s) awaiting a brief")

    generated = failed = 0
    for meeting in meetings:
        result = _generate_for_meeting(meeting)
        if result["status"] == "generated":
            generated += 1
        else:
            failed += 1

    print(f"  ✓ Agent 23 complete: {generated} brief(s) generated · {failed} failed")
    return {"meetings_examined": len(meetings), "generated": generated, "failed": failed}


def _generate_for_meeting(meeting: dict) -> dict:
    meeting_id = meeting.get("id")
    lead_id = meeting.get("lead_id")

    if supabase.get_brief_for_meeting(meeting_id) is not None:
        # Defensive: already has one (e.g. a re-run before this returned).
        return {"status": "generated", "meeting_id": meeting_id}

    intel = supabase.get_account_intel_for_lead(lead_id) if lead_id else None
    # Found live 2026-08-07 (same bug class as Agent 22's company-name fix):
    # account_intelligence often doesn't exist yet for a lead (Agent 06 never
    # ran), which left the brief showing generic "this prospect" even though
    # the real name was sitting right there in leads_raw. Fall back to it
    # before giving up to the generic placeholder.
    lead = supabase.get_lead_by_id(lead_id) if lead_id else None
    company = (
        (intel or {}).get("company_name")
        or (lead or {}).get("company_name")
        or "this prospect"
    )
    account_context = {
        "business_model": (intel or {}).get("business_model"),
        "what_they_do": (intel or {}).get("what_they_do"),
        "recent_moves": (intel or {}).get("recent_moves") or [],
        "likely_pain_points": (intel or {}).get("likely_pain_points") or [],
        "competitive_position": (intel or {}).get("competitive_position"),
        "key_signals_for_outreach": (intel or {}).get("key_signals_for_outreach") or [],
        "instability_flags": (intel or {}).get("instability_flags") or [],
    }

    try:
        raw = llm.chat_json(
            PRE_MEETING_BRIEF_SYSTEM,
            json.dumps({"account_context": account_context}, default=str),
            agent="agent_23_pre_meeting_brief",
            phase="phase4",
        )
    except Exception as exc:
        print(f"  [Agent 23] meeting {meeting_id} ({company}) → brief generation failed: {exc}")
        return {"status": "failed", "meeting_id": meeting_id, "error": str(exc)}

    brief_text = str(raw.get("brief_text") or "").strip()
    recent_development = str(raw.get("recent_development") or "").strip() or None
    unusual_context = raw.get("unusual_context")
    if not isinstance(unusual_context, str) or not unusual_context.strip():
        unusual_context = None

    brief = supabase.create_meeting_brief(
        meeting_id=meeting_id,
        lead_id=lead_id,
        company_name=company,
        brief_text=brief_text,
        recent_development=recent_development,
        unusual_context=unusual_context,
    )
    brief_id = brief.get("id") if brief else None
    flag_note = f" ⚠ unusual context: {unusual_context}" if unusual_context else ""
    print(f"  [Agent 23] meeting {meeting_id} ({company}) → brief {brief_id} generated{flag_note}")
    return {"status": "generated", "meeting_id": meeting_id, "brief_id": brief_id}
