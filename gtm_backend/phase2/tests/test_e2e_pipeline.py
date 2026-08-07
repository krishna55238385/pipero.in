"""End-to-end pipeline test for phase2.

Drives Agents 06 → 07 → 08 → 09 → 10 in sequence with every external
call mocked. Asserts each agent writes its expected table at least once and
no exceptions propagate.
"""
from gtm_backend.phase2.agents.agent_06_account_intel import build_account_intelligence
from gtm_backend.phase2.agents.agent_07_stakeholders import map_stakeholders
from gtm_backend.phase2.agents.agent_08_competitive import gather_competitive_intel
from gtm_backend.phase2.agents.agent_09_market_sizing import size_markets
from gtm_backend.phase2.agents.agent_10_gtm_insights import generate_insights


_ACCOUNT_INTEL_PAYLOAD = {
    "what_they_do": "Acme HR builds an HR platform for Indian SMBs.",
    "business_model": "B2B",
    "company_size_estimate": "Mid-market",
    "growth_trajectory": "Growing — closed Series A this quarter and hiring engineers.",
    "competitive_position": "Differentiated by India-first onboarding and payroll.",
    "recent_moves": [
        {"date": "2026-05-01", "move_type": "funding", "summary": "Series A",
         "source_url": "https://news/series-a"},
    ],
    "likely_pain_points": [
        {"pain": "Hiring velocity", "evidence": "Open roles", "confidence": "medium"},
        {"pain": "Manual compliance", "evidence": None, "confidence": "low"},
    ],
    "instability_flags": [],
    "confirmed_facts": [
        {"fact": "Bangalore HQ", "source": "website", "source_url": "https://acmehr.com/about"},
        {"fact": "Founded 2021", "source": "website", "source_url": "https://acmehr.com/about"},
        {"fact": "Raised $10M", "source": "news", "source_url": "https://news/series-a"},
    ],
    "inferences": [{"inference": "Likely scaling sales", "confidence": "medium"}],
    "key_signals_for_outreach": ["recent funding", "hiring spike", "Mumbai expansion"],
}

_STAKEHOLDER_PAYLOAD = {
    "stakeholders": [
        {"full_name": "Priya Iyer", "job_title": "CEO", "role_type": "economic_buyer",
         "seniority": "C-suite", "function_area": "Exec", "confidence": "high", "rank": 1,
         "linkedin_url": "https://linkedin.com/in/priya-iyer"},
        {"full_name": "Rahul Mehta", "job_title": "Head of HR", "role_type": "champion",
         "seniority": "Director", "function_area": "HR", "confidence": "medium", "rank": 2,
         "linkedin_url": "https://linkedin.com/in/rahul-mehta"},
        {"full_name": "Sara Khan", "job_title": "VP Engineering", "role_type": "influencer",
         "seniority": "VP", "function_area": "Eng", "confidence": "medium", "rank": 3,
         "linkedin_url": "https://linkedin.com/in/sara-khan"},
    ],
    "entry_point_full_name": "Rahul Mehta",
    "entry_point_role_type": "champion",
}

_COMPETITOR_PAYLOAD = {
    "summary": "Established HRMS competitor.",
    "biggest_weakness": "Slow support.",
    "who_loves_them": "Enterprise IT.",
    "who_hates_them": "Founders at SMBs.",
    "complaint_categories": [
        {"category": "support", "severity": "high", "top_complaints": ["slow tickets"]},
    ],
    "talk_tracks": [
        {"scenario": "differentiation", "message": "We focus on the founder, not IT."},
    ],
    "threat_level": "high",
}

_MARKET_PAYLOAD = {
    "summary": "One mature segment with healthy demand.",
    "primary_gtm_segment": "Mid-market HR-tech in India",
    "secondary_gtm_segment": None,
    "avoid_this_week": None,
    "focus_reason": "Strong scored-lead volume.",
    "segments": [
        {
            "icp_id": 1,
            "segment_name": "Mid-market HR-tech in India",
            "tam_estimate": "$2B",
            "sam_estimate": "$400M",
            "som_this_month": "$5M",
            "competition_density": "medium",
            "competition_impact": "Stable",
            "seasonal_fit": "neutral",
            "seasonal_note": "Q2 baseline",
            "priority_rank": 1,
            "priority_rationale": "Strong warm-tier volume.",
            "recommended_volume": 50,
            "too_small_flag": False,
        },
    ],
}

