"""Integration tests for the phase2 agents — all external APIs mocked.

Each test asserts the agent's correct behaviour end-to-end: it reads the right
data, calls the right connectors with the right args, and writes the right
result back.
"""
from gtm_backend.phase2.agents.agent_06_account_intel import build_account_intelligence
from gtm_backend.phase2.agents.agent_07_stakeholders import map_stakeholders
from gtm_backend.phase2.agents.agent_08_competitive import gather_competitive_intel
from gtm_backend.phase2.agents.agent_09_market_sizing import size_markets
from gtm_backend.phase2.agents.agent_10_gtm_insights import generate_insights


# Agent 06 ---------------------------------------------------------------

def test_agent_06_builds_brief_with_quality_score(
    mocker, fake_lead, fake_serp_organic_results, fake_serp_news_results,
):
    """Feeds 1 lead with 1 web snippet + 1 news item. LLM returns a high-quality
    brief. Asserts: upsert_account_brief called once with status='fresh' and a
    positive brief_quality_score.
    """
    llm_payload = {
        "what_they_do": "Acme HR builds an HR platform for Indian SMBs.",
        "business_model": "B2B",
        "company_size_estimate": "Mid-market",
        "growth_trajectory": "Growing — closed Series A this quarter and hiring engineers.",
        "competitive_position": "Differentiated by India-first onboarding and payroll.",
        "recent_moves": [
            {"date": "2026-05-01", "move_type": "funding", "summary": "Series A", "source_url": "https://news/series-a"},
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
        "inferences": [{"inference": "Likely scaling sales team", "confidence": "medium"}],
        "key_signals_for_outreach": ["recent funding", "hiring spike", "Mumbai expansion"],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search",
        return_value=fake_serp_organic_results,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news",
        return_value=fake_serp_news_results,
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )

    summary = build_account_intelligence(icp_id=1, limit=5)

    assert summary["briefs_built"] == 1
    assert summary["scrape_failed"] == 0
    llm_mock.assert_called_once()
    upsert_mock.assert_called_once()
    brief = upsert_mock.call_args[0][0][0]
    assert brief.lead_id == fake_lead["id"]
    assert brief.status == "fresh"
    assert brief.brief_quality_score > 0


def test_agent_06_falls_back_to_website_when_search_empty(mocker, fake_lead):
    """When SerpAPI returns nothing (e.g. quota exhausted), Agent 06 reads the
    company's own website directly and still produces a real brief — never an
    empty scrape_failed.
    """
    site_pages = [
        {"text": "Acme HR builds people-management software for Indian SMBs. "
                 "Payroll, onboarding and compliance in one platform.",
         "source_url": "https://acmehr.com/"},
        {"text": "About Acme HR — founded 2021, headquartered in Bangalore, "
                 "serving mid-market HR teams.",
         "source_url": "https://acmehr.com/about"},
    ]
    llm_payload = {
        "what_they_do": "Acme HR builds an HR platform for Indian SMBs.",
        "business_model": "B2B",
        "company_size_estimate": "Mid-market",
        "growth_trajectory": "Growing — expanding its mid-market HR footprint.",
        "competitive_position": "Differentiated by India-first onboarding and payroll.",
        "recent_moves": [
            {"date": "2026-05", "move_type": "product", "summary": "Launched payroll hub", "source_url": "https://acmehr.com/"},
        ],
        "likely_pain_points": [
            {"pain": "Manual compliance", "evidence": "About page", "confidence": "medium"},
            {"pain": "Onboarding velocity", "evidence": None, "confidence": "low"},
        ],
        "instability_flags": [],
        "confirmed_facts": [
            {"fact": "Bangalore HQ", "source": "website", "source_url": "https://acmehr.com/about"},
        ],
        "inferences": [{"inference": "Scaling sales team", "confidence": "medium"}],
        "key_signals_for_outreach": ["payroll launch", "mid-market focus", "India-first"],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search", return_value=[])
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news", return_value=[])
    site_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.website.fetch_company_pages",
        return_value=site_pages,
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )

    summary = build_account_intelligence(icp_id=1, limit=5)

    site_mock.assert_called_once()
    llm_mock.assert_called_once()
    upsert_mock.assert_called_once()
    brief = upsert_mock.call_args[0][0][0]
    assert brief.status in {"fresh", "low_quality"}
    assert summary["scrape_failed"] == 0
    # the website page URLs became the brief's scanned sources
    assert any("acmehr.com" in u for u in brief.sources_scanned)


def test_agent_06_llm_knowledge_fallback_when_no_web_at_all(mocker, fake_lead):
    """When search AND the direct website read both return nothing, Agent 06
    builds an inference-only brief from model knowledge, flagged
    status='llm_fallback' with confirmed_facts emptied.
    """
    from gtm_backend.phase2.core.prompts import ACCOUNT_INTELLIGENCE_FALLBACK_SYSTEM

    llm_payload = {
        "what_they_do": "Likely an HR-tech vendor based on its name and domain.",
        "business_model": "B2B",
        "company_size_estimate": "unknown",
        "growth_trajectory": "",
        "competitive_position": "",
        "recent_moves": [],
        "likely_pain_points": [
            {"pain": "Generic HR-tech buyer pains", "evidence": "inferred", "confidence": "low"},
        ],
        "instability_flags": [],
        "confirmed_facts": [
            {"fact": "should be dropped", "source": "website", "source_url": "x"},
        ],
        "inferences": [{"inference": "Probably SMB-focused", "confidence": "low"}],
        "key_signals_for_outreach": ["a", "b", "c"],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search", return_value=[])
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news", return_value=[])
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.website.fetch_company_pages",
        return_value=[],
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )

    build_account_intelligence(icp_id=1, limit=5)

    llm_mock.assert_called_once()
    # the knowledge fallback must use the inference-only system prompt
    assert llm_mock.call_args[0][0] == ACCOUNT_INTELLIGENCE_FALLBACK_SYSTEM
    brief = upsert_mock.call_args[0][0][0]
    assert brief.status == "llm_fallback"
    assert brief.confirmed_facts == []  # nothing was verified against a source


def test_agent_06_scrape_failed_when_all_sources_fail(mocker, fake_lead):
    """If search is empty, the website read is empty, AND the knowledge-fallback
    LLM call errors, the brief degrades to status='scrape_failed' (never crashes).
    """
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search", return_value=[])
    mocker.patch("gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news", return_value=[])
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.website.fetch_company_pages",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        side_effect=RuntimeError("LLM down"),
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )

    summary = build_account_intelligence(icp_id=1, limit=5)

    brief = upsert_mock.call_args[0][0][0]
    assert brief.status == "scrape_failed"
    assert summary["scrape_failed"] == 1


