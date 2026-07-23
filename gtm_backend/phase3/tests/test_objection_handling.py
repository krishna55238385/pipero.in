"""Tests for Agent 18 — Objection Handling. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase3.agents.agent_18_objection_handling import (
    detect_objection,
    detect_pending_objections,
)
from gtm_backend.phase3.agents.agent_17_reply_handling import draft_response

_MOD = "gtm_backend.phase3.agents.agent_18_objection_handling"

_REPLY = {
    "id": 7, "lead_id": 1, "company_name": "Acme HR",
    "classification": "not_now",
    "reply_text": "We already use BambooHR and it's working fine for us right now.",
}


def test_detects_real_objection():
    llm_response = {
        "objection_type": "has_vendor",
        "objection_phrase": "We already use BambooHR",
        "rebuttal_angle": "Ask what's not working well with BambooHR rather than attacking it directly.",
    }
    with patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = detect_objection(_REPLY)

    assert result["objection_type"] == "has_vendor"
    assert result["rebuttal_angle"].startswith("Ask what's not working")
    kwargs = updater.call_args[1]
    assert kwargs["objection_checked"] is True
    assert kwargs["objection_type"] == "has_vendor"


def test_no_objection_still_marks_checked():
    """A plain question with no pushback must be objection_type='none', not
    invented — and objection_checked must still flip to True so it's not
    re-processed forever."""
    llm_response = {"objection_type": "none", "objection_phrase": None, "rebuttal_angle": None}
    plain_question = {**_REPLY, "reply_text": "What's the pricing for a 50-person team?"}
    with patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = detect_objection(plain_question)

    assert result["objection_type"] == "none"
    kwargs = updater.call_args[1]
    assert kwargs["objection_checked"] is True
    assert kwargs["objection_type"] == "none"
    assert kwargs["rebuttal_angle"] is None


def test_invalid_llm_objection_type_coerced_to_none():
    llm_response = {"objection_type": "made_up_type", "objection_phrase": "x", "rebuttal_angle": "y"}
    with patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = detect_objection(_REPLY)

    assert result["objection_type"] == "none"
    assert updater.call_args[1]["objection_type"] == "none"


def test_llm_failure_still_marks_checked_without_guessing():
    with patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.update_reply") as updater:
        result = detect_objection(_REPLY)

    assert result["status"] == "failed"
    assert updater.call_args[1]["objection_checked"] is True
    assert "objection_type" not in updater.call_args[1] or updater.call_args[1].get("objection_type") is None


def test_batch_counts_objections_vs_clean():
    replies = [_REPLY, {**_REPLY, "id": 8, "reply_text": "What's the pricing?"}]
    responses = iter([
        {"objection_type": "has_vendor", "objection_phrase": "x", "rebuttal_angle": "y"},
        {"objection_type": "none", "objection_phrase": None, "rebuttal_angle": None},
    ])
    with patch(f"{_MOD}.supabase.get_replies_needing_objection_check", return_value=replies), \
         patch(f"{_MOD}.llm.chat_json", side_effect=lambda *a, **k: next(responses)), \
         patch(f"{_MOD}.supabase.update_reply"):
        summary = detect_pending_objections()

    assert summary["objections_found"] == 1
    assert summary["no_objection"] == 1


# -- Integration: Agent 17 picks up Agent 18's output --------------------

def test_agent_17_forwards_objection_context_to_draft_prompt():
    """When a reply already has objection_type/rebuttal_angle set (Agent 18
    ran first), Agent 17's LLM payload must include them so the draft prompt
    can weave the rebuttal in — this is the whole point of the two agents
    working together instead of duplicating each other."""
    reply_with_objection = {
        **_REPLY,
        "objection_type": "has_vendor",
        "rebuttal_angle": "Ask what's not working well with BambooHR.",
    }
    captured_payload = {}

    def fake_chat_json(system, user, **kwargs):
        import json
        captured_payload.update(json.loads(user))
        return {"draft_response": "Totally get it — out of curiosity, what's not working as well as you'd like with BambooHR?"}

    with patch("gtm_backend.phase3.agents.agent_17_reply_handling.supabase.get_account_intel_for_lead", return_value=None), \
         patch("gtm_backend.phase3.agents.agent_17_reply_handling.llm.chat_json", side_effect=fake_chat_json), \
         patch("gtm_backend.phase3.agents.agent_17_reply_handling.supabase.update_reply"):
        draft_response(reply_with_objection)

    assert captured_payload["objection_type"] == "has_vendor"
    assert captured_payload["rebuttal_angle"] == "Ask what's not working well with BambooHR."