_GTM_PAYLOAD = {
    "executive_summary": "Account is in active funding cycle; champion identified.",
    "who_to_target": {
        "segment": "Mid-market HR-tech in India",
        "priority_rank": 1,
        "entry_point_name": "Rahul Mehta",
        "entry_point_role": "champion",
        "secondary_contacts": ["Priya Iyer"],
    },
    "what_to_say": {
        "core_message": "Help Acme scale hiring post-Series A.",
        "unique_value_proposition": "India-first onboarding stack.",
        "pain_points_to_address": ["hiring velocity", "manual compliance"],
        "competitive_angle": "Faster onboarding than Darwinbox.",
    },
    "which_channel": {
        "primary_channel": "email",
        "sequence": ["LinkedIn touch", "Email intro", "Follow-up call"],
        "cadence": "3 touches over 10 days",
    },
    "why_market_rationale": "Top-ranked segment this week.",
    "why_account_rationale": "Funded, hiring, no incumbent.",
    "urgency_signal": "Funding just announced.",
    "flags_and_contradictions": [],
    "next_actions": ["Send personalised LinkedIn DM to Rahul"],
}


def _route_llm(system: str, _user: str, **_kwargs: object) -> dict:
    """Pick the canned payload based on the agent's system prompt."""
    head = system.split("\n", 1)[0].lower()
    if "account intelligence" in head or "company brief" in head:
        return _ACCOUNT_INTEL_PAYLOAD
    if "stakeholder" in head or "buying committee" in head:
        return _STAKEHOLDER_PAYLOAD
    if "competitor" in head or "competitive" in head:
        return _COMPETITOR_PAYLOAD
    if "market" in head:
        return _MARKET_PAYLOAD
    if "gtm" in head or "go-to-market" in head or "strategic" in head:
        return _GTM_PAYLOAD
    # Fall back on full-prompt search if first line is generic.
    body = system.lower()
    for marker, payload in (
        ("stakeholder", _STAKEHOLDER_PAYLOAD),
        ("competitor", _COMPETITOR_PAYLOAD),
        ("market", _MARKET_PAYLOAD),
        ("gtm", _GTM_PAYLOAD),
        ("account intelligence", _ACCOUNT_INTEL_PAYLOAD),
    ):
        if marker in body:
            return payload
    return _ACCOUNT_INTEL_PAYLOAD