def test_agent_06_briefs_are_batched_into_a_single_bulk_call(mocker, fake_lead, fake_serp_organic_results, fake_serp_news_results):
    """The N+1-on-writes fix: 2 leads must produce exactly one
    bulk_upsert_account_briefs call carrying both briefs, not one call per
    lead (same class of fix already applied to Agent 37)."""
    lead_2 = dict(fake_lead, id=fake_lead["id"] + 1, company_name="Beta People")
    llm_payload = {
        "what_they_do": "x", "business_model": "B2B", "company_size_estimate": "SMB",
        "growth_trajectory": "", "competitive_position": "",
        "recent_moves": [], "likely_pain_points": [], "instability_flags": [],
        "confirmed_facts": [], "inferences": [], "key_signals_for_outreach": [],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.get_leads_for_account_intel",
        return_value=[fake_lead, lead_2],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search",
        return_value=fake_serp_organic_results,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.serpapi.search_news",
        return_value=fake_serp_news_results,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_06_account_intel.supabase.bulk_upsert_account_briefs",
        return_value=None,
    )

    summary = build_account_intelligence(icp_id=1, limit=5)

    assert summary["briefs_built"] == 2
    upsert_mock.assert_called_once()
    briefs = upsert_mock.call_args[0][0]
    assert len(briefs) == 2


# Agent 07 ---------------------------------------------------------------

