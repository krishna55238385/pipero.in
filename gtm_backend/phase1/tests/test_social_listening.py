"""Tests for Agent 20 — Social Listening. All external IO mocked."""
from unittest.mock import patch

from gtm_backend.phase1.agents.agent_20_social_listening import run_social_listening

_MOD = "gtm_backend.phase1.agents.agent_20_social_listening"


def test_generates_queries_then_classifies_and_inserts(sample_icp):
    web_result_a = {
        "title": "Frustrated with manual payroll — anyone switched?",
        "snippet": "Our HR team spends days on compliance every month.",
        "link": "https://reddit.com/r/india/comments/abc",
    }
    web_result_b = {
        "title": "Top 10 HR tools 2026",
        "snippet": "A listicle ranking vendors.",
        "link": "https://example.com/listicle",
    }

    def fake_web(query, num=10):
        return [web_result_a, web_result_b]

    query_plan = {
        "queries": [{"q": "site:reddit.com payroll compliance India", "pain_point_focus": "manual payroll"}],
    }
    batch_classify = {
        "results": [
            {
                "id": 0, "is_signal": True, "candidate_company": None,
                "candidate_person": "u/hr_manager_blr", "candidate_title": None,
                "matched_pain_point": "manual payroll compliance", "confidence": "high",
            },
            {
                "id": 1, "is_signal": False, "candidate_company": None,
                "candidate_person": None, "candidate_title": None,
                "matched_pain_point": None, "confidence": "low",
            },
        ]
    }
    llm_responses = iter([query_plan, batch_classify])

    def fake_llm(system, user, **_kwargs):
        return next(llm_responses)

    with patch(f"{_MOD}.supabase.get_icp", return_value=sample_icp), \
         patch(f"{_MOD}.supabase.get_social_listening_source_urls", return_value=set()), \
         patch(f"{_MOD}.serpapi.search", side_effect=fake_web), \
         patch(f"{_MOD}.llm.chat_json", side_effect=fake_llm), \
         patch(f"{_MOD}.supabase.insert_social_listening_leads", return_value=[101]) as inserter:
        summary = run_social_listening(icp_id=1)

    assert summary["candidates_gathered"] == 2
    assert summary["signals_detected"] == 1
    assert summary["signals_inserted"] == 1
    inserted_rows = inserter.call_args[0][0]
    assert len(inserted_rows) == 1
    row = inserted_rows[0]
    assert row.source_url == "https://reddit.com/r/india/comments/abc"
    assert row.platform == "reddit"
    assert row.confidence == "high"
    assert row.status == "candidate"
    assert row.candidate_company is None  # never invented when the LLM said null


def test_already_seen_urls_are_not_reinserted(sample_icp):
    web_result = {
        "title": "Need a better ATS",
        "snippet": "Struggling with our current setup.",
        "link": "https://reddit.com/r/india/comments/xyz",
    }
    query_plan = {"queries": [{"q": "ATS India frustrated", "pain_point_focus": "hiring tools"}]}
    batch_classify = {
        "results": [{
            "id": 0, "is_signal": True, "candidate_company": None,
            "candidate_person": None, "candidate_title": None,
            "matched_pain_point": "ATS pain", "confidence": "medium",
        }]
    }
    llm_responses = iter([query_plan, batch_classify])

    with patch(f"{_MOD}.supabase.get_icp", return_value=sample_icp), \
         patch(f"{_MOD}.supabase.get_social_listening_source_urls",
               return_value={"https://reddit.com/r/india/comments/xyz"}), \
         patch(f"{_MOD}.serpapi.search", return_value=[web_result]), \
         patch(f"{_MOD}.llm.chat_json", side_effect=lambda *a, **k: next(llm_responses)), \
         patch(f"{_MOD}.supabase.insert_social_listening_leads") as inserter:
        summary = run_social_listening(icp_id=1)

    assert summary["signals_detected"] == 1
    assert summary["signals_inserted"] == 0
    inserter.assert_not_called()


def test_no_queries_generated_yields_zero_candidates(sample_icp):
    with patch(f"{_MOD}.supabase.get_icp", return_value=sample_icp), \
         patch(f"{_MOD}.llm.chat_json", return_value={"queries": []}), \
         patch(f"{_MOD}.serpapi.search") as search_mock, \
         patch(f"{_MOD}.supabase.insert_social_listening_leads") as inserter:
        summary = run_social_listening(icp_id=1)

    assert summary["candidates_gathered"] == 0
    assert summary["signals_inserted"] == 0
    search_mock.assert_not_called()
    inserter.assert_not_called()


def test_query_generation_failure_is_handled_gracefully(sample_icp):
    with patch(f"{_MOD}.supabase.get_icp", return_value=sample_icp), \
         patch(f"{_MOD}.llm.chat_json", side_effect=RuntimeError("groq down")), \
         patch(f"{_MOD}.supabase.insert_social_listening_leads") as inserter:
        summary = run_social_listening(icp_id=1)

    assert summary["candidates_gathered"] == 0
    inserter.assert_not_called()


def test_scans_multiple_active_icps_when_icp_id_omitted(sample_icp):
    icp_2 = {**sample_icp, "id": 2, "name": "Fintech in Nigeria"}
    with patch(f"{_MOD}.supabase.get_active_icps", return_value=[sample_icp, icp_2]), \
         patch(f"{_MOD}.llm.chat_json", return_value={"queries": []}), \
         patch(f"{_MOD}.supabase.insert_social_listening_leads") as inserter:
        summary = run_social_listening(icp_id=None)

    assert summary["icps_scanned"] == 2
    inserter.assert_not_called()