def test_phase2_pipeline_end_to_end(
    mocker, fake_icp, fake_lead, fake_brief_row,
    fake_serp_organic_results, fake_serp_news_results, fake_linkedin_snippets,
):
    """Run agents 06 → 10 in order. Each agent must write its primary table
    at least once with no exceptions thrown.
    """
    # --- LLM router shared across every agent ---------------------------
    for module_path in (
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        "gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json",
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        "gtm_backend.phase2.agents.agent_09_market_sizing.llm.chat_json",
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
    ):
        mocker.patch(module_path, side_effect=_route_llm)

    # --- SerpAPI ----------------------------------------------------------
    competitor_discovery = [
        {"title": "Darwinbox - Best HR Tech", "link": "https://darwinbox.com", "snippet": "..."},
        {"title": "Keka HR | India", "link": "https://keka.com", "snippet": "..."},
        {"title": "Zoho People — HR Suite", "link": "https://zoho.com/people", "snippet": "..."},
    ]

    def fake_search(query: str, num: int = 10, location: str | None = None) -> list[dict]:
        q = query.lower()
        if "top " in q and ("companies" in q or "hr" in q or "saas" in q):
            return competitor_discovery
        return fake_serp_organic_results

    for module_path in (
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search",
        "gtm_backend.phase2.agents.agent_08_competitive.serpapi.search",
    ):
        mocker.patch(module_path, side_effect=fake_search)

    for module_path in (
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news",
        "gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news",
    ):
        mocker.patch(module_path, return_value=fake_serp_news_results)

    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=fake_linkedin_snippets,
    )

    # --- Supabase reads ---------------------------------------------------
    for module_path in (
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
    ):
        mocker.patch(module_path, return_value=[fake_lead])

    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={fake_lead["id"]: fake_brief_row},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=fake_brief_row,
    )

    for module_path in (
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_icp",
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_icp",
    ):
        mocker.patch(module_path, return_value=fake_icp)

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_scored_lead_counts_by_icp",
        return_value={"total": 150, "hot": 30, "warm": 70, "cold": 50},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholders_for_lead",
        return_value=[
            {"full_name": "Rahul Mehta", "job_title": "Head of HR", "role_type": "champion",
             "seniority": "Director", "confidence": "medium"},
        ],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholder_map_for_lead",
        return_value={
            "entry_point_full_name": "Rahul Mehta",
            "entry_point_role_type": "champion",
            "multi_threading_status": "multi",
        },
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_competitors_for_icp",
        return_value=[
            {"competitor_name": "Darwinbox", "summary": "...", "biggest_weakness": "Slow support",
             "talk_tracks": [], "threat_level": "high"},
        ],
    )
    # agent_09_market_sizing.supabase and agent_10_gtm_insights.supabase are
    # the SAME shared connector module object (both `from ...connectors import
    # supabase`), so get_market_segments must be mocked exactly ONCE with a
    # side_effect that distinguishes callers, not two separate return_value
    # patches (the second would silently clobber the first). Agent 09's
    # freshness check calls it with icp_id=None; agent 10's per-lead lookup
    # always passes an icp_id.
    def _fake_get_market_segments(week_of=None, icp_id=None):
        if icp_id is None:
            return []  # agent 09: no snapshot yet this week -> proceed to compute
        return [{
            "segment_name": "Mid-market HR-tech in India",
            "tam_estimate": "$2B", "sam_estimate": "$400M", "som_this_month": "$5M",
            "competition_density": "medium", "seasonal_fit": "neutral",
            "priority_rank": 1, "priority_rationale": "strong volume",
        }]

    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_market_segments",
        side_effect=_fake_get_market_segments,
    )

    # --- Supabase writes (the things we want to assert) -------------------
    upsert_brief = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )
    insert_stakeholders = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.insert_stakeholders",
        return_value=[1, 2, 3],
    )
    upsert_smap = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.upsert_stakeholder_map",
        return_value=1,
    )
    upsert_competitor = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_competitor",
        return_value=1,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.delete_stale_competitors",
        return_value=0,
    )
    upsert_segments = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.upsert_market_segments",
        return_value=[10],
    )
    upsert_gtm = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    # --- Run the pipeline ------------------------------------------------
    s06 = build_account_intelligence(icp_id=1, limit=5)
    s07 = map_stakeholders(icp_id=1, limit=5)
    s08 = gather_competitive_intel(icp_id=1, max_competitors=5)
    s09 = size_markets()
    s10 = generate_insights(icp_id=1, limit=5)

    # --- Assertions: each agent wrote at least once ----------------------
    assert upsert_brief.call_count >= 1, "agent 06 must upsert at least one brief"
    assert insert_stakeholders.call_count >= 1, "agent 07 must insert stakeholders"
    assert upsert_smap.call_count >= 1, "agent 07 must upsert a stakeholder map"
    assert upsert_competitor.call_count >= 1, "agent 08 must upsert competitor cards"
    assert upsert_segments.call_count >= 1, "agent 09 must upsert market segments"
    assert upsert_gtm.call_count >= 1, "agent 10 must upsert a GTM insight"

    # Sanity-check returned summaries
    assert s06["briefs_built"] >= 1
    assert s07["maps_built"] >= 1
    assert s08["cards_written"] >= 1
    assert s09["skipped"] is False
    assert s10["insights_written"] >= 1