def test_agent_07_skips_lead_without_brief(mocker, fake_lead, fake_icp):
    """A lead without an existing account_intelligence brief is skipped — no
    LinkedIn search, no LLM call, no stakeholder insert.
    """
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_icp",
        return_value=fake_icp,
    )
    serp_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=[],
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json",
    )
    insert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.insert_stakeholders",
        return_value=[],
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.upsert_stakeholder_map",
        return_value=1,
    )

    summary = map_stakeholders(icp_id=1, limit=5)

    serp_mock.assert_not_called()
    llm_mock.assert_not_called()
    insert_mock.assert_not_called()
    upsert_mock.assert_not_called()
    assert summary["maps_built"] == 0


def test_agent_07_builds_map_with_multi_threading(
    mocker, fake_lead, fake_icp, fake_brief_row, fake_linkedin_snippets,
):
    """When the LLM returns ≥3 stakeholders, the persisted map must flip
    multi_threading_status to 'multi'.
    """
    llm_payload = {
        "stakeholders": [
            {"full_name": "Priya Iyer", "job_title": "CEO", "role_type": "economic_buyer",
             "seniority": "C-suite", "function_area": "Exec", "confidence": "high", "rank": 1,
             "linkedin_url": "https://linkedin.com/in/priya-iyer", "company_match_confidence": "high"},
            {"full_name": "Rahul Mehta", "job_title": "Head of HR", "role_type": "champion",
             "seniority": "Director", "function_area": "HR", "confidence": "medium", "rank": 2,
             "linkedin_url": "https://linkedin.com/in/rahul-mehta", "company_match_confidence": "high"},
            {"full_name": "Sara Khan", "job_title": "VP Engineering", "role_type": "influencer",
             "seniority": "VP", "function_area": "Eng", "confidence": "medium", "rank": 3,
             "linkedin_url": "https://linkedin.com/in/sara-khan", "company_match_confidence": "high"},
        ],
        "entry_point_full_name": "Rahul Mehta",
        "entry_point_role_type": "champion",
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={fake_lead["id"]: fake_brief_row},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_icp",
        return_value=fake_icp,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=fake_linkedin_snippets,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json",
        return_value=llm_payload,
    )
    insert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.insert_stakeholders",
        return_value=[1, 2, 3],
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.upsert_stakeholder_map",
        return_value=1,
    )

    summary = map_stakeholders(icp_id=1, limit=5)

    insert_mock.assert_called_once()
    upsert_mock.assert_called_once()
    smap = upsert_mock.call_args[0][0]
    assert smap.multi_threading_status == "multi"
    assert len(smap.stakeholders) >= 3
    assert smap.entry_point_full_name == "Rahul Mehta"
    assert summary["multi_threaded_accounts"] == 1


def test_agent_07_drops_blocker_as_entry_point(
    mocker, fake_lead, fake_icp, fake_brief_row, fake_linkedin_snippets,
):
    """The LLM names the CFO as the entry point but tags her role_type as
    'blocker'. Agent must blank the entry-point fields so phase 3 never
    pitches a blocker.
    """
    llm_payload = {
        "stakeholders": [
            {"full_name": "Anita Rao", "job_title": "CFO", "role_type": "blocker",
             "seniority": "C-suite", "function_area": "Finance", "confidence": "high", "rank": 1},
        ],
        "entry_point_full_name": "Anita Rao",
        "entry_point_role_type": "blocker",
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={fake_lead["id"]: fake_brief_row},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_icp",
        return_value=fake_icp,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=fake_linkedin_snippets,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json",
        return_value=llm_payload,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.insert_stakeholders",
        return_value=[1],
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.upsert_stakeholder_map",
        return_value=1,
    )

    map_stakeholders(icp_id=1, limit=5)

    upsert_mock.assert_called_once()
    smap = upsert_mock.call_args[0][0]
    assert smap.entry_point_full_name is None
    assert smap.entry_point_role_type is None


# Agent 08 ---------------------------------------------------------------

