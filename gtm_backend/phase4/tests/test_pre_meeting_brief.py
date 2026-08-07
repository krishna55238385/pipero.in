"""Tests for Agent 23 — Pre-Meeting Brief. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase4.agents.agent_23_pre_meeting_brief import (
    generate_pending_meeting_briefs,
)

_MOD = "gtm_backend.phase4.agents.agent_23_pre_meeting_brief"

_MEETING = {"id": 5, "lead_id": 1, "status": "confirmed"}
_LEAD = {"id": 1, "company_name": "Acme HR"}
_INTEL = {
    "company_name": "Acme HR",
    "business_model": "B2B SaaS, per-seat pricing",
    "what_they_do": "HR platform for mid-market companies",
    "recent_moves": ["Closed a $10M Series A in July 2026"],
    "likely_pain_points": ["Manual onboarding workflows"],
    "competitive_position": "Competing against BambooHR on price",
    "key_signals_for_outreach": ["Hiring 3 new HR generalists"],
    "instability_flags": [],
}
_LLM_RESPONSE = {
    "brief_text": "Acme HR — quick brief...",
    "recent_development": "Closed a $10M Series A in July 2026",
    "pain_points": ["Manual onboarding workflows"],
    "expected_objections": [{"objection": "Price vs BambooHR", "suggested_response": "..."}],
    "talking_points": ["Ask about onboarding time-to-productivity"],
    "unusual_context": None,
}


def test_generates_brief_grounded_in_account_intelligence():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=_INTEL), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}) as create_mock:
        summary = generate_pending_meeting_briefs()

    assert summary["generated"] == 1
    kwargs = create_mock.call_args[1]
    assert kwargs["meeting_id"] == 5
    assert kwargs["company_name"] == "Acme HR"
    assert kwargs["recent_development"] == "Closed a $10M Series A in July 2026"
    assert kwargs["unusual_context"] is None


def test_llm_context_includes_all_account_intel_fields():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=_INTEL), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE) as llm_mock, \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}):
        generate_pending_meeting_briefs()

    import json
    sent_payload = json.loads(llm_mock.call_args[0][1])
    ctx = sent_payload["account_context"]
    assert ctx["business_model"] == _INTEL["business_model"]
    assert ctx["recent_moves"] == _INTEL["recent_moves"]
    assert ctx["instability_flags"] == []


def test_unusual_context_flag_is_persisted_when_present():
    llm_response = {**_LLM_RESPONSE, "unusual_context": "CFO departed last month"}
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=_INTEL), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", return_value=llm_response), \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}) as create_mock:
        generate_pending_meeting_briefs()

    assert create_mock.call_args[1]["unusual_context"] == "CFO departed last month"


def test_missing_account_intel_still_generates_a_brief_honestly():
    """No Agent 06 research yet for this lead — must not block the seller
    from getting anything; the LLM gets an all-empty account_context and is
    expected to note that honestly rather than the agent refusing to run."""
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", return_value={
             **_LLM_RESPONSE, "recent_development": "No recent public developments found",
         }) as llm_mock, \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}) as create_mock:
        summary = generate_pending_meeting_briefs()

    assert summary["generated"] == 1
    llm_mock.assert_called_once()
    # Regression: even with no account_intelligence, the real company name
    # (from leads_raw via get_lead_by_id) must be used — not the generic
    # "this prospect" placeholder. Found live 2026-08-07.
    assert create_mock.call_args[1]["company_name"] == "Acme HR"


def test_missing_both_account_intel_and_lead_falls_back_to_generic_placeholder():
    """Only when there's truly no data anywhere (no account_intelligence AND
    no leads_raw row — e.g. a bad/orphaned lead_id) does the generic
    'this prospect' placeholder get used."""
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=None), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=None), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}) as create_mock:
        generate_pending_meeting_briefs()

    assert create_mock.call_args[1]["company_name"] == "this prospect"


def test_account_intel_company_name_takes_priority_over_leads_raw():
    """When both sources have a name, account_intelligence's is preferred —
    it's the more curated/researched source."""
    intel_diff_name = {**_INTEL, "company_name": "Acme HR (from research)"}
    lead_diff_name = {"id": 1, "company_name": "Acme HR (raw lead name)"}
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=intel_diff_name), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=lead_diff_name), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}) as create_mock:
        generate_pending_meeting_briefs()

    assert create_mock.call_args[1]["company_name"] == "Acme HR (from research)"


def test_already_has_brief_is_skipped_idempotently():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value={"id": 1}), \
         patch(f"{_MOD}.llm.chat_json") as llm_mock, \
         patch(f"{_MOD}.supabase.create_meeting_brief") as create_mock:
        summary = generate_pending_meeting_briefs()

    assert summary["generated"] == 1
    llm_mock.assert_not_called()
    create_mock.assert_not_called()


def test_llm_failure_is_reported_as_failed():
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=_INTEL), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.create_meeting_brief") as create_mock:
        summary = generate_pending_meeting_briefs()

    assert summary["failed"] == 1
    create_mock.assert_not_called()


def test_batch_counts_multiple_meetings():
    meeting2 = {"id": 6, "lead_id": 2, "status": "confirmed"}
    with patch(f"{_MOD}.supabase.get_confirmed_meetings_needing_brief", return_value=[_MEETING, meeting2]), \
         patch(f"{_MOD}.supabase.get_brief_for_meeting", return_value=None), \
         patch(f"{_MOD}.supabase.get_account_intel_for_lead", return_value=_INTEL), \
         patch(f"{_MOD}.supabase.get_lead_by_id", return_value=_LEAD), \
         patch(f"{_MOD}.llm.chat_json", return_value=_LLM_RESPONSE), \
         patch(f"{_MOD}.supabase.create_meeting_brief", return_value={"id": 1}):
        summary = generate_pending_meeting_briefs()

    assert summary["meetings_examined"] == 2
    assert summary["generated"] == 2
