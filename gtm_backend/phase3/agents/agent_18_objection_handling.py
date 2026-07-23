"""Agent 18 — Objection Handling (PDF Phase 4 — ENGAGE).

"Turns every objection into a conversation that can still move forward."

Runs on replies Agent 16 classified as not_now/has_question, BEFORE Agent 17
drafts a response. Detects whether the reply actually contains a specific
objection (price, timing, "already have a vendor", trust, etc.) as opposed to
a plain question or logistics note, and — when it does — proposes a rebuttal
angle. Writes both onto the same outreach_replies row; Agent 17's draft
prompt picks them up automatically and weaves the rebuttal into its response
instead of just acknowledging the reply generically.

Deliberately NOT a separate response-drafting agent: duplicating Agent 17's
drafting logic here would just mean two competing drafts fighting over the
same outreach_replies row. Agent 18's whole job is to make Agent 17's draft
sharper, not to write its own.
"""
from gtm_backend.phase3.connectors import openai as llm
from gtm_backend.phase3.connectors import supabase
from gtm_backend.phase3.core.prompts import OBJECTION_DETECTION_SYSTEM

_VALID_OBJECTION_TYPES = {
    "price", "timing", "no_need", "has_vendor", "trust", "feature_gap", "authority", "none",
}


def detect_pending_objections(limit: int | None = None) -> dict:
    """Run objection detection on every not_now/has_question reply not yet checked."""
    bar = "═" * 72
    print(f"\n{bar}")
    print(f"  AGENT 18 — Objection Handling (limit={limit or 'all'})")
    print(bar)

    replies = supabase.get_replies_needing_objection_check(limit=limit)
    print(f"  → {len(replies)} reply(ies) to check for objections")

    objections_found = 0
    no_objection = 0
    failed = 0
    for reply in replies:
        result = detect_objection(reply)
        if result["status"] == "failed":
            failed += 1
        elif result["objection_type"] == "none":
            no_objection += 1
        else:
            objections_found += 1

    print(
        f"  ✓ Agent 18 complete: {objections_found} objection(s) found · "
        f"{no_objection} clean (no objection) · {failed} failed"
    )
    return {
        "replies_examined": len(replies),
        "objections_found": objections_found,
        "no_objection": no_objection,
        "failed": failed,
    }


def detect_objection(reply: dict) -> dict:
    """Analyze one reply for a specific objection. Always marks
    objection_checked=True (even on 'none' or failure) so a re-run of the
    batch doesn't keep re-processing the same reply forever."""
    reply_id = reply.get("id")
    reply_text = reply.get("reply_text") or ""
    company = reply.get("company_name") or "?"

    try:
        raw = llm.chat_json(
            OBJECTION_DETECTION_SYSTEM,
            reply_text,
            agent="agent_18_objection_handling",
            phase="phase3",
        )
    except Exception as exc:
        print(f"  [Agent 18] reply {reply_id} ({company}) → detection failed: {exc}")
        supabase.update_reply(reply_id, objection_checked=True)
        return {"status": "failed", "reply_id": reply_id, "objection_type": None}

    objection_type = str(raw.get("objection_type") or "none").lower()
    if objection_type not in _VALID_OBJECTION_TYPES:
        objection_type = "none"

    if objection_type == "none":
        supabase.update_reply(
            reply_id, objection_checked=True, objection_type="none",
            objection_phrase=None, rebuttal_angle=None,
        )
        print(f"  [Agent 18] reply {reply_id} ({company}) → no objection detected")
        return {"status": "checked", "reply_id": reply_id, "objection_type": "none"}

    objection_phrase = _clean(raw.get("objection_phrase"))
    rebuttal_angle = _clean(raw.get("rebuttal_angle"))
    supabase.update_reply(
        reply_id,
        objection_checked=True,
        objection_type=objection_type,
        objection_phrase=objection_phrase,
        rebuttal_angle=rebuttal_angle,
    )
    print(f"  [Agent 18] reply {reply_id} ({company}) → {objection_type} objection detected")
    return {
        "status": "checked",
        "reply_id": reply_id,
        "objection_type": objection_type,
        "objection_phrase": objection_phrase,
        "rebuttal_angle": rebuttal_angle,
    }


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None