def test_agent_08_writes_competitor_card_per_discovery(mocker, fake_icp):
    """Three discovered competitor names → three LLM-produced cards →
    three upsert_competitor calls.
    """
    discovery_results = [
        {"title": "Darwinbox - Best HR Tech", "link": "https://darwinbox.com", "snippet": "..."},
        {"title": "Keka HR | India", "link": "https://keka.com", "snippet": "..."},
        {"title": "Zoho People — HR Suite", "link": "https://zoho.com/people", "snippet": "..."},
    ]
    competitor_snippets = [
        {"title": "Pricing review", "link": "https://example.com/r", "snippet": "Expensive for SMBs"},
    ]
    competitor_news = [
        {"title": "Layoffs reported", "link": "https://news/x", "snippet": "Restructuring", "date": "2026-04-01"},
    ]
    llm_payload = {
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

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_icp",
        return_value=fake_icp,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_leads_for_account_intel",
        return_value=[],
    )

    def fake_search(query: str, num: int = 8) -> list[dict]:
        if "top " in query.lower() or "companies" in query.lower():
            return discovery_results
        return competitor_snippets

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.serpapi.search",
        side_effect=fake_search,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news",
        return_value=competitor_news,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_competitor",
        return_value=1,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.delete_stale_competitors",
        return_value=0,
    )

    summary = gather_competitive_intel(icp_id=None, max_competitors=5)

    assert upsert_mock.call_count == 3
    assert summary["cards_written"] == 3
    for call in upsert_mock.call_args_list:
        card = call.args[0]
        assert card.icp_id == fake_icp["id"]
        assert card.threat_level == "high"
        assert card.competitor_name


def test_agent_08_falls_back_to_llm_when_search_empty(mocker, fake_icp):
    """When SerpAPI discovery AND per-competitor search are empty (quota gone),
    Agent 08 names competitors from model knowledge and analyses each from
    knowledge too — cards are still written, tagged with the llm source.
    """
    from gtm_backend.phase2.core.prompts import COMPETITOR_DISCOVERY_SYSTEM

    card_payload = {
        "summary": "Known HRMS player.",
        "biggest_weakness": "Heavier setup for SMBs.",
        "who_loves_them": "Mid-market IT.",
        "who_hates_them": "Lean founders.",
        "complaint_categories": [],
        "talk_tracks": [
            {"scenario": "differentiation", "message": "We are founder-first."},
        ],
        "threat_level": "medium",
    }

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_leads_for_account_intel",
        return_value=[],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search", return_value=[])
    mocker.patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news", return_value=[])

    def fake_chat_json(system, user, **kwargs):
        if system == COMPETITOR_DISCOVERY_SYSTEM:
            return {"competitors": ["Darwinbox", "Keka", "Zoho People"]}
        return card_payload

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json",
        side_effect=fake_chat_json,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_competitor",
        return_value=1,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.delete_stale_competitors",
        return_value=0,
    )

    summary = gather_competitive_intel(icp_id=None, max_competitors=5)

    assert summary["cards_written"] == 3
    assert upsert_mock.call_count == 3
    for call in upsert_mock.call_args_list:
        card = call.args[0]
        assert card.sources == ["llm_internal_knowledge"]
        assert card.competitor_name


# Agent 09 ---------------------------------------------------------------

def test_agent_09_skips_when_total_leads_below_threshold(mocker, fake_icp):
    """If every ICP has < 5 scored leads, the agent must abort without
    invoking the LLM and return skipped=True.
    """
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_scored_lead_counts_by_icp",
        return_value={"total": 1, "hot": 0, "warm": 1, "cold": 0},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_market_segments",
        return_value=[],
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.llm.chat_json",
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.upsert_market_segments",
        return_value=[],
    )

    summary = size_markets()

    llm_mock.assert_not_called()
    upsert_mock.assert_not_called()
    assert summary["skipped"] is True
    assert summary["total_leads"] == 1


def test_agent_09_skips_llm_call_when_already_computed_this_week(mocker, fake_icp):
    """The freshness gate: if a market_segment_intel snapshot already exists
    for this week_of, skip the (expensive, whole-portfolio) LLM call
    entirely without even reading lead counts — this is what actually
    exhausted the daily token quota when called on every per-ICP run.
    """
    get_segments_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_market_segments",
        return_value=[{"icp_id": fake_icp["id"], "week_of": "2026-07-27"}],
    )
    icps_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_active_icps",
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.llm.chat_json",
    )

    summary = size_markets()

    get_segments_mock.assert_called_once()
    icps_mock.assert_not_called()
    llm_mock.assert_not_called()
    assert summary["already_computed"] is True
    assert summary["segments_written"] == 0


def test_agent_09_force_bypasses_freshness_gate(mocker, fake_icp):
    """force=True must recompute even if this week's snapshot exists."""
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_market_segments",
        return_value=[{"icp_id": fake_icp["id"], "week_of": "2026-07-27"}],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_scored_lead_counts_by_icp",
        return_value={"total": 150, "hot": 30, "warm": 70, "cold": 50},
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.llm.chat_json",
        return_value={
            "summary": "x", "primary_gtm_segment": None, "secondary_gtm_segment": None,
            "avoid_this_week": None, "focus_reason": None, "segments": [],
        },
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.upsert_market_segments",
        return_value=[],
    )

    summary = size_markets(force=True)

    llm_mock.assert_called_once()
    assert summary.get("already_computed") is not True


def test_agent_09_writes_segments_when_leads_sufficient(mocker, fake_icp):
    """With 150 leads, the agent calls the LLM and persists the segments it
    returns.
    """
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_scored_lead_counts_by_icp",
        return_value={"total": 150, "hot": 30, "warm": 70, "cold": 50},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.get_market_segments",
        return_value=[],
    )
    llm_payload = {
        "summary": "One mature segment with healthy demand.",
        "primary_gtm_segment": "Mid-market HR-tech in India",
        "secondary_gtm_segment": None,
        "avoid_this_week": None,
        "focus_reason": "150 scored leads with high warm volume.",
        "segments": [
            {
                "icp_id": fake_icp["id"],
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
    mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_09_market_sizing.supabase.upsert_market_segments",
        return_value=[42],
    )

    summary = size_markets()

    upsert_mock.assert_called_once()
    segments = upsert_mock.call_args[0][0]
    assert len(segments) > 0
    assert segments[0].icp_id == fake_icp["id"]
    assert segments[0].priority_rank == 1
    assert summary["skipped"] is False
    assert summary["segments_written"] == 1


# Agent 10 ---------------------------------------------------------------

def test_agent_10_skips_when_no_brief(mocker, fake_lead):
    """Without an account brief, agent 10 never calls the LLM or writes."""
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=None,
    )
    llm_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    summary = generate_insights(icp_id=1, limit=5)

    llm_mock.assert_not_called()
    upsert_mock.assert_not_called()
    assert summary["insights_written"] == 0


def test_agent_10_writes_insight_with_normalised_channel(mocker, fake_lead, fake_brief_row):
    """The LLM hands back 'Email' (mixed case); agent must normalise to 'email'
    before persisting.
    """
    llm_payload = {
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
            "primary_channel": "Email",
            "sequence": ["LinkedIn touch", "Email intro", "Follow-up call"],
            "cadence": "3 touches over 10 days",
        },
        "why_market_rationale": "Top-ranked segment this week.",
        "why_account_rationale": "Funded, hiring, no incumbent.",
        "urgency_signal": "Funding just announced.",
        "flags_and_contradictions": [],
        "next_actions": ["Send personalised LinkedIn DM to Rahul"],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=fake_brief_row,
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
            "multi_threading_status": "single",
        },
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_competitors_for_icp",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_market_segments",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    summary = generate_insights(icp_id=1, limit=5)

    upsert_mock.assert_called_once()
    insight = upsert_mock.call_args[0][0]
    assert insight.which_channel.primary_channel == "email"
    assert insight.who_to_target.entry_point_name == "Rahul Mehta"
    assert summary["insights_written"] == 1
    # Human-review gate: a fresh brief is not active until approved.
    assert insight.review_status == "pending_review"
    assert summary["pending_review"] == 1


def test_agent_10_blanks_entry_point_name_not_in_stakeholder_data(mocker, fake_lead, fake_brief_row):
    """Found live 2026-08-22: "Ankita Sharma, Chief Compliance Officer"
    appeared as a next-action target for a lead whose stakeholder phase
    (Agent 07) had never even run — no such name existed anywhere in the
    input data. The LLM's claimed entry_point_name/secondary_contacts/
    next_actions must be re-validated against the ACTUAL verified
    stakeholder names, not trusted outright."""
    llm_payload = {
        "executive_summary": "...",
        "who_to_target": {
            "segment": "...", "priority_rank": 1,
            "entry_point_name": "Ankita Sharma",  # not in stakeholder data below
            "entry_point_role": "Chief Compliance Officer",
            "secondary_contacts": ["Rahul Mehta", "Priya Iyer"],  # only Rahul is real
        },
        "what_to_say": {
            "core_message": "...", "unique_value_proposition": "...",
            "pain_points_to_address": [], "competitive_angle": "...",
        },
        "which_channel": {"primary_channel": "email", "sequence": [], "cadence": ""},
        "why_market_rationale": "...", "why_account_rationale": "...",
        "urgency_signal": "",
        "flags_and_contradictions": [],
        "next_actions": [
            "Research and confirm the email address of Ankita Sharma (Chief Compliance Officer).",
            "Send a personalised note to Rahul Mehta.",
            "Prepare a short demo deck mapping compliance dashboards.",
        ],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=fake_brief_row,
    )
    # Agent 07 never ran for this lead — no stakeholders, no entry point.
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholders_for_lead",
        return_value=[{"full_name": "Rahul Mehta", "job_title": "Founder", "role_type": "champion",
                        "seniority": "Exec", "confidence": "high"}],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholder_map_for_lead",
        return_value=None,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_competitors_for_icp",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_market_segments",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    generate_insights(icp_id=1, limit=5)

    insight = upsert_mock.call_args[0][0]
    # Unverified name -> blanked, not trusted.
    assert insight.who_to_target.entry_point_name == ""
    # Verified name kept, unverified name dropped from the list.
    assert insight.who_to_target.secondary_contacts == ["Rahul Mehta"]
    # The next action naming the fabricated person is dropped; the one
    # naming the real, verified person and the generic one are both kept.
    assert "Research and confirm the email address of Ankita Sharma (Chief Compliance Officer)." not in insight.next_actions
    assert "Send a personalised note to Rahul Mehta." in insight.next_actions
    assert "Prepare a short demo deck mapping compliance dashboards." in insight.next_actions


def test_agent_10_keeps_entry_point_name_when_verified(mocker, fake_lead, fake_brief_row):
    """A name that DOES appear in the real stakeholder data must pass
    through untouched — the validation should never strip a legitimate,
    verified contact."""
    llm_payload = {
        "executive_summary": "...",
        "who_to_target": {
            "segment": "...", "priority_rank": 1,
            "entry_point_name": "Rahul Mehta", "entry_point_role": "Founder",
            "secondary_contacts": [],
        },
        "what_to_say": {
            "core_message": "...", "unique_value_proposition": "...",
            "pain_points_to_address": [], "competitive_angle": "...",
        },
        "which_channel": {"primary_channel": "email", "sequence": [], "cadence": ""},
        "why_market_rationale": "...", "why_account_rationale": "...",
        "urgency_signal": "", "flags_and_contradictions": [], "next_actions": [],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=fake_brief_row,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholders_for_lead",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholder_map_for_lead",
        return_value={"entry_point_full_name": "Rahul Mehta", "entry_point_role_type": "champion",
                       "multi_threading_status": "single"},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_competitors_for_icp",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_market_segments",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    generate_insights(icp_id=1, limit=5)

    insight = upsert_mock.call_args[0][0]
    assert insight.who_to_target.entry_point_name == "Rahul Mehta"


def test_agent_10_title_only_next_action_not_mistaken_for_a_name(mocker, fake_lead, fake_brief_row):
    """A generic action mentioning only a job title (no person's name) must
    never be stripped — the name-detection heuristic excludes common title
    words specifically to avoid this false positive."""
    llm_payload = {
        "executive_summary": "...",
        "who_to_target": {
            "segment": "...", "priority_rank": 1, "entry_point_name": None,
            "entry_point_role": "Chief Compliance Officer", "secondary_contacts": [],
        },
        "what_to_say": {
            "core_message": "...", "unique_value_proposition": "...",
            "pain_points_to_address": [], "competitive_angle": "...",
        },
        "which_channel": {"primary_channel": "email", "sequence": [], "cadence": ""},
        "why_market_rationale": "...", "why_account_rationale": "...",
        "urgency_signal": "", "flags_and_contradictions": [],
        "next_actions": ["Identify the Chief Compliance Officer and confirm their contact details."],
    }
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_account_brief",
        return_value=fake_brief_row,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholders_for_lead",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_stakeholder_map_for_lead",
        return_value=None,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_competitors_for_icp",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_market_segments",
        return_value=[],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.llm.chat_json",
        return_value=llm_payload,
    )
    upsert_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.upsert_gtm_insight",
        return_value=1,
    )

    generate_insights(icp_id=1, limit=5)

    insight = upsert_mock.call_args[0][0]
    assert insight.next_actions == ["Identify the Chief Compliance Officer and confirm their contact details."]


# Agent 07 — coverage / budget / reporting -------------------------------

def _patch_agent_07_reads(mocker, fake_lead, fake_icp, fake_brief_row, llm_payload):
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_account_briefs",
        return_value={fake_lead["id"]: fake_brief_row},
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.get_icp",
        return_value=fake_icp,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.serpapi.search_linkedin_people",
        return_value=[{"title": "x", "link": "y", "snippet": "z"}],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.llm.chat_json",
        return_value=llm_payload,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.insert_stakeholders",
        return_value=[1, 2, 3],
    )
    return mocker.patch(
        "gtm_backend.phase2.agents.agent_07_stakeholders.supabase.upsert_stakeholder_map",
        return_value=1,
    )


def test_agent_07_complete_coverage_with_budget_champion(
    mocker, fake_lead, fake_icp, fake_brief_row,
):
    """All 3 required roles present and the champion is a VP (has budget):
    coverage_status='complete', no missing roles, champion_budget_flag=False,
    and reports_to is captured from the LLM.
    """
    llm_payload = {
        "stakeholders": [
            {"full_name": "Priya Iyer", "job_title": "CEO", "role_type": "economic_buyer",
             "seniority": "C-suite", "confidence": "high", "rank": 1, "company_match_confidence": "high"},
            {"full_name": "Rahul Mehta", "job_title": "VP People", "role_type": "champion",
             "seniority": "VP", "confidence": "medium", "rank": 2, "reports_to": "Priya Iyer",
             "company_match_confidence": "high"},
            {"full_name": "Sara Khan", "job_title": "Eng Lead", "role_type": "influencer",
             "seniority": "Director", "confidence": "medium", "rank": 3, "reports_to": "Priya Iyer",
             "company_match_confidence": "high"},
        ],
        "entry_point_full_name": "Rahul Mehta",
        "entry_point_role_type": "champion",
    }
    upsert_mock = _patch_agent_07_reads(mocker, fake_lead, fake_icp, fake_brief_row, llm_payload)

    summary = map_stakeholders(icp_id=1, limit=5)

    smap = upsert_mock.call_args[0][0]
    assert smap.coverage_status == "complete"
    assert smap.missing_roles == []
    assert smap.champion_budget_flag is False
    champion = next(s for s in smap.stakeholders if s.role_type == "champion")
    assert champion.reports_to == "Priya Iyer"
    assert "no_budget_authority" not in champion.risk_flags
    assert summary["coverage_incomplete"] == 0
    assert summary["champion_budget_flags"] == 0


def test_agent_07_incomplete_coverage_and_champion_without_budget(
    mocker, fake_lead, fake_icp, fake_brief_row,
):
    """Only Economic Buyer + a Manager-level Champion (no Influencer, no budget):
    coverage_status='incomplete' with 'influencer' missing, champion_budget_flag
    =True, and the champion gets a 'no_budget_authority' risk flag.
    """
    llm_payload = {
        "stakeholders": [
            {"full_name": "Priya Iyer", "job_title": "CEO", "role_type": "economic_buyer",
             "seniority": "C-suite", "confidence": "high", "rank": 1, "company_match_confidence": "high"},
            {"full_name": "Dev Rao", "job_title": "HR Manager", "role_type": "champion",
             "seniority": "Manager", "confidence": "medium", "rank": 2, "company_match_confidence": "high"},
        ],
        "entry_point_full_name": "Dev Rao",
        "entry_point_role_type": "champion",
    }
    upsert_mock = _patch_agent_07_reads(mocker, fake_lead, fake_icp, fake_brief_row, llm_payload)

    summary = map_stakeholders(icp_id=1, limit=5)

    smap = upsert_mock.call_args[0][0]
    assert smap.coverage_status == "incomplete"
    assert "influencer" in smap.missing_roles
    assert smap.champion_budget_flag is True
    champion = next(s for s in smap.stakeholders if s.role_type == "champion")
    assert "no_budget_authority" in champion.risk_flags
    assert summary["coverage_incomplete"] == 1
    assert summary["champion_budget_flags"] == 1


# Agent 08 — lead-already-uses-competitor flag ---------------------------

def test_agent_08_flags_lead_using_competitor(mocker, fake_icp, fake_lead):
    """A lead whose account brief mentions a tracked competitor gets a
    lead_competitor_usage row written.
    """
    from gtm_backend.phase2.core.prompts import COMPETITOR_DISCOVERY_SYSTEM

    card_payload = {
        "summary": "Known HRMS player.", "biggest_weakness": "Setup-heavy.",
        "who_loves_them": "IT", "who_hates_them": "Founders",
        "complaint_categories": [], "talk_tracks": [], "threat_level": "medium",
    }
    brief = {
        "what_they_do": "HR platform for SMBs.",
        "competitive_position": "Currently runs on Darwinbox for HRMS.",
        "growth_trajectory": "",
    }

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_active_icps",
        return_value=[fake_icp],
    )
    mocker.patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search", return_value=[])
    mocker.patch("gtm_backend.phase2.agents.agent_08_competitive.serpapi.search_news", return_value=[])

    def fake_chat_json(system, user, **kwargs):
        if system == COMPETITOR_DISCOVERY_SYSTEM:
            return {"competitors": ["Darwinbox", "Keka", "Zoho People"]}
        return card_payload

    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.llm.chat_json", side_effect=fake_chat_json,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_competitor", return_value=1,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.delete_stale_competitors",
        return_value=0,
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_leads_for_account_intel",
        return_value=[fake_lead],
    )
    mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.get_account_briefs",
        return_value={fake_lead["id"]: brief},
    )
    usage_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_08_competitive.supabase.upsert_lead_competitor_usage",
        return_value=1,
    )

    summary = gather_competitive_intel(icp_id=None, max_competitors=5)

    assert summary["usage_flags_written"] >= 1
    flagged = [c.args[0].competitor_name for c in usage_mock.call_args_list]
    assert "Darwinbox" in flagged
    assert usage_mock.call_args_list[0].args[0].lead_id == fake_lead["id"]


# Agent 10 — human-review gate -------------------------------------------

def test_agent_10_approve_insights_for_one_lead(mocker):
    """approve_insights(lead_id=...) flips that lead's brief to approved."""
    approve_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.approve_gtm_insight",
        return_value=1,
    )

    from gtm_backend.phase2.agents.agent_10_gtm_insights import approve_insights
    result = approve_insights(lead_id=100, reviewed_by="ops")

    assert result["approved"] == 1
    approve_mock.assert_called_once_with(100, reviewed_by="ops")


def test_agent_10_approve_all_pending(mocker):
    """approve_insights() with no lead approves every pending brief."""
    mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.get_pending_gtm_insights",
        return_value=[
            {"lead_id": 100, "brief_date": "2026-06-02", "company_name": "Acme HR"},
            {"lead_id": 101, "brief_date": "2026-06-02", "company_name": "Beta Co"},
        ],
    )
    approve_mock = mocker.patch(
        "gtm_backend.phase2.agents.agent_10_gtm_insights.supabase.approve_gtm_insight",
        return_value=1,
    )

    from gtm_backend.phase2.agents.agent_10_gtm_insights import approve_insights
    result = approve_insights()

    assert result["approved"] == 2
    assert approve_mock.call_count == 2
